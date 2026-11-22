"""统一源探针：可达性 + 延迟/吞吐测速 → 进程内状态缓存 → 通路判定。

口径来源：artifacts/vis/drafts/source-probe-and-defaults-spec.md（第七轮）。
本模块只负责「事实测量 + 缓存 + 判定」，不写界面文案。

三条硬规矩（都来自规格，改动前先想清楚）：
1. **只探小请求**：响应体读取 ≤ 64 KiB；测速用 Range 取前 256 KiB，
   登记的测速目标必须 < 1 MiB —— **绝不拿模型权重测速**。
2. **只有 down 才门控**：探针自己出错（后端异常、没网）一律落 unknown。
   否则一次后端抖动就把用户的所有源藏起来，那不叫门控，叫把产品藏起来。
3. **结论与速度同生共死**：写在同一份缓存条目里，同一条 TTL。
   不允许出现「结论是新的、速度是旧的」—— 策略是拿速度做决策的，混搭会选错通路。

缓存不落盘：settings.json 是配置，不是状态；重启后重新探一次是刻意的。
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from .config import build_proxy_url, load_settings

# ── 阈值（规格 §2.2 / §2.4 / §2.5.3）────────────────────────────
PATHS = ("direct", "mirror", "proxy")
PATH_LABEL = {"direct": "直连", "mirror": "镜像", "proxy": "代理"}

TIMEOUT_DIRECT = 5.0          # 单请求超时（直连 / 镜像）
TIMEOUT_PROXY = 8.0           # 代理多一跳，首连要握手
SPEED_TIMEOUT = {"direct": 8.0, "mirror": 8.0, "proxy": 10.0}  # 测速请求的宽限
RETRY_GAP = 0.4               # 只对超时 / 连接错误 / 5xx 重试一次
BODY_LIMIT = 64 * 1024        # 响应体读取上限
SPEED_RANGE = 256 * 1024      # 测速取前 256 KiB
ROUND_DEADLINE = 15.0         # 一轮整体上限，超时的源记 unknown
WORKERS = 6                   # 全局并发

TTL_OK = 15 * 60              # 可达结论缓存 15 分钟
TTL_DEGRADED = 10 * 60        # 降级 / 受限 10 分钟
TTL_DOWN = 3 * 60             # 不可达 3 分钟（坏消息要更快翻案）
COOLDOWN = 10.0               # 手动重探冷却，防假忙碌

PROXY_GAIN = 1.2              # 代理要比最快的那条快 20% 以上才默认走代理（吞吐比）
SPEED_TIE = 0.1               # 吞吐相差 ≤ 0.1 MB/s 时取延迟更低的那条

# 设置页出现的 6 个外网源（demo 是本地假数据，不出网，不参与探测与门控）
SOURCES = ("huggingface", "modelscope", "civitai", "github", "templates", "comfyhub")

UA = {"User-Agent": "model-downloader/0.1"}


@dataclass(frozen=True)
class SourceTarget:
    """一个源在一条通路上的两个目标。

    latency_url：与业务同端点的小请求（能同时验 DNS / TLS / 线路）。
    speed_url：同 host 上已知 < 1 MiB 的小文件，Range 取前 256 KiB 测吞吐。
    method：延迟探针用 HEAD 的源（官方模板 / ComfyHub 没有目录索引）。
    """

    latency_url: str
    speed_url: str
    method: str = "GET"


# 测速目标登记表（规格 §2.5.2）。改登记项要重算体积，必须 < 1 MiB。
REGISTRY: dict[str, SourceTarget] = {
    "huggingface": SourceTarget(
        "https://huggingface.co/api/models?limit=1",
        "https://huggingface.co/bert-base-uncased/resolve/main/vocab.txt",
    ),
    "modelscope": SourceTarget(
        "https://modelscope.cn/openapi/v1/models?PageSize=1",
        "https://modelscope.cn/api/v1/models/Qwen/Qwen2-0.5B/repo"
        "?Revision=master&FilePath=README.md",
    ),
    "civitai": SourceTarget(
        "https://civitai.red/api/v1/models?limit=1",
        "https://civitai.red/api/v1/models?limit=1",
    ),
    "github": SourceTarget(
        "https://api.github.com/rate_limit",
        "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/README.md",
    ),
    "templates": SourceTarget(
        "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/README.md",
        "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/README.md",
        method="HEAD",
    ),
    "comfyhub": SourceTarget(
        "https://cloud.comfy.org/api/hub/workflows/index",
        "https://cloud.comfy.org/api/hub/workflows/index",
    ),
}

# 只在「该站配了镜像」时才有镜像通路；这两个站有镜像字段，其余没有。
MIRROR_SOURCES = ("huggingface", "github")


# ── 结果结构 ────────────────────────────────────────────────────
@dataclass
class PathResult:
    """一条通路的读数。state 取值：ok / blocked / skip / unknown。"""

    path: str
    state: str = "unknown"
    latency_ms: int | None = None
    speed_mbps: float | None = None
    reason: str = ""          # 失败原因分类码（规格 §2.3）
    reason_text: str = ""     # 人话
    detail: str = ""          # 补充：地址 / 异常摘要
    skip: str = ""            # not_configured / not_enabled / not_probed
    restricted: bool = False  # 可达但受限（401 / 403 / 429）

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "state": self.state,
            "latency_ms": self.latency_ms,
            "speed_mbps": self.speed_mbps,
            "reason": self.reason,
            "reason_text": self.reason_text,
            "detail": self.detail,
            "skip": self.skip,
            "restricted": self.restricted,
        }


@dataclass
class SourceResult:
    """一个源的探针结论。"""

    source: str
    label: str = ""
    verdict: str = "unknown"          # ok / degraded / down / unknown
    paths: dict[str, PathResult] = field(default_factory=dict)
    path: str = ""                    # 生效通路（direct / mirror / proxy）
    path_text: str = ""               # 一行人话结论
    fallback: bool = False            # 手动指定的通路不可用 → 已回退
    gated: bool = False               # 是否被门控（只有 down 才门控）
    checked_at: float = 0.0

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "label": self.label,
            "verdict": self.verdict,
            "paths": {k: v.to_dict() for k, v in self.paths.items()},
            "path": self.path,
            "path_text": self.path_text,
            "fallback": self.fallback,
            "gated": self.gated,
            "checked_at": self.checked_at,
            "age_seconds": int(max(0.0, time.time() - self.checked_at)) if self.checked_at else None,
        }


# ── 进程内缓存（规格 §2.4）─────────────────────────────────────
# TTL 按结论分档（可达 15 / 降级 10 / 不可达 3 分钟），所以不能直接用
# cache.TtlCache 那种「一把尺子量所有键」的写法，这里按条目存到期时刻。
_cache: dict[str, tuple[float, SourceResult]] = {}
_cache_lock = threading.Lock()
_probe_locks: dict[str, threading.Lock] = {}
_probe_locks_guard = threading.Lock()
_last_refresh = 0.0


def invalidate() -> None:
    """作废全部结论。改代理地址 / 改镜像 / 保存设置后必须调用。"""
    with _cache_lock:
        _cache.clear()


def _lock_for(source: str) -> threading.Lock:
    with _probe_locks_guard:
        lock = _probe_locks.get(source)
        if lock is None:
            lock = threading.Lock()
            _probe_locks[source] = lock
        return lock


# ── 失败分类（规格 §2.3）───────────────────────────────────────
def _classify(exc: Exception, label: str, timeout: float, host: str) -> tuple[str, str]:
    """把异常翻译成 (分类码, 人话)。分类码是产品内的闭集，界面按它取措辞。"""
    text = str(exc)
    low = text.lower()
    if isinstance(exc, httpx.TimeoutException):
        return "timeout", f"{label}超时（{timeout:g} 秒无响应）"
    if "name or service not known" in low or "nodename nor servname" in low or "getaddrinfo" in low:
        return "dns", f"域名解析失败：{host}"
    if "certificate" in low or "ssl" in low:
        return "tls", "TLS 握手失败：证书校验未通过"
    if "connection refused" in low or "errno 61" in low or "econnrefused" in low:
        return "refused", "连接被拒绝：目标端口未开放"
    return "unknown", f"未知错误：{text[:120]}"


def _http_reason(status: int) -> tuple[str, str, bool, bool]:
    """HTTP 状态码 → (分类码, 人话, 可达但受限, 判死)。

    401 / 403 / 429 说明对端活着，只是要令牌或被限流 —— 不是 down，是「降级」。
    其它 4xx 是**探测目标本身不可用**（URL 写错 / 没有这个资源）—— 那是探针自己的
    问题，不能拿来判这个源不可用，所以既不判死也不当「可用」，一律落 unknown。
    """
    if status == 429:
        return "rate_limited", "可达但被限流（HTTP 429）", True, False
    if status in (401, 403):
        return "forbidden", f"可达但需要授权（HTTP {status}）", True, False
    if status >= 500:
        return "server", f"对端服务异常（HTTP {status}）", False, True
    if status >= 400:
        return "http_error", f"探测目标不可用（HTTP {status}）", False, False
    return "", "", False, False


# ── 单次请求 ───────────────────────────────────────────────────
def _latency_probe(
    url: str, *, method: str, headers: dict, proxy: str | None, timeout: float
) -> tuple[int | None, int | None, str, str]:
    """只取状态码与 TTFB（建连到首字节，毫秒）。

    返回 (status, ttfb_ms, reason_code, reason_text)；失败时 status 为 None。
    """
    started = time.perf_counter()
    try:
        with httpx.Client(proxy=proxy, timeout=timeout, follow_redirects=True) as client:
            req = client.build_request(method, url, headers=headers)
            resp = client.send(req, stream=True)
            ttfb = int((time.perf_counter() - started) * 1000)
            try:
                if method != "HEAD":
                    # 只读一点：确认对端真能吐数据，不整包下载
                    read = 0
                    for chunk in resp.iter_bytes():
                        read += len(chunk)
                        if read >= BODY_LIMIT:
                            break
            finally:
                resp.close()
            return resp.status_code, ttfb, "", ""
    except httpx.HTTPError as exc:
        code, text = _classify(exc, PATH_LABEL.get("direct", ""), timeout, urlsplit(url).hostname or "")
        return None, None, code, text
    except Exception as exc:  # noqa: BLE001 —— 探针不许把异常穿透到界面
        return None, None, "unknown", f"未知错误：{str(exc)[:120]}"


def _speed_probe(
    url: str, *, headers: dict, proxy: str | None, timeout: float
) -> tuple[float | None, int | None, str, str]:
    """Range 取前 256 KiB 测吞吐。返回 (MB/s, ttfb_ms, reason_code, reason_text)。"""
    started = time.perf_counter()
    try:
        with httpx.Client(proxy=proxy, timeout=timeout, follow_redirects=True) as client:
            req = client.build_request(
                "GET", url, headers={**headers, "Range": f"bytes=0-{SPEED_RANGE - 1}"}
            )
            resp = client.send(req, stream=True)
            t_head = time.perf_counter()
            if resp.status_code >= 400:
                resp.close()
                code, text, _restricted, _dead = _http_reason(resp.status_code)
                return None, int((t_head - started) * 1000), code, text
            total = 0
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total >= SPEED_RANGE:
                    break
            t_end = time.perf_counter()
            resp.close()
        transfer = max(t_end - t_head, 1e-6)
        mbps = (total / (1024 * 1024)) / transfer
        return round(mbps, 2), int((t_head - started) * 1000), "", ""
    except httpx.HTTPError as exc:
        code, text = _classify(exc, "", timeout, urlsplit(url).hostname or "")
        return None, None, code, text
    except Exception as exc:  # noqa: BLE001
        return None, None, "unknown", f"未知错误：{str(exc)[:120]}"


def _with_retry(fn):
    """只对超时 / 连接错误 / 5xx 重试一次（4xx 重试也不会变）。

    但**超时后不再重试**：一次超时已经吃掉 5 秒，再来一次就超出单通路 8 秒的预算。
    真正「秒失败」（连接被拒 / DNS 不通）才值得立刻重来一次。
    """
    started = time.perf_counter()
    result = fn()
    status = result[0]
    reason = result[2] if len(result) > 2 else ""
    fast = (time.perf_counter() - started) < 2.0
    if fast and (status is None or status >= 500) and reason not in ("forbidden", "rate_limited"):
        time.sleep(RETRY_GAP)
        return fn()
    return result


# ── 目标构造 ───────────────────────────────────────────────────
def _mirror_base(cfg: dict) -> str:
    raw = str((cfg or {}).get("mirror") or "").strip().rstrip("/")
    return raw


def _targets_for(source: str, cfg: dict, proxy_url: str) -> dict[str, SourceTarget | None]:
    """给一个源算出三条通路各自的目标（None = 这条不测）。"""
    target = REGISTRY.get(source)
    out: dict[str, SourceTarget | None] = {"direct": target, "mirror": None, "proxy": None}
    if target is None:
        return out
    if source in MIRROR_SOURCES:
        base = _mirror_base(cfg)
        if base:
            parts = urlsplit(target.latency_url)
            mparts = urlsplit(base)
            mirror_latency = urlunsplit((mparts.scheme, mparts.netloc, parts.path, parts.query, ""))
            sparts = urlsplit(target.speed_url)
            mirror_speed = urlunsplit((mparts.scheme, mparts.netloc, sparts.path, sparts.query, ""))
            out["mirror"] = SourceTarget(mirror_latency, mirror_speed, target.method)
    if proxy_url:
        out["proxy"] = target
    return out


def _skip_result(path: str, skip: str, text: str) -> PathResult:
    return PathResult(path=path, state="skip", skip=skip, reason_text=text)


# ── 单条通路 ───────────────────────────────────────────────────
def _probe_path(
    source: str, path: str, target: SourceTarget | None, *, proxy_url: str | None,
    headers: dict, cfg: dict,
) -> PathResult:
    if target is None:
        if path == "mirror":
            if source in MIRROR_SOURCES:
                return _skip_result(path, "not_configured", "镜像地址为空，不测这一条")
            return _skip_result(path, "not_configured", "该站没有镜像入口，不测这一条")
        if path == "proxy":
            return _skip_result(path, "not_configured", "全局代理未配置，不测这一条")
        return _skip_result(path, "not_configured", "没有可测的目标")

    timeout = TIMEOUT_PROXY if path == "proxy" else TIMEOUT_DIRECT
    label = PATH_LABEL[path]
    host = urlsplit(target.latency_url).hostname or ""

    def once():
        return _latency_probe(
            target.latency_url, method=target.method, headers=headers, proxy=proxy_url, timeout=timeout
        )

    status, ttfb, reason, reason_text = _with_retry(once)
    if status is None:
        return PathResult(
            path=path, state="blocked", latency_ms=ttfb, reason=reason or "unknown",
            reason_text=reason_text or f"{label}不通", detail=host,
        )
    if status >= 400:
        code, text, restricted, dead = _http_reason(status)
        if restricted:
            # 可达但受限：对端活着，判「降级」而不是「不可用」
            return PathResult(
                path=path, state="ok", latency_ms=ttfb, reason=code, reason_text=text,
                detail=host, restricted=True,
            )
        if not dead:
            # 探测目标本身不可用（4xx）：判不了这个源，既不判死也不当可用
            return PathResult(
                path=path, state="unknown", latency_ms=ttfb, reason=code,
                reason_text=text, detail=host,
            )
        return PathResult(
            path=path, state="blocked", latency_ms=ttfb, reason=code or "server",
            reason_text=text or f"{label}不通（HTTP {status}）", detail=host,
        )

    # 可达 → 测速（拿不到吞吐也不影响结论，只少一个读数）
    speed, _s_ttfb, sreason, stext = _speed_probe(
        target.speed_url, headers=headers, proxy=proxy_url, timeout=SPEED_TIMEOUT[path]
    )
    if speed is None:
        return PathResult(
            path=path, state="ok", latency_ms=ttfb, speed_mbps=None, detail=host,
            reason=sreason, reason_text="可达，没测出吞吐",
        )
    return PathResult(
        path=path, state="ok", latency_ms=ttfb, speed_mbps=speed, detail=host,
    )


# ── 一轮全站探测 ───────────────────────────────────────────────
def _headers_for(source: str, cfg: dict) -> dict:
    headers = dict(UA)
    token = str(cfg.get("token") or "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if source == "github":
        headers["Accept"] = "application/vnd.github+json"
    return headers


def _skip_for(source: str, path: str, proxy_url: str | None) -> PathResult:
    """这条通路不测时的读数（写清楚为什么没测）。"""
    if path == "mirror":
        if source in MIRROR_SOURCES:
            return _skip_result(path, "not_configured", "镜像地址为空，不测这一条")
        return _skip_result(path, "not_configured", "该站没有镜像入口，不测这一条")
    if path == "proxy":
        if not proxy_url:
            return _skip_result(path, "not_configured", "全局代理未配置，不测这一条")
        return _skip_result(path, "not_configured", "这条通路不测")
    return _skip_result(path, "not_configured", "没有可测的目标")


def _fill_skips(source: str, paths: dict[str, PathResult], proxy_url: str | None) -> None:
    for path in PATHS:
        if path not in paths:
            paths[path] = _skip_for(source, path, proxy_url)


def _probe_path_task(source: str, path: str, settings: dict, proxy_url: str | None) -> PathResult:
    """探一条通路。异常一律落 unknown —— 探针不许把异常穿透到界面。"""
    try:
        cfg = (settings.get("sources") or {}).get(source) or {}
        targets = _targets_for(source, cfg, proxy_url or "")
        target = targets.get(path)
        if target is None:
            return _skip_for(source, path, proxy_url)
        return _probe_path(
            source, path, target,
            proxy_url=proxy_url if path == "proxy" else None,
            headers=_headers_for(source, cfg), cfg=cfg,
        )
    except Exception as exc:  # noqa: BLE001
        return PathResult(
            path=path, state="unknown", reason="unknown",
            reason_text=f"探测异常：{str(exc)[:80]}",
        )


def _probe_source(source: str, settings: dict) -> SourceResult:
    """探一个源的三条通路（源内并发）。"""
    cfg = (settings.get("sources") or {}).get(source) or {}
    proxy_url = build_proxy_url(settings.get("proxy") or "") or None
    paths: dict[str, PathResult] = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(_probe_path_task, source, path, settings, proxy_url): path
            for path in PATHS
        }
        for fut, path in futures.items():
            try:
                paths[path] = fut.result(timeout=ROUND_DEADLINE)
            except Exception:  # noqa: BLE001
                paths[path] = PathResult(
                    path=path, state="unknown", reason="unknown", reason_text="探测超时"
                )
    _fill_skips(source, paths, proxy_url)
    return _verdict_for(source, label_of(source, settings), paths)


def label_of(source: str, settings: dict) -> str:
    return str(((settings.get("sources") or {}).get(source) or {}).get("label") or source)


def probe_round(settings: dict | None = None) -> dict[str, SourceResult]:
    """探一轮全部源。

    源内的三条通路并发，全局并发不超过 WORKERS（规格 §2.2）。
    一轮整体不超过 ROUND_DEADLINE —— 还没回来的通路记 unknown（本轮不判死）。
    """
    settings = settings or load_settings()
    proxy_url = build_proxy_url(settings.get("proxy") or "") or None
    jobs: list[tuple[str, str]] = []
    for name in SOURCES:
        cfg = (settings.get("sources") or {}).get(name) or {}
        targets = _targets_for(name, cfg, proxy_url or "")
        for path in PATHS:
            if targets.get(path) is not None:
                jobs.append((name, path))

    collected: dict[str, dict[str, PathResult]] = {name: {} for name in SOURCES}
    pool = ThreadPoolExecutor(max_workers=WORKERS)
    try:
        futures = {
            pool.submit(_probe_path_task, name, path, settings, proxy_url): (name, path)
            for name, path in jobs
        }
        done, _pending = futures_wait(list(futures.keys()), timeout=ROUND_DEADLINE)
        for fut, (name, path) in futures.items():
            if fut in done:
                try:
                    collected[name][path] = fut.result()
                except Exception:  # noqa: BLE001
                    collected[name][path] = PathResult(
                        path=path, state="unknown", reason="unknown", reason_text="探测异常"
                    )
            else:
                collected[name][path] = PathResult(
                    path=path, state="unknown", reason="unknown", reason_text="探测超时"
                )
    finally:
        pool.shutdown(wait=False)

    out: dict[str, SourceResult] = {}
    for name in SOURCES:
        paths = collected[name]
        _fill_skips(name, paths, proxy_url)
        out[name] = _verdict_for(name, label_of(name, settings), paths)
    return out


def _verdict_for(source: str, label: str, results: dict[str, PathResult]) -> SourceResult:
    """四态判定（规格 §3.1）。

    ok       直连通（当前生效通路可用）
    degraded 直连不通、备用通路通，或生效通路可达但受限（401/403/429）
    down     所有测过的通路都不通
    unknown  从未探测 / 探测失败
    """
    direct = results.get("direct")
    others = [results.get(p) for p in ("mirror", "proxy")]
    working = [r for r in (direct, *others) if r and r.state == "ok"]
    measured = [r for r in (direct, *others) if r and r.state in ("ok", "blocked")]

    verdict = "unknown"
    if not measured:
        verdict = "unknown"
    elif not working:
        verdict = "down"
    elif direct is None or direct.state != "ok":
        verdict = "degraded"
    elif any(r.restricted for r in working):
        verdict = "degraded"
    else:
        verdict = "ok"

    res = SourceResult(
        source=source,
        label=label,
        verdict=verdict,
        paths=results,
        checked_at=time.time(),
    )
    return res


def probe_round(settings: dict | None = None) -> dict[str, SourceResult]:
    """探一轮全部源。并发 ≤ WORKERS，单轮整体不超过 ROUND_DEADLINE。"""
    settings = settings or load_settings()
    results: dict[str, SourceResult] = {}
    deadline = time.time() + ROUND_DEADLINE
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(_probe_source, name, settings): name for name in SOURCES}
        for future, name in futures.items():
            remaining = max(0.0, deadline - time.time())
            try:
                results[name] = future.result(timeout=remaining)
            except Exception:  # noqa: BLE001 —— 单源探针炸了不能拖垮整轮
                results[name] = SourceResult(source=name, verdict="unknown")
    return results


# ── 通路判定（规格 §3.6.2）─────────────────────────────────────
def _auto_path(results: dict[str, PathResult]) -> tuple[str, str]:
    """自动选通路：代理要快 20% 以上（吞吐比）才走代理，否则取最快的可用通路。

    判定式（规格 §3.6.2）：
        base   = max(direct_speed, mirror_speed)   未测通 / 未配置记 0
        走代理 ⟺ proxy_speed > 1.2 × base         base = 0 时只要代理测通就走代理
        否则   → 走 base 对应的那条

    返回 (path, 人话)。
    """
    direct = results.get("direct")
    mirror = results.get("mirror")
    proxy = results.get("proxy")

    def ok(r: PathResult | None) -> bool:
        return r is not None and r.state == "ok"

    def sp(r: PathResult | None) -> float:
        return float(r.speed_mbps or 0.0) if ok(r) else 0.0

    def lat(r: PathResult | None) -> int:
        return int(r.latency_ms or 0) if ok(r) else 1 << 30

    d_speed, m_speed, p_speed = sp(direct), sp(mirror), sp(proxy)
    base = max(d_speed, m_speed)

    if ok(proxy) and p_speed > 0 and p_speed > PROXY_GAIN * base:
        return "proxy", f"代理最快 {p_speed:g} MB/s（比另一条快 20% 以上）"

    usable = [(p, r) for p, r in (("direct", direct), ("mirror", mirror)) if ok(r)]
    if usable:
        measured = [(p, r, sp(r)) for p, r in usable if sp(r) > 0]
        if measured:
            top_speed = max(s for _, _, s in measured)
            top = [t for t in measured if t[2] >= top_speed - SPEED_TIE]
            # 吞吐几乎一样（≤ 0.1 MB/s）→ 取延迟更低的那条
            best = min(top, key=lambda t: lat(t[1])) if len(top) > 1 else top[0]
            path, _r, speed = best
            return path, f"{PATH_LABEL[path]}最快 {speed:g} MB/s"
        # 都通但都没测出吞吐 → 取延迟最低的那条
        path, _r = min(usable, key=lambda t: lat(t[1]))
        return path, f"{PATH_LABEL[path]}可用（没测出吞吐）"

    if ok(proxy):
        return "proxy", "直连与镜像都没通，只有代理能走"
    return "", "三条通路都不通"


def _path_available(results: dict[str, PathResult], path: str) -> bool:
    r = results.get(path)
    return bool(r and r.state == "ok")


def apply_policy(results: dict[str, SourceResult], settings: dict) -> None:
    """给每个源定下生效通路，并写好一句话结论。

    优先级：手动指定（download.path_override）> 自动判定。
    手动指定的通路对该站不可用时，回退到该站最快的可用通路并标 fallback。
    """
    override = str((settings.get("download") or {}).get("path_override") or "").strip().lower()
    for res in results.values():
        if res.verdict == "unknown":
            # 没探过：不选路也不门控，等后台探完再定
            res.path = ""
            res.path_text = "还没探过"
            res.fallback = False
            res.gated = False
            continue
        auto_path, auto_text = _auto_path(res.paths)
        chosen, text, fallback = auto_path, auto_text, False
        if res.verdict == "down":
            text = "三条通路都不通，该源被门控"
        if override in PATHS:
            if _path_available(res.paths, override):
                chosen, text = override, f"已指定走{PATH_LABEL[override]}"
            else:
                fallback = True
                if auto_path:
                    text = f"指定的{PATH_LABEL[override]}不可用，回退到{PATH_LABEL[auto_path]}"
                else:
                    text = f"指定的{PATH_LABEL[override]}不可用，且没有可用通路"
        res.path = chosen
        res.path_text = text
        res.fallback = fallback
        res.gated = res.verdict == "down" and not bool(
            ((settings.get("sources") or {}).get(res.source) or {}).get("always_enabled")
        )


def _global_strategy(results: dict[str, SourceResult]) -> dict:
    """全局汇总：把各站实测吞吐按通路求和，再走同一套 20% 门槛。"""
    sums = {"direct": 0.0, "mirror": 0.0, "proxy": 0.0}
    for res in results.values():
        for path in PATHS:
            r = res.paths.get(path)
            if r and r.state == "ok" and r.speed_mbps:
                sums[path] += float(r.speed_mbps)
    base = max(sums["direct"], sums["mirror"])
    measured_any = any(res.verdict != "unknown" for res in results.values())
    if sums["proxy"] > 0 and sums["proxy"] > PROXY_GAIN * base:
        chosen, text = "proxy", "默认走代理"
    elif base > 0:
        if sums["direct"] >= sums["mirror"]:
            chosen, text = "direct", "默认走直连"
        else:
            chosen, text = "mirror", "默认走镜像"
    elif sums["proxy"] > 0:
        chosen, text = "proxy", "默认走代理"
    else:
        chosen, text = "", ("不可用" if measured_any else "还没探过")
    return {
        "path": chosen,
        "text": text,
        "sums": {k: round(v, 2) for k, v in sums.items()},
    }


# ── 对外接口 ───────────────────────────────────────────────────
def _cached(source: str) -> SourceResult | None:
    with _cache_lock:
        entry = _cache.get(source)
        if not entry:
            return None
        expires, result = entry
        if time.time() > expires:
            _cache.pop(source, None)
            return None
        return result


def cached_result(source: str) -> SourceResult | None:
    """缓存里该源的最新结论。没有就是 None（= 没探过）。"""
    return _cached(source)


def route_for(source: str, settings: dict | None = None) -> tuple[str, bool]:
    """该源当前该走哪条通路 + 是不是回退。

    只读缓存，不发起探测 —— 探测是设置页的事，后台链路只消费结论。
    """
    settings = settings or load_settings()
    res = _cached(source)
    if res is None:
        return "", False
    apply_policy({source: res}, settings)
    return res.path, res.fallback


def _store(source: str, result: SourceResult) -> None:
    ttl = TTL_OK if result.verdict == "ok" else TTL_DEGRADED if result.verdict == "degraded" else TTL_DOWN
    if result.verdict == "unknown":
        ttl = TTL_DOWN  # 没探出结果也给个短 TTL，别让「未知」粘住太久
    with _cache_lock:
        _cache[source] = (time.time() + ttl, result)


def status(refresh: bool = False) -> dict:
    """全部源的最新结论 + 策略汇总。

    refresh=True 时强制重探一轮（手动「重新测试连通性」走这条）。
    冷却期内不重复打外网，直接回当前结论。
    """
    global _last_refresh

    settings = load_settings()
    now = time.time()
    cached = {name: _cached(name) for name in SOURCES}

    if refresh:
        if now - _last_refresh < COOLDOWN and all(cached.values()):
            pass  # 冷却期内：下面统一用缓存，不重复打外网
        else:
            _last_refresh = now
            fresh = probe_round(settings)
            for name, res in fresh.items():
                _store(name, res)
            cached = {name: _cached(name) for name in SOURCES}
    else:
        # 缺的源后台补探一轮：页面先显示「未探测」，下一轮就有读数
        missing = [name for name in SOURCES if cached.get(name) is None]
        if missing:
            threading.Thread(target=_background_probe, args=(missing,), daemon=True).start()

    results: dict[str, SourceResult] = {}
    for name in SOURCES:
        res = cached.get(name)
        if res is None:
            res = SourceResult(
                source=name,
                label=str(((settings.get("sources") or {}).get(name) or {}).get("label") or name),
                verdict="unknown",
                paths={
                    p: PathResult(path=p, state="unknown", skip="not_probed") for p in PATHS
                },
            )
        results[name] = res

    apply_policy(results, settings)
    global_strategy = _global_strategy(results)
    override = str((settings.get("download") or {}).get("path_override") or "").strip().lower()
    manual = override in PATHS
    if manual:
        strategy_text = f"已指定{PATH_LABEL[override]}"
    else:
        strategy_text = global_strategy["text"]

    summary = {"ok": 0, "degraded": 0, "down": 0, "unknown": 0}
    for res in results.values():
        summary[res.verdict] = summary.get(res.verdict, 0) + 1

    return {
        "sources": [results[name].to_dict() for name in SOURCES],
        "strategy": {
            "mode": "manual" if manual else "auto",
            "path": override if manual else global_strategy["path"],
            "text": strategy_text,
            "auto_path": global_strategy["path"],
            "auto_text": global_strategy["text"],
            "override": override,
        },
        "summary": summary,
        "cooldown": max(0.0, COOLDOWN - (now - _last_refresh)) if _last_refresh else 0.0,
    }


def _background_probe(names: list[str]) -> None:
    """后台补探缺失的源。失败一律落 unknown，绝不把异常穿透。"""
    try:
        settings = load_settings()
        for name in names:
            lock = _lock_for(name)
            if not lock.acquire(blocking=False):
                continue
            try:
                if _cached(name) is not None:
                    continue
                res = _probe_source(name, settings)
                _store(name, res)
            except Exception:  # noqa: BLE001
                _store(name, SourceResult(source=name, verdict="unknown"))
            finally:
                lock.release()
    except Exception:  # noqa: BLE001
        return


def refresh() -> dict:
    """手动重探一轮（前端「重新测试连通性」）。"""
    return status(refresh=True)
