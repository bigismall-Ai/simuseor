"""封面图代理：浏览器不出网也能拿到 Civitai / ModelScope / HF 的封面。

为什么要这一层：
- `image.civitai.com` 在本机直连超时，只有经代理才通（实测 301 → blobs-b2 → 200）；
  而 `<img>` 是浏览器自己发请求的，后端「元数据走代理」管不到它。
- 浏览器不开 TUN / 系统代理时，卡片就只能退回家族铭牌 —— 看起来像「封面是空的」。

存在哪：`var/tmp/cover-cache/`（**不是** var/data）。
  var/data 是「删了不可恢复、必须备份」的那一层；封面属于可重下的派生数据，
  放进去只会让备份白白多出几百 MB。var/tmp 本来就是临时区。

缓存策略：
- 文件名 = URL 的 sha1 + 扩展名（同一张图只存一份，换排序/翻页不会重复下）；
- `index.json` 记录每张图的 url / 类型 / 大小 / 取图时间 / 命中次数；
- 容量不设硬上限（封面是 35 KB 级别，一万张约 350 MB），但统计接口能看占用；
- 清理：`POST /api/cover/clear`，或直接删掉整个目录。

安全边界（这是个「服务端替客户端取 URL」的接口，必须收紧）：
- 只放行写死的主机后缀，不对任意 URL 开放；
- 跟随重定向后再校验**最终**主机，防止被 302 到别处；
- 只接受 `image/*`，单张上限 15 MB；
- 只发 GET，不带任何请求头里的凭据。
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path

import httpx

from .config import TMP_DIR, load_settings, source_proxy

CACHE_DIR = TMP_DIR / "cover-cache"
MAX_BYTES = 15 * 1024 * 1024
TIMEOUT = 20.0

# 允许的目标主机后缀（含各自的图床/CDN）
ALLOWED_SUFFIX = (
    "civitai.com",
    "civitai.red",
    "modelscope.cn",
    "huggingface.co",
    "hf.co",
    "hf-mirror.com",
)

# 主机 → 该用哪个源的代理设置
SOURCE_BY_SUFFIX = (
    ("civitai.com", "civitai"),
    ("civitai.red", "civitai"),
    ("modelscope.cn", "modelscope"),
    ("huggingface.co", "huggingface"),
    ("hf.co", "huggingface"),
    ("hf-mirror.com", "huggingface"),
)

EXT_BY_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
}

_LOCK = threading.Lock()
_index: dict | None = None
_last_flush = 0.0
_pending = 0


class CoverError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


# ---------------- 索引 ----------------
def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _index_path() -> Path:
    return CACHE_DIR / "index.json"


def _load_index() -> dict:
    global _index
    if _index is None:
        try:
            data = json.loads(_index_path().read_text("utf-8"))
        except (OSError, ValueError):
            data = {}
        if not isinstance(data.get("entries"), dict):
            data = {"version": 1, "entries": {}}
        _index = data
    return _index


def _flush(force: bool = False) -> None:
    """索引落盘。命中很频繁，所以按时间节流，避免每张图都重写 JSON。"""
    global _last_flush, _pending
    if not force and _pending < 8 and time.time() - _last_flush < 5:
        return
    data = _load_index()
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = _index_path().with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
        tmp.replace(_index_path())
    except OSError:
        return  # 索引写失败不影响出图
    _last_flush = time.time()
    _pending = 0


def _digest(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()


def _cache_path(digest: str, ext: str) -> Path:
    return CACHE_DIR / f"{digest}{ext}"


def _find_cached(url: str) -> tuple[Path, str] | None:
    digest = _digest(url)
    entry = _load_index()["entries"].get(digest)
    if entry:
        path = CACHE_DIR / entry["file"]
        if path.exists() and path.stat().st_size > 0:
            return path, entry["media"]
    # 索引丢了但文件还在（手动拷过目录）：按扩展名找回来
    for media, ext in EXT_BY_TYPE.items():
        path = _cache_path(digest, ext)
        if path.exists() and path.stat().st_size > 0:
            return path, media
    return None


def _touch(url: str) -> None:
    global _pending
    entry = _load_index()["entries"].get(_digest(url))
    if not entry:
        return
    entry["hits"] = int(entry.get("hits") or 0) + 1
    entry["last"] = _now()
    _pending += 1
    _flush()


def _record(url: str, path: Path, media: str, size: int) -> None:
    entries = _load_index()["entries"]
    entries[_digest(url)] = {
        "url": url,
        "file": path.name,
        "media": media,
        "bytes": size,
        "at": _now(),
        "hits": 0,
        "last": _now(),
    }
    _flush(force=True)


# ---------------- 校验 ----------------
def _host_of(url: str) -> str:
    try:
        parsed = httpx.URL(url)
    except Exception as exc:  # noqa: BLE001
        raise CoverError("地址无法解析") from exc
    if parsed.scheme not in ("http", "https"):
        raise CoverError("只支持 http/https 图片地址")
    return (parsed.host or "").lower()


def _allowed(host: str) -> bool:
    return any(host == s or host.endswith("." + s) for s in ALLOWED_SUFFIX)


def _source_for(host: str) -> str | None:
    for suffix, source in SOURCE_BY_SUFFIX:
        if host == suffix or host.endswith("." + suffix):
            return source
    return None


def _proxy_for(url: str) -> str | None:
    source = _source_for(_host_of(url))
    if not source:
        return None
    cfg = (load_settings().get("sources") or {}).get(source) or {}
    return source_proxy(cfg)


# ---------------- 取图 ----------------
def get(url: str) -> tuple[Path, str]:
    """取一张封面，返回 (本地文件, MIME)。命中缓存不发请求。"""
    if not url:
        raise CoverError("缺少图片地址")
    host = _host_of(url)
    if not _allowed(host):
        raise CoverError(f"不允许的图片主机: {host}", status=403)

    if (hit := _find_cached(url)) is not None:
        _touch(url)
        return hit

    proxy = _proxy_for(url)
    try:
        with httpx.Client(
            timeout=TIMEOUT, follow_redirects=True, proxy=proxy,
            headers={"User-Agent": "model-downloader/0.1"},
        ) as client:
            with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    raise CoverError(f"上游返回 {resp.status_code}", status=502)
                final_host = (resp.url.host or "").lower()
                if not _allowed(final_host):
                    raise CoverError(f"重定向到了不允许的主机: {final_host}", status=502)
                media = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                if not media.startswith("image/"):
                    raise CoverError(f"不是图片（{media or '未知类型'}）", status=502)
                ext = EXT_BY_TYPE.get(media)
                if not ext:
                    raise CoverError(f"不支持的图片格式: {media}", status=502)

                buf = bytearray()
                for chunk in resp.iter_bytes():
                    buf.extend(chunk)
                    if len(buf) > MAX_BYTES:
                        raise CoverError("图片超过 15 MB 上限", status=502)
                if not buf:
                    raise CoverError("上游返回空图", status=502)
    except CoverError:
        raise
    except httpx.HTTPError as exc:
        raise CoverError(f"取图失败: {exc}", status=502) from exc

    with _LOCK:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        dest = _cache_path(_digest(url), ext)
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(bytes(buf))
        tmp.replace(dest)
        _record(url, dest, media, len(buf))
    return dest, media


# ---------------- 统计 / 清理 ----------------
def stats() -> dict:
    """给设置页/接口看的：有多少张、占多大、最近取了什么。"""
    entries = list(_load_index()["entries"].values())
    files = [e for e in entries if (CACHE_DIR / e.get("file", "")).exists()]
    total = sum(int(e.get("bytes") or 0) for e in files)
    latest = max((e.get("last") or e.get("at") or "" for e in files), default="")
    return {
        "dir": str(CACHE_DIR),
        "count": len(files),
        "bytes": total,
        "latest": latest,
    }


def clear() -> dict:
    """清空封面缓存（文件 + 索引）。返回删了多少。"""
    global _index, _pending
    with _LOCK:
        removed = 0
        freed = 0
        if CACHE_DIR.exists():
            for path in CACHE_DIR.iterdir():
                if not path.is_file():
                    continue
                try:
                    size = path.stat().st_size
                    path.unlink()
                    removed += 1
                    freed += size
                except OSError:
                    continue
        _index = {"version": 1, "entries": {}}
        _pending = 0
        _flush(force=True)
    return {"removed": removed, "bytes": freed, "dir": str(CACHE_DIR)}
