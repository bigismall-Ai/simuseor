"""模型库条目的一���描述：规格 + 分类 + 显存结论。

前端表格的「规格」「本机可跑」「任务类型」三列都从这里出。

设计要点：
- **只读文件头**，不加载权重。safetensors 头几百 KB，毫秒级。
- **给不出结论就说清原因**，不给「跑得动 0.0 GB」这种自相矛盾的假结论。
- **分类现算不落库** —— 存一份就会和实际文件脱节。
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from pathlib import Path

from .config import DATA_DIR
from .family_rules import FAMILY_RULES
from .weight_class import classify
from .weight_meta import fmt_bytes, is_weight_file, pick_weight_file, read_weight

# 各家族类别的显存系数：权重之外还要留激活、缓存与框架开销。
# 这些是经验值，不是精确测量 —— 所以 UI 上只给档位（跑得动/勉强/装不下），
# 不给「需要 14.23 GB」这种伪精确数字。
VRAM_FACTOR = {
    "sd15": 1.25, "sdxl": 1.7, "flux": 1.9, "qwen": 2.0,
    "hunyuan": 2.4, "wan": 2.6, "ltx": 2.6, "pony": 1.7,
}
DEFAULT_VRAM_FACTOR = 1.6


# 一次探测要跑 nvidia-smi / CIM（实测 0.38 s）。列表接口对**每个模型**都会
# 调一次显存，facets 又从头算一遍 —— 内存缓存挡住同一进程内的重复探测，
# 磁盘缓存（var/data/gpu.json）挡住**重启后的第一次**：否则每次开服务都要
# 先等半秒才出第一张卡。
_VRAM_TTL = 3600.0
_GPU_CACHE_PATH = DATA_DIR / "gpu.json"
_vram_cache: dict[str, object] = {"at": 0.0, "snapshot": None}
_vram_lock = threading.Lock()


def _gpu_vram_mb() -> int | None:
    """本机独显显存。走 gpu_snapshot() 的缓存，不是每个模型都探一次。"""
    mb = int(gpu_snapshot().get("vramMb") or 0)
    return mb or None


def gpu_snapshot() -> dict:
    """本机独显快照 —— 权重压力标志的分母。

    前端要拿它算「这个模型占我显存百分之几」，所以给结构化数据而不是文本。
    查找顺序：进程内缓存 → 本地文件缓存 → 真正探测。并发请求用锁挡住，
    避免列表 / 分面 / gpu 三个接口同时各跑一次探测。
    """
    now = time.time()
    cached = _vram_cache["snapshot"]
    if cached is not None and now - float(_vram_cache["at"]) < _VRAM_TTL:
        return cached  # type: ignore[return-value]

    with _vram_lock:
        now = time.time()
        cached = _vram_cache["snapshot"]
        if cached is not None and now - float(_vram_cache["at"]) < _VRAM_TTL:
            return cached  # type: ignore[return-value]

        snap = _load_gpu_disk()
        if snap is None:
            snap = _probe_gpu_snapshot()
            _save_gpu_disk(snap)
        _vram_cache.update(at=now, snapshot=snap)
        return snap


def clear_gpu_snapshot() -> None:
    """丢掉内存与磁盘快照，下次调用重新探测（测试 / 手动重新检测用）。"""
    with _vram_lock:
        _vram_cache.update(at=0.0, snapshot=None)
    try:
        _GPU_CACHE_PATH.unlink()
    except OSError:
        pass


def _load_gpu_disk() -> dict | None:
    try:
        data = json.loads(_GPU_CACHE_PATH.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    snap = data.get("snapshot")
    if not isinstance(snap, dict):
        return None
    if time.time() - float(data.get("at") or 0) > _VRAM_TTL:
        return None
    return snap


def _save_gpu_disk(snap: dict) -> None:
    try:
        _GPU_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _GPU_CACHE_PATH.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({"at": time.time(), "snapshot": snap}, ensure_ascii=False),
            "utf-8",
        )
        tmp.replace(_GPU_CACHE_PATH)
    except OSError:
        pass  # 缓存写不进去不该让请求失败


def _probe_gpu_snapshot() -> dict:
    try:
        # 只要显存分母，不跑完整设备报告（磁盘 / Python / 实例那圈要 0.3 s 以上）
        from .comfy.probe import probe_primary_gpu

        gpu = probe_primary_gpu()
    except Exception:
        # 探测失败不该拖垮整个列表
        gpu = None
    if gpu is None:
        return {"name": "", "vendor": "", "vramMb": 0, "vramGb": 0, "vramText": "未检测到"}
    mb = int(gpu.vram_mb or 0)
    return {
        "name": gpu.name or "",
        "vendor": gpu.vendor or "",
        "vramMb": mb,
        "vramGb": round(mb / 1024, 2),
        "vramText": f"{mb / 1024:.0f} GB" if mb else "未检测到",
    }


def _family_of(name: str) -> str:
    """家族判定。

    规则来自 `family_rules.py` —— 那是**自动生成**的，源是前端 `core/cover.ts` 的 FAMILIES。
    以前这里手抄了一份，后端扩到 9 条时就跟前端脱节了（前端 17 条），
    新增家族全落到了默认显存系数上。改家族识别请改 cover.ts，然后跑
    `node scripts/gen-family-rules.mjs`。

    顺序敏感：具体家族排在通用家族前面。
    """
    hay = name or ""
    for fid, pat in FAMILY_RULES:
        if re.search(pat, hay, re.I):
            return fid
    return ""


def _vram_verdict(need_gb: float, vram_mb: int | None, has_weights: bool,
                  reason: str, is_demo: bool) -> dict:
    """权重状态 + 显存结论。

    **先判权重有没有，再判显存够不够** —— 这是两件事，不能混成一句「未读到权重」。

    权重侧四态：
      - broken   权重文件在，但解析失败（占位文件 / 真损坏 / 格式不认）
      - missing  目录里根本没有权重文件 → **下载不完整**，条目残缺
      - nogpu    权重读到了，但本机没独显 → 权重是好的，只是本机没法跑
      - demo     演示占位数据

    显存侧三档（只在权重完整时才有）：
      ok / warn / err —— 跑得动 / 勉强 / 装不下

    **「没有权重」不是「无法判定」，是「这个条目是残的」。**
    用户看到 gpt2 目录里只有 config.json + vocab.json，正确的解读是
    「权重没下下来」而不是「这个模型不需要权重」。前者要补救（重新下载），
    后者只是信息缺失 —— 混起来会让残缺的条目看起来像正常的。
    """
    if is_demo:
        return {"level": "demo", "text": "演示数据",
                "hint": "离线演示占位文件，权重内容为假，不参与显存判定"}
    if reason == "unreadable":
        return {"level": "broken", "text": "权重损坏",
                "hint": "有权重文件但头部解析失败（占位文件 / 下载不完整 / 格式不认）"}
    if reason == "none":
        return {"level": "missing", "text": "缺少权重",
                "hint": "目录里没有权重文件 —— 下载不完整，这个条目还不能用"}
    if not has_weights:
        return {"level": "unknown", "text": "未读到权重", "hint": ""}
    if not vram_mb:
        return {"level": "nogpu", "text": "无独显",
                "hint": "本机未检测到独立显卡，无法判断能否运行"}
    vram_gb = vram_mb / 1024
    if need_gb <= vram_gb * 0.85:
        return {"level": "ok", "text": "跑得动", "hint": f"余量 {(vram_gb - need_gb):.1f} GB"}
    if need_gb <= vram_gb:
        return {"level": "warn", "text": "勉强", "hint": "建议开显存优化或换更小量化"}
    return {"level": "err", "text": "装不下", "hint": f"超出 {need_gb - vram_gb:.1f} GB"}


# ---- 模型文件事实的本地缓存 ------------------------------------------------
# `describe_model` 每次都要 glob 权重文件 + 读 safetensors/gguf 头。3 个模型是
# 毫秒级，几百个模型就是每次进页面都重新读一遍。这里把「文件事实 + 分类」落到
# var/data/library_meta.json：键里带 local_path / name / tags / 目录体积 /
# 权重文件的 mtime+size —— 文件一改、标签一改、目录一移，键就变，自然 miss。
#
# **显存结论不进缓存**：它依赖本机显卡，换卡后必须用当前 GPU 重新算。
# 缓存的是「读文件读出来的事实」，不是「这个模型能不能跑」的结论。
_META_TTL = 7 * 24 * 3600
_META_MAX = 2000
_META_CACHE_PATH = DATA_DIR / "library_meta.json"
_meta_store: dict[str, dict] | None = None
_meta_lock = threading.Lock()
_meta_dirty = False


def _weight_stamp(local_path: str) -> tuple[Path | None, str]:
    """找主权重文件，并给出文件状态指纹。

    只 glob 目录，不读文件头 —— 比 `read_weight()` 便宜一个数量级。
    """
    directory = Path(local_path) if local_path else None
    if directory is None:
        return None, "-"
    try:
        if directory.is_dir():
            weight = pick_weight_file(directory)
            if weight is None:
                return None, "dir:none"
            st = weight.stat()
            return weight, f"w:{weight.name}:{st.st_mtime_ns}:{st.st_size}"
        if directory.is_file():
            st = directory.stat()
            return directory, f"f:{st.st_mtime_ns}:{st.st_size}"
    except OSError:
        return None, "err"
    return None, "missing"


def _meta_key(local_path: str, name: str, tags: list[str], size_bytes: int, stamp: str) -> str:
    raw = "\x1f".join([local_path, name, ",".join(tags), str(size_bytes), stamp])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _load_meta() -> dict[str, dict]:
    global _meta_store
    if _meta_store is not None:
        return _meta_store
    try:
        data = json.loads(_META_CACHE_PATH.read_text("utf-8"))
        _meta_store = data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        _meta_store = {}
    return _meta_store


def _get_meta(key: str) -> dict | None:
    with _meta_lock:
        entry = _load_meta().get(key)
    if not entry:
        return None
    if time.time() - float(entry.get("at") or 0) > _META_TTL:
        return None
    return entry


def _put_meta(key: str, entry: dict) -> None:
    global _meta_dirty
    with _meta_lock:
        store = _load_meta()
        entry["at"] = time.time()
        store[key] = entry
        if len(store) > _META_MAX:
            for old in sorted(store, key=lambda k: store[k].get("at") or 0)[: _META_MAX // 10]:
                store.pop(old, None)
        _meta_dirty = True


def flush_meta_cache() -> None:
    """把内存里的文件事实缓存落盘；列表 / 分面请求结束时各调一次。"""
    global _meta_dirty
    with _meta_lock:
        if not _meta_dirty or _meta_store is None:
            return
        _meta_dirty = False
        data = dict(_meta_store)
    try:
        _META_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _META_CACHE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        tmp.replace(_META_CACHE_PATH)
    except OSError:
        pass  # 缓存写不进去不该让请求失败


def describe_model(local_path: str, name: str = "", tags: list[str] | None = None,
                   size_bytes: int = 0) -> dict:
    """给一条模型记录补上规格、分类与显存结论。

    返回的键直接拼到 API 响应里。
    """
    tags = tags or []
    weight, stamp = _weight_stamp(local_path or "")
    key = _meta_key(local_path or "", name or "", tags, size_bytes or 0, stamp)
    entry = _get_meta(key)
    if entry is None:
        info = None
        reason = "none"
        if weight is not None:
            info = read_weight(weight)
            if info is not None:
                reason = ""
            elif is_weight_file(weight):
                # 有权重文件但读不出规格 —— 老格式（.ckpt/.bin）或头部损坏。
                # 跟「目录里根本没权重」是两回事，不能合并。
                reason = "unreadable"
        cls = classify(local_path or "", name or "", tags)
        entry = {"cls": cls, "info": info, "reason": reason}
        _put_meta(key, entry)
    cls = entry["cls"]
    info = entry["info"]
    reason = entry["reason"]

    is_demo = bool((info or {}).get("isDemo"))
    family = _family_of(name or "")
    factor = VRAM_FACTOR.get(family, DEFAULT_VRAM_FACTOR)

    size_gb = (size_bytes or 0) / 1024 ** 3
    base = (info or {}).get("weightGb") or size_gb
    need = base * factor

    vram_mb = _gpu_vram_mb()

    return {
        # 分类
        "folder": cls["folder"],
        "folderLabel": cls["folderLabel"],
        "task": cls["task"],
        "taskLabel": cls["taskLabel"],
        # 规格
        "precision": (info or {}).get("precision", ""),
        "params": (info or {}).get("paramsText", ""),
        "mixed": (info or {}).get("mixed", []),
        "tensors": (info or {}).get("tensors", 0),
        "weightBytes": (info or {}).get("weightBytes", 0),
        "weightGb": round(base, 2),
        "needGb": round(need, 1),
        "isDemo": is_demo,
        "hasWeights": bool(info),
        "noReason": reason,
        # 结论
        "vram": _vram_verdict(need, vram_mb, bool(info), reason, is_demo),
    }
