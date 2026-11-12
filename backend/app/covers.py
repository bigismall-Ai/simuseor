"""模型封面：兜底铭牌之外，按「魔搭 → Hugging Face → Civitai」依次取真实图。

为什么是这个顺序：魔搭和 HF 的列表接口都不带图，必须再打一次详情；魔搭详情
便宜（~0.3 s / 11 KB）、HF 贵（~1.5 s），所以能命中魔搭就不再打 HF。Civitai 的
图在搜索响应里已经有了，放最后只兜「前两家都没有」的情况，多数时候一次请求都不用。

取不到就是取不到——返回空串，前端继续用家族铭牌。**不要拿平台生成的分享卡
（`cdn.modelscope.cn/social-thumbnails/*`、HF 的 social-thumbnails）冒充封面**：
那是带平台 logo 的紫色文字卡片，铺到卡片上既重复模型名又明显是占位。

结果落盘到 `var/data/covers.json`：命中记 7 天，未命中记 6 小时。没命中的也要
记，否则每次进发现页都会把没有封面的那批模型重新问一遍。
"""
from __future__ import annotations

import json
import threading
import time

import httpx

from .config import DATA_DIR
from .sources.civitai import pick_cover

COVERS_PATH = DATA_DIR / "covers.json"

# 前端按这个顺序取第一个有图的来源；后端解析也按它逐级尝试
PREFERENCE = ("modelscope", "huggingface", "civitai")

TTL_HIT = 7 * 24 * 3600
TTL_MISS = 6 * 3600
MAX_ENTRIES = 4000

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")
# 文件名像封面的排前面：真封面基本都叫这些
COVER_WORDS = ("teaser", "cover", "preview", "gallery", "grid", "thumbnail", "banner", "hero", "demo", "sample")
# 明确不是封面的：logo / 徽章 / 示意图
NOISE_WORDS = ("logo", "icon", "badge", "favicon")

_lock = threading.Lock()
_store: dict[str, dict] | None = None
_dirty = False


def _load() -> dict[str, dict]:
    global _store
    if _store is not None:
        return _store
    try:
        _store = json.loads(COVERS_PATH.read_text("utf-8"))
        if not isinstance(_store, dict):
            _store = {}
    except (OSError, ValueError):
        _store = {}
    return _store


def _flush() -> None:
    """整表写回。条目上限 4000（≈400 KB），比每次 append 简单且不会写出半截 JSON。"""
    global _dirty
    if not _dirty or _store is None:
        return
    _dirty = False
    try:
        COVERS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = COVERS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(_store, ensure_ascii=False), "utf-8")
        tmp.replace(COVERS_PATH)
    except OSError:
        pass  # 缓存写不进去不该让请求失败


def _cached(key: str) -> str | None:
    with _lock:
        hit = _load().get(key)
    if not hit:
        return None
    url = hit.get("url") or ""
    ttl = TTL_HIT if url else TTL_MISS
    if time.time() - float(hit.get("ts") or 0) > ttl:
        return None
    return url


def _remember(key: str, url: str) -> str:
    global _dirty
    with _lock:
        store = _load()
        store[key] = {"url": url, "ts": time.time()}
        if len(store) > MAX_ENTRIES:
            # 按时间淘汰最旧的 10%，避免每加一条都排序
            for old in sorted(store, key=lambda k: store[k].get("ts") or 0)[: MAX_ENTRIES // 10]:
                store.pop(old, None)
        _dirty = True
    _flush()
    return url


def _get_json(url: str, cfg: dict, timeout: float = 10.0) -> dict:
    """和搜索一样直连：代理只作用于下载（aria2），给 API 也套代理会和设置页的语义冲突。"""
    headers = {"User-Agent": "model-downloader/0.1"}
    token = (cfg or {}).get("token") or ""
    if token and "civitai" in url:
        headers["Authorization"] = f"Bearer {token}"
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        resp = client.get(url)
        if resp.status_code >= 400:
            return {}
        return resp.json()


def _sized(url: str) -> str:
    """给魔搭封面加 OSS 缩放参数。

    `resources.modelscope.cn` 是阿里云 OSS，原图动辄 2.5 MB（实测 FLUX.2-klein
    那张 PNG 2519299 字节）。同一条 URL 加 `?x-oss-process=image/resize,w_640/
    format,jpg` 之后是 145 KB —— 卡面 266px，640 已经够 2 倍屏，没必要拉原图。
    """
    if "modelscope.cn" not in url or "x-oss-process" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}x-oss-process=image/resize,w_640/format,jpg"


def _modelscope(repo_id: str, cfg: dict) -> str:
    """魔搭把封面挂在版本上：`data.versions[].sample_images[].url`。"""
    data = _get_json(f"https://modelscope.cn/openapi/v1/models/{repo_id}", cfg).get("data") or {}
    for version in data.get("versions") or []:
        for image in version.get("sample_images") or []:
            url = image.get("url") or ""
            if url:
                return _sized(url)
    return ""


def _hf_pick(paths: list[str]) -> str:
    best, best_score = "", 99
    for path in paths:
        low = path.lower()
        if not low.endswith(IMAGE_EXT):
            continue
        name = low.rsplit("/", 1)[-1]
        if any(w in name for w in NOISE_WORDS):
            continue
        if any(w in name for w in COVER_WORDS):
            score = 0
        elif "/" not in low:  # 根目录的图更像封面，assets/ 里多是图集
            score = 1
        else:
            score = 2
        if score < best_score:
            best, best_score = path, score
    return best


def _huggingface(repo_id: str, cfg: dict) -> str:
    """HF 列表接口没有图，只能拉 `full=true` 看 siblings 里有没有图片文件。"""
    data = _get_json(f"https://huggingface.co/api/models/{repo_id}?full=true", cfg)
    files = [s.get("rfilename") or "" for s in data.get("siblings") or []]
    name = _hf_pick(files)
    return f"https://huggingface.co/{repo_id}/resolve/main/{name}" if name else ""


def _civitai(model_id: str, cfg: dict) -> str:
    if not str(model_id).isdigit():
        return ""
    params = "?nsfw=true" if (cfg or {}).get("full_catalog") else ""
    data = _get_json(f"https://civitai.com/api/v1/models/{model_id}{params}", cfg)
    return pick_cover(data.get("modelVersions") or [], bool((cfg or {}).get("full_catalog")))


_RESOLVERS = {"modelscope": _modelscope, "huggingface": _huggingface, "civitai": _civitai}


def resolve(source: str, repo_id: str, cfg: dict) -> str:
    key = f"{source}:{repo_id}"
    hit = _cached(key)
    if hit is not None:
        return hit
    resolver = _RESOLVERS.get(source)
    if resolver is None:
        return ""
    try:
        return _remember(key, resolver(repo_id, cfg) or "")
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return ""  # 网络抖动不写缓存，下次还会再试


def resolve_group(items: list[dict], settings: dict) -> str:
    """一组同源/跨源的条目，按 PREFERENCE 逐级取图，第一个命中就停。"""
    by_source: dict[str, dict] = {}
    for item in items:
        by_source.setdefault(item.get("source") or "", item)
    for source in PREFERENCE:
        item = by_source.get(source)
        if not item:
            continue
        # Civitai 的图搜索响应里已经带了，直接用，省一次 2.5 s 的详情请求
        if source == "civitai" and item.get("image"):
            return item["image"]
        cfg = (settings.get("sources") or {}).get(source) or {}
        url = resolve(source, item.get("id") or "", cfg)
        if url:
            return url
    return ""
