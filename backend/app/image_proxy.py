"""封面图代理：浏览器不出网也能拿到 Civitai / ModelScope / HF 的封面。

为什么要这一层：
- `image.civitai.com` 在本机直连超时，只有经代理才通（实测 301 → blobs-b2 → 200）；
  而 `<img>` 是浏览器自己发请求的，后端「元数据走代理」管不到它。
- 浏览器不开 TUN / 系统代理时，卡片就只能退回家族铭牌 —— 看起来像「封面是空的」。
- 顺带得到磁盘缓存：翻页、切主题、重进页面都不再重复下原图。

安全边界（这是个「服务端替客户端取 URL」的接口，必须收紧）：
- 只放行写死的主机后缀，不对任意 URL 开放；
- 跟随重定向后再校验**最终**主机，防止被 302 到别处；
- 只接受 `image/*`，单张上限 15 MB；
- 只发 GET，不带任何请求头里的凭据。
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import httpx

from .config import DATA_DIR, load_settings, source_proxy

CACHE_DIR = DATA_DIR / "cover-cache"
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


class CoverError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


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


def _cache_path(url: str, ext: str) -> Path:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}{ext}"


def _find_cached(url: str) -> tuple[Path, str] | None:
    """同一 URL 的缓存。扩展名不确定时逐个试，命中即返回。"""
    for media, ext in EXT_BY_TYPE.items():
        p = _cache_path(url, ext)
        if p.exists() and p.stat().st_size > 0:
            return p, media
    return None


def _proxy_for(url: str) -> str | None:
    host = _host_of(url)
    source = _source_for(host)
    if not source:
        return None
    cfg = (load_settings().get("sources") or {}).get(source) or {}
    return source_proxy(cfg)


def get(url: str) -> tuple[Path, str]:
    """取一张封面，返回 (本地文件, MIME)。命中缓存不发请求。"""
    if not url:
        raise CoverError("缺少图片地址")
    host = _host_of(url)
    if not _allowed(host):
        raise CoverError(f"不允许的图片主机: {host}", status=403)

    if (hit := _find_cached(url)) is not None:
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

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dest = _cache_path(url, ext)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_bytes(bytes(buf))
    tmp.replace(dest)
    return dest, media
