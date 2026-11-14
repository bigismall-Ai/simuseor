"""工作流封面：先找本地，再去社区找。

设计文档第五节的取图优先级，这里落前三层（第四层家族铭牌由前端兜底）：

1. **工作流自带出图** —— `extra.preview` 的 data URI，或同目录同名 / preview 图；
2. **社区里这条工作流的条目** —— Civitai `types=Workflows` 搜同名工作流，它的样图
   就是「这条工作流跑出来的样子」，比底模的样图贴切得多；
3. **底模的样图池 + 去重分配** —— 同一底模被三条工作流引用时，三条卡不能长一样
   （陈列架摆三件同样的展品）。池子里逐条发牌，发过的跳过。

**宁可没有封面，也不要错的封面。** 按名字搜出来的结果必须和工作流名有至少两个
token 重合才采用 —— 搜「人像高清修复」返回一堆无关模型，贴上去比空白更糟。

结果落盘 `var/data/workflow_covers.json`：命中记 7 天、未命中记 6 小时。没命中的
也要记，否则每次进页面都把没有封面的那批重新问一遍。
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .config import DATA_DIR, WORKSPACE_PREVIEWS_DIR, WORKSPACE_WORKFLOWS_DIR, load_settings

COVERS_PATH = DATA_DIR / "workflow_covers.json"
BLOB_DIR = DATA_DIR / "wf-covers"

CIVITAI_API = "https://civitai.com/api/v1/models"
TTL_HIT = 7 * 24 * 3600
TTL_MISS = 6 * 3600
MAX_ENTRIES = 2000
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
# 卡面 16:10，取图按这个比例打分为主（和模型封面同一口径）
COVER_RATIO = 16 / 10
# 横向超过这个比例的图基本是「三联转面图 / LoRA 对比图 / 画布截图拼接」，
# 裁到卡面上只剩碎片，宁可不要 —— 它们恰恰最容易被比例打分排到前面。
MAX_ASPECT = 2.2
MATURE_PENALTY = 1.2
# 用户自己传的图：8MB 足够一张封面，太大只会拖慢列表
MAX_CUSTOM_BYTES = 8 * 1024 * 1024
_CUSTOM_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_CUSTOM_MAGIC = {
    ".png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    ".jpg": lambda b: b.startswith(b"\xff\xd8\xff"),
    ".webp": lambda b: b.startswith(b"RIFF") and b[8:12] == b"WEBP",
    ".gif": lambda b: b.startswith((b"GIF87a", b"GIF89a")),
}

# 工作流名字里的通用词：不参与匹配，也不该拿去当搜索词
_STOP = {
    "comfyui", "workflow", "workflows", "json", "api", "ui", "v1", "v2", "v3",
    "workflow_", "copy", "final", "test", "new", "basic", "simple", "demo",
    "gen", "generation", "template", "default", "my", "the", "and",
}

# 量化 / 精度后缀：搜底模样图时要先剔掉，否则 `flux1-dev-fp8` 搜不到任何东西。
# 用前后向断言而不是吃掉分隔符 —— 吃掉了下一个词就丢边界，`int8_convrot` 只会剔掉前一个。
_QUANT = re.compile(
    r"(?<![a-z0-9])(int[48]|uint[48]|fp[48]|fp16|bf16|fp32|f16|f32|q[2-8](?:_k)?(?:_[sml])?"
    r"|gguf|safetensors|sft|ckpt|pt|pth|bin|onnx|convrot|pruned|distill(?:ed)?|turbo|lightning)(?![a-z0-9])",
    re.I,
)
_TOKEN = re.compile(r"[a-z0-9]+")

_lock = threading.Lock()
_store: dict | None = None
_dirty = False
# 封面管理画廊最近一次发给前端的候选，choose() 只认这里面的 URL，
# 避免把任意外链写进 pinned。进程内即可：重开弹层会重新发一批。
_cand_lock = threading.Lock()
_CANDIDATES: dict[str, list[str]] = {}


# ---------------------------------------------------------------- 缓存

def _load() -> dict:
    global _store
    if _store is not None:
        return _store
    try:
        data = json.loads(COVERS_PATH.read_text("utf-8"))
        _store = data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        _store = {}
    _store.setdefault("seen", {})
    _store.setdefault("pools", {})
    _store.setdefault("pinned", {})
    return _store


def _flush() -> None:
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


def _remember(key: str, url: str, origin: str = "") -> str:
    global _dirty
    with _lock:
        store = _load()
        seen = store["seen"]
        seen[key] = {"url": url, "ts": time.time(), "origin": origin}
        if len(seen) > MAX_ENTRIES:
            for old in sorted(seen, key=lambda k: seen[k].get("ts") or 0)[: MAX_ENTRIES // 10]:
                seen.pop(old, None)
        _dirty = True
    _flush()
    return url


def pin(key: str, url: str, source: str = "manual") -> None:
    """手动挑的封面钉在这个键上，优先级高于本地出图与自动抽牌。

    `source` 区分「换一张自动抽的」与「用户自己给的自定义图」，界面要分开说明。
    """
    if not key or not url:
        return
    global _dirty
    with _lock:
        _load()["pinned"][key] = {"url": url, "ts": time.time(), "source": source}
        _dirty = True
    _flush()


def pin_source(key: str) -> str:
    """这条封面是怎么来的：custom / manual / 空（没有钉图）。"""
    with _lock:
        entry = _load()["pinned"].get(key)
    if not isinstance(entry, dict):
        return ""
    return str(entry.get("source") or "manual")


def custom_keys() -> list[str]:
    with _lock:
        return [k for k, v in _load()["pinned"].items() if isinstance(v, dict) and v.get("source") == "custom"]


def unpin(key: str) -> bool:
    global _dirty
    with _lock:
        if _load()["pinned"].pop(key, None) is None:
            return False
        _dirty = True
    _flush()
    return True


def restore_auto(key: str) -> bool:
    """恢复自动封面：钉图和「换一张」写进自动缓存的结果一起清掉。

    只 unpin 的话，seen 里还留着用户刚换掉的那张，刷新后又会回来 ——
    看起来就像「恢复自动」没生效。
    """
    return forget(key)


def pinned(key: str) -> str:
    with _lock:
        entry = _load()["pinned"].get(key)
    return str((entry or {}).get("url") or "") if isinstance(entry, dict) else ""


def pinned_keys() -> list[str]:
    with _lock:
        return list(_load()["pinned"])


def reset_cache() -> None:
    """测试用：丢掉内存缓存。"""
    global _store, _dirty
    with _lock:
        _store = None
        _dirty = False


def rename_key(old: str, new: str) -> bool:
    """文件改名 / 移动后，把封面缓存搬到新键上。

    缓存是按「相对目录的路径」索引的：改个名字键就变了，于是重新抽一张牌，
    用户看到的是「我只改了个文件名，封面怎么换了」。键可以跟着文件走，
    图上那张画为什么要换。
    """
    if not old or not new or old == new:
        return False
    global _dirty
    with _lock:
        store = _load()
        entry = store["seen"].pop(old, None)
        pinned_entry = store["pinned"].pop(old, None)
        if not isinstance(entry, dict) and pinned_entry is None:
            return False
        if isinstance(entry, dict):
            store["seen"][new] = entry
        if pinned_entry is not None:
            store["pinned"][new] = pinned_entry
        _dirty = True
    _flush()
    return True


def forget(key: str) -> bool:
    """删掉工作流时顺手清掉它的封面缓存与手动钉图，别让死键占着配额。"""
    if not key:
        return False
    global _dirty
    with _lock:
        store = _load()
        hit = store["seen"].pop(key, None)
        manual = store["pinned"].pop(key, None)
        if hit is None and manual is None:
            return False
        _dirty = True
    _flush()
    return True


# ---------------------------------------------------------------- 本地封面

def _served(path: Path) -> str:
    """本地图交给后端端点吐，前端只拿 URL（工作流目录不在 web 根下）。"""
    return f"/api/workflows/local/cover?path={path.as_posix()}"


def _data_uri_blob(payload: str) -> str:
    """`extra.preview` 里的 data URI 存成文件再 serve —— 别把整段 base64 塞进 JSON。"""
    try:
        head, _, body = payload.partition(",")
        if ";base64" not in head or not body:
            return ""
        raw = base64.b64decode(body, validate=False)
        if len(raw) < 256:
            return ""
        ext = ".png"
        if "image/jpeg" in head:
            ext = ".jpg"
        elif "image/webp" in head:
            ext = ".webp"
        BLOB_DIR.mkdir(parents=True, exist_ok=True)
        target = BLOB_DIR / f"{hashlib.sha256(raw).hexdigest()[:20]}{ext}"
        if not target.is_file():
            target.write_bytes(raw)
        return _served(target)
    except (ValueError, OSError):
        return ""


def _custom_blob(data_uri: str) -> str:
    """上传的图片存成内容寻址的本地文件，返回一个后端 serve 的 URL。

    只认 base64 data URI，且按魔数而不是扩展名验图片 —— 用户改个后缀
    就把 HTML 塞进封面目录这种事不能发生。
    """
    head, _, body = data_uri.strip().partition(",")
    if not head.startswith("data:image/") or ";base64" not in head or not body:
        raise ValueError("图片格式不对，请重新选一张 png / jpg / webp / gif")
    mime = head[len("data:"):].split(";", 1)[0].strip().lower()
    ext = _CUSTOM_MIME.get(mime)
    if not ext:
        raise ValueError("只支持 png / jpg / webp / gif 图片")
    try:
        raw = base64.b64decode(body, validate=False)
    except ValueError as exc:
        raise ValueError("图片内容不是合法的 base64") from exc
    if len(raw) < 128:
        raise ValueError("图片太小了，不像一张封面")
    if len(raw) > MAX_CUSTOM_BYTES:
        raise ValueError("图片超过 8MB，请压缩后再传")
    if not _CUSTOM_MAGIC[ext](raw):
        raise ValueError("图片内容和格式对不上")
    BLOB_DIR.mkdir(parents=True, exist_ok=True)
    target = BLOB_DIR / f"custom-{hashlib.sha256(raw).hexdigest()[:20]}{ext}"
    if not target.is_file():
        target.write_bytes(raw)
    return _served(target)


def _custom_url(url: str) -> str:
    """外链图片只放行 http(s)，堵掉 javascript: / file: / 带账号密码的地址。"""
    text = url.strip()
    if len(text) > 2048:
        raise ValueError("图片地址太长了")
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("图片地址要以 http:// 或 https:// 开头")
    if parsed.username or parsed.password:
        raise ValueError("图片地址里不能带账号密码")
    return text


def set_custom(key: str, url: str = "", data: str = "") -> str:
    """用户自己指定封面：钉住，来源标成 custom（区别于自动换的一张）。"""
    key = (key or "").strip()
    if not key:
        raise ValueError("缺少工作流标识")
    final = _custom_blob(data) if (data or "").strip() else _custom_url(url or "")
    pin(key, final, source="custom")
    return final


def _sibling_image(folder: Path, stem: str) -> Path | None:
    """同目录同名图优先，其次 preview / cover / thumbnail 这类通用名。"""
    for ext in IMAGE_EXT:
        cand = folder / f"{stem}{ext}"
        if cand.is_file():
            return cand
    try:
        entries = sorted(folder.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        return None
    for path in entries:
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXT:
            continue
        low = path.stem.lower()
        if low.startswith(("preview", "cover", "thumbnail", "teaser", "banner", "hero")):
            return path
    return None


def local_cover(path: str, payload: dict | None = None) -> str:
    """工作流自带出图。没有就返回空串 —— 空串不代表「没有封面」，只是本地没有。"""
    file = Path(path)
    if isinstance(payload, dict):
        extra = payload.get("extra")
        if isinstance(extra, dict):
            preview = extra.get("preview")
            if isinstance(preview, str) and preview.startswith("data:image/"):
                url = _data_uri_blob(preview)
                if url:
                    return url
    found = _sibling_image(file.parent, file.stem)
    return _served(found) if found else ""


def serve_file(path: str) -> Path:
    """校验并返回要吐的本地图。只允许工作流目录与预览目录里的文件。"""
    target = Path(path).resolve()
    for root in (WORKSPACE_WORKFLOWS_DIR.resolve(), WORKSPACE_PREVIEWS_DIR.resolve(), BLOB_DIR.resolve()):
        try:
            target.relative_to(root)
        except ValueError:
            continue
        if target.is_file() and target.suffix.lower() in IMAGE_EXT:
            return target
        raise FileNotFoundError(str(target))
    raise PermissionError(str(target))


# ---------------------------------------------------------------- 远程封面

def _sized(url: str) -> str:
    """Civitai 原图动辄 2 MB，卡面只要 448 宽（和模型封面同一口径）。"""
    return url.replace("/original=true/", "/width=448/")


def _tokens(text: str) -> set[str]:
    out: set[str] = set()
    for raw in _TOKEN.findall((text or "").lower()):
        if len(raw) < 2 or raw.isdigit() or raw in _STOP:
            continue
        out.add(raw)
    return out


def _model_query(main_model: str) -> str:
    """`flux1-dev-fp8.safetensors` → `flux1 dev`。"""
    if not main_model:
        return ""
    stem = Path(main_model).stem
    cleaned = _QUANT.sub("-", f"-{stem}-").strip("-")
    cleaned = re.sub(r"[-_.]+", " ", cleaned).strip()
    words = [w for w in cleaned.split() if len(w) >= 2 and not w.isdigit()]
    return " ".join(words[:3])


def _cfg() -> dict:
    try:
        return (load_settings().get("sources") or {}).get("civitai") or {}
    except (OSError, ValueError):
        return {}


def _get(params: dict, cfg: dict, timeout: float = 9.0) -> list[dict]:
    headers = {"User-Agent": "model-downloader/0.1"}
    token = (cfg or {}).get("token") or ""
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        resp = client.get(CIVITAI_API, params=params)
        if resp.status_code >= 400:
            return []
        data = resp.json()
    items = data.get("items")
    return items if isinstance(items, list) else []


def _ranked_images(item: dict, allow_mature: bool, limit: int = 8, meta_only: bool = False) -> list[str]:
    """一个模型/工作流条目里的合格图，按「接近 16:10」排序。

    `meta_only=True` 只留带生成参数的图。Civitai 上带 meta 的才是真出图，
    不带的基本是画布截图、拼贴海报、带叠字的海报 —— 这些铺到卡片上很难看，
    设计文档的选图门槛明确把画布截图排除了。
    """
    scored: list[tuple[float, str]] = []
    for version in (item.get("modelVersions") or [])[:3]:
        for image in (version.get("images") or [])[:12]:
            url = image.get("url") or ""
            if not url or (image.get("type") or "image") != "image":
                continue  # 图集里混着视频，img 标签拿到会坏图
            if meta_only and not image.get("meta"):
                continue
            level = int(image.get("nsfwLevel") or 0)
            if level > 1 and not allow_mature:
                continue
            width, height = int(image.get("width") or 0), int(image.get("height") or 0)
            if width and height and width / height > MAX_ASPECT:
                continue  # 三联转面 / 左右对比：铺到卡面是一堆碎片
            score = abs(math.log((width / height) / COVER_RATIO)) if width and height else 1.5
            if level > 1:
                score += MATURE_PENALTY
            scored.append((score, _sized(url)))
    scored.sort(key=lambda pair: pair[0])
    out: list[str] = []
    for _, url in scored:
        if url not in out:
            out.append(url)
        if len(out) >= limit:
            break
    return out


def _workflow_cover(name: str, cfg: dict) -> str:
    """按工作流名去 Civitai 找同名工作流条目。

    匹配必须够紧：至少两个 token 重合。否则「人像高清修复」会被搜成某个无关模型，
    贴一张不相干的图比空白更糟。
    """
    want = _tokens(name)
    if len(want) < 2:
        return ""
    items = _get(
        {"query": " ".join(sorted(want, key=len, reverse=True)[:4]), "types": "Workflows", "limit": 8},
        cfg,
    )
    best: tuple[int, str] | None = None
    for item in items:
        got = _tokens((item.get("name") or "") + " " + (item.get("description") or "")[:120])
        overlap = len(want & got)
        if overlap < 2:
            continue
        imgs = _ranked_images(item, bool(cfg.get("full_catalog")), limit=2, meta_only=True)
        if not imgs:
            # 工作流条目里不带生成参数的图，绝大多数是「画布截图 + 成图」的拼接版，
            # 正是设计文档明确排除的那类。这里不将就 —— 交给底模样图池，
            # 那边的图是模型出图，至少干净。
            continue
        if not imgs:
            continue
        if best is None or overlap > best[0]:
            best = (overlap, imgs[0])
    return best[1] if best else ""


def _pool(model_key: str, cfg: dict) -> list[str]:
    """底模样图池。按模型名搜 Civitai，把多个结果的合格图摊平。"""
    query = _model_query(model_key)
    if not query:
        return []
    items = _get({"query": query, "limit": 6}, cfg)
    pool: list[str] = []
    for item in items:
        urls = _ranked_images(item, bool(cfg.get("full_catalog")), limit=4, meta_only=True)
        if not urls:
            urls = _ranked_images(item, bool(cfg.get("full_catalog")), limit=4)
        for url in urls:
            if url not in pool:
                pool.append(url)
    return pool[:24]


def _used_urls(model: str) -> set[str]:
    store = _load()
    return {
        (entry.get("url") or "")
        for entry in store["seen"].values()
        if entry.get("origin") == model and entry.get("url")
    }


def _cached_pool(model: str, cfg: dict) -> list[str]:
    """底模样图池的 7 天缓存，发牌与候选画廊共用同一份，别各搜各的。"""
    now = time.time()
    with _lock:
        cached = _load()["pools"].get(model)
    if cached and now - float(cached.get("ts") or 0) <= TTL_HIT:
        urls = list(cached.get("urls") or [])
        if urls:
            return urls
    urls = _pool(model, cfg)
    global _dirty
    with _lock:
        _load()["pools"][model] = {"urls": urls, "ts": now}
        _dirty = True
    _flush()
    return urls


def _pool_cover(key: str, model: str, cfg: dict, exclude: str = "") -> str:
    """从池子里发一张还没被同底模的其它工作流拿走的图。

    `exclude` 是用户刚换掉的那张：重抽时不能又发回同一张。
    """
    if not model:
        return ""
    urls = _cached_pool(model, cfg)
    taken = _used_urls(model)
    if exclude:
        taken.add(exclude)
    if not urls:
        return ""
    # 从「key 的稳定哈希」处开始找牌，而不是从第一张开始：
    # 按请求顺序发牌会让同一批工作流在不同顺序下互换封面（缓存过期后整批洗牌）。
    # 哈希起点保证池子不变时，同一条工作流永远拿同一张。
    start = int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:8], 16) % len(urls)
    for offset in range(len(urls)):
        url = urls[(start + offset) % len(urls)]
        if url not in taken:
            return url
    # 池子比需求小的时候，宁愿复用也不留空 —— 有图总比一块灰底好
    if len(urls) == 1:
        return urls[start]
    return urls[start] if urls[start] != exclude else urls[(start + 1) % len(urls)]


def resolve_one(entry: dict, cfg: dict) -> str:
    key = entry.get("key") or ""
    url = _workflow_cover(entry.get("name") or "", cfg)
    if url:
        return _remember(key, url, origin="workflow")
    url = _pool_cover(key, entry.get("model") or "", cfg)
    if url:
        return _remember(key, url, origin=entry.get("model") or "")
    return _remember(key, "", origin="")


def redeal(entry: dict, current: str = "") -> str:
    """换一张封面：清掉这条的自动结果与旧钉图，避开当前那张重新抽。

    结果同时写进 `seen` 与 `pinned`：钉住后才盖得过工作流自带的出图，
    且下次进页面不会又被 7 天缓存换回旧图。
    """
    key = (entry.get("key") or "").strip()
    if not key:
        return ""
    cfg = _cfg()
    exclude = (current or "").strip()
    forget(key)
    unpin(key)

    url = _workflow_cover(entry.get("name") or "", cfg)
    if url == exclude:
        url = ""
    origin = "workflow" if url else (entry.get("model") or "")
    if not url:
        url = _pool_cover(key, entry.get("model") or "", cfg, exclude=exclude)
        if url == exclude:
            url = ""
    if not url:
        return ""
    _remember(key, url, origin=origin)
    pin(key, url)
    return url


def candidates(entry: dict, current: str = "", offset: int = 0, limit: int = 4) -> list[str]:
    """封面管理画廊的候选：只发图，不写 seen / pinned，选中后由 choose() 钉住。

    顺序按 key 的稳定哈希起点旋转，保证同一条工作流每次打开看到的批次一样；
    offset 用来「换一批」，起点往后推即可，不需要重新搜社区。
    """
    key = (entry.get("key") or "").strip()
    if not key:
        return []
    cfg = _cfg()
    urls: list[str] = []
    own = _workflow_cover(entry.get("name") or "", cfg)
    if own:
        urls.append(own)
    model = entry.get("model") or ""
    if model:
        pool = _cached_pool(model, cfg)
        if pool:
            start = int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:8], 16) % len(pool)
            for url in pool[start:] + pool[:start]:
                if url not in urls:
                    urls.append(url)
    if offset and urls:
        step = offset % len(urls)
        urls = urls[step:] + urls[:step]
    out = urls[:limit]
    allowed = list(out)
    if current and current not in allowed:
        allowed.append(current)
    with _cand_lock:
        _CANDIDATES[key] = allowed
    return out


def choose(key: str, url: str) -> str:
    """用户从画廊点了一张：钉住它，盖过本地自带出图与自动抽牌。"""
    key = (key or "").strip()
    url = (url or "").strip()
    if not key or not url:
        raise ValueError("缺少工作流或封面地址")
    with _cand_lock:
        allowed = list(_CANDIDATES.get(key) or [])
    if url not in allowed:
        raise ValueError("这张图不在本次候选里，请重新打开封面管理")
    _remember(key, url, origin="manual")
    pin(key, url)
    return url


def _cached_url(key: str) -> str | None:
    with _lock:
        entry = _load()["seen"].get(key)
    if not entry:
        return None
    url = entry.get("url") or ""
    ttl = TTL_HIT if url else TTL_MISS
    if time.time() - float(entry.get("ts") or 0) > ttl:
        return None
    return url


def resolve_batch(entries: list[dict]) -> dict[str, str]:
    """批量取封面。已经本地有图的 key 前端不会传进来，这里只管远程。"""
    cfg = _cfg()
    out: dict[str, str] = {}
    pending: list[dict] = []
    for entry in entries:
        key = (entry.get("key") or "").strip()
        if not key:
            continue
        # 手动挑过的封面最优先，连工作流自带的出图也盖得过
        manual = pinned(key)
        if manual:
            out[key] = manual
            continue
        # 本地自带出图的条目没有钉图就别问社区，免得真实出图被替换掉
        if entry.get("has_local"):
            continue
        hit = _cached_url(key)
        if hit is not None:
            if hit:
                out[key] = hit
            continue
        pending.append(entry)
    if not pending:
        return out
    # 池子分配要串行（后取的要看到前面已发的牌），搜索本身并发
    with ThreadPoolExecutor(max_workers=4) as pool:
        urls = list(pool.map(lambda e: resolve_one(e, cfg), pending))
    for entry, url in zip(pending, urls):
        if url:
            out[entry["key"]] = url
    return out
