"""本地热力榜：三个发现页的首屏数据，落盘 + 后台刷新。

**为什么需要它**：`warm_discover` 只预热进程内缓存，进程一重启就清零 ——
第一个进发现页的人还是要把那一轮网络完整跑一遍（模型页 3.5s、工作流页 6 个源
并发 2~4s、节点页首次 5 分钟）。热力榜把「首屏那一份聚合结果」落盘，
重启后先读盘顶住，后台再换新。思路和 `workflows._index_cache` 一致，
区别是它缓存原始索引，这里缓存聚合后的首屏 payload。

**只覆盖「首屏默认参数」这一份**：q 为空 + 默认排序 + page=1。
搜索词一旦不空，组合无限、命中率极低，缓存它没有意义，不如实打实去查。

**数据新鲜度**：过期后不阻塞请求 —— 先把旧数据给出去，同时后台刷新。
拿旧数据换一次秒开，比让人盯着转圈等「最新」划算得多。
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .config import DATA_DIR

HOT_DIR = DATA_DIR / "hot"

# 榜的刷新间隔。节点清单变化最慢（按天），工作流与模型按 6 小时。
# 都是「后台刷新」的间隔，不影响请求：过期只是触发换新，不阻塞。
TTL_NODES = 24 * 3600
TTL_DEFAULT = 6 * 3600


@dataclass(frozen=True)
class BoardSpec:
    name: str
    ttl: float
    defaults: dict[str, Any]
    build: Callable[[], dict]


_BOARDS: dict[str, BoardSpec] = {}
_MEM: dict[str, tuple[float, dict]] = {}  # name -> (落盘时间戳, payload)
_LOCK = threading.Lock()
_REFRESHING: set[str] = set()
# 正在构建中的榜。build() 内部会调到同一个路由函数（例如 search_models），
# 若不禁用命中判断，它会读到旧数据并原样写回 —— 刷新等于没刷。
_BUILDING: set[str] = set()


def register(name: str, ttl: float, defaults: dict[str, Any], build: Callable[[], dict]) -> None:
    """登记一个榜。`build` 必须返回可直接序列化成 JSON 的 dict（就是接口的 payload）。"""
    _BOARDS[name] = BoardSpec(name, ttl, defaults, build)


def matches(name: str, **params: Any) -> bool:
    """判断这次请求是不是「首屏默认参数」。不是就走实时查询。"""
    spec = _BOARDS.get(name)
    if spec is None:
        return False
    with _LOCK:
        if name in _BUILDING:
            return False  # 正在刷新它，这次请求走实时，别把旧数据当新数据写回去
    for key, expect in spec.defaults.items():
        got = params.get(key, expect)
        # 前端把 limit 传成 "20" 也认
        if str(got) != str(expect):
            return False
    return True


def get(name: str) -> dict | None:
    """取榜数据：内存 → 磁盘。过期不阻塞，返回旧数据并让后台去换新。"""
    spec = _BOARDS.get(name)
    if spec is None:
        return None

    with _LOCK:
        hit = _MEM.get(name)

    if hit is None:
        hit = _read_disk(name)

    if hit is None:
        return None

    stamp, payload = hit
    if time.time() - stamp > spec.ttl:
        _refresh_async(name)
    return payload


def _path(name: str) -> Path:
    """榜名可能带冒号（如 models:huggingface），而 Windows 文件名不允许冒号 ——
    直接拼会写到一个截断的怪名字上，读的时候又找不到。统一换成横杠。"""
    return HOT_DIR / f"{name.replace(':', '-').replace('/', '-')}.json"


def _read_disk(name: str) -> tuple[float, dict] | None:
    path = _path(name)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        payload = raw.get("payload")
        stamp = float(raw.get("generated_ts") or 0)
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict) or not payload:
        return None
    with _LOCK:
        _MEM[name] = (stamp, payload)
    return stamp, payload


def _write_disk(name: str, payload: dict, stamp: float, meta: dict | None = None) -> None:
    """原子写：先写临时文件再 replace，半截文件不会顶替掉好数据。"""
    path = _path(name)
    tmp = path.with_name(path.name + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(
            json.dumps(
                {"generated_ts": stamp, "meta": meta or {}, "payload": payload},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        tmp.replace(path)
    except OSError:
        pass


def refresh(name: str) -> bool:
    """同步刷新一个榜。失败时**保留旧数据**（宁可用旧的不让页面空着）。"""
    spec = _BOARDS.get(name)
    if spec is None:
        return False
    with _LOCK:
        if name in _BUILDING:
            return False
        _BUILDING.add(name)
    try:
        payload = spec.build()
    except Exception:  # noqa: BLE001 —— 网络抖动是常态，不能把首屏一起拖挂
        return False
    finally:
        with _LOCK:
            _BUILDING.discard(name)
    if not isinstance(payload, dict) or not payload:
        return False

    # 榜是给首屏看的：抓取时某个源偶发失败，不该固化进快照 ——
    # 否则接下来 6 小时里每个进页面的人都看到一条「GitHub 超时」横幅，
    # 而他手里的列表其实是完整的（旧数据）。把 errors 挪进文件的 meta，
    # 只给诊断看，不随 payload 返回。
    stored = {k: v for k, v in payload.items() if k != "errors"}
    meta = {"errors": payload.get("errors") or {}}

    stamp = time.time()
    with _LOCK:
        _MEM[name] = (stamp, stored)
    _write_disk(name, stored, stamp, meta)
    return True


def _refresh_async(name: str) -> None:
    """后台换新。同一时刻只允许一个刷新在跑，避免请求高峰时起一堆线程。"""
    with _LOCK:
        if name in _REFRESHING:
            return
        _REFRESHING.add(name)

    def work() -> None:
        try:
            refresh(name)
        finally:
            with _LOCK:
                _REFRESHING.discard(name)

    threading.Thread(target=work, name=f"hot-refresh-{name}", daemon=True).start()


def warm_all() -> None:
    """启动时调用：把盘上的榜装进内存；没有或过期的，后台去抓。

    这样后端一起来，第一个进发现页的人读的就是磁盘（毫秒），
    同时后台已经在准备最新的一份。
    """
    if not _BOARDS:
        return
    now = time.time()
    for name, spec in _BOARDS.items():
        hit = _read_disk(name)
        if hit is None:
            _refresh_async(name)
        elif now - hit[0] > spec.ttl:
            _refresh_async(name)


def status() -> dict[str, dict]:
    """给设置页/诊断用：每个榜有没有数据、多久前生成的。"""
    out: dict[str, dict] = {}
    now = time.time()
    for name, spec in _BOARDS.items():
        with _LOCK:
            hit = _MEM.get(name)
        if hit is None:
            hit = _read_disk(name)
        out[name] = {
            "has_data": hit is not None,
            "age_seconds": int(now - hit[0]) if hit else None,
            "ttl": int(spec.ttl),
            "stale": (now - hit[0] > spec.ttl) if hit else True,
        }
    return out
