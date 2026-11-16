"""模型库条目的一���描述：规格 + 分类 + 显存结论。

前端表格的「规格」「本机可跑」「任务类型」三列都从这里出。

设计要点：
- **只读文件头**，不加载权重。safetensors 头几百 KB，毫秒级。
- **给不出结论就说清原因**，不给「跑得动 0.0 GB」这种自相矛盾的假结论。
- **分类现算不落库** —— 存一份就会和实际文件脱节。
"""
from __future__ import annotations

import re
from pathlib import Path

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


def _gpu_vram_mb() -> int | None:
    """本机独显显存。探测有缓存，不会每次都跑 nvidia-smi。"""
    try:
        from .comfy.probe import probe_device

        report = probe_device()
        gpu = report.primary_gpu
        return gpu.vram_mb if gpu else None
    except Exception:
        # 探测失败不该拖垮整个列表
        return None


def gpu_snapshot() -> dict:
    """本机独显快照 —— 权重压力标志的分母。

    前端要拿它算「这个模型占我显存百分之几」，所以给结构化数据而不是文本。
    """
    try:
        from .comfy.probe import probe_device

        report = probe_device()
        gpu = report.primary_gpu
    except Exception:
        return {"name": "", "vramMb": 0, "vramGb": 0, "vramText": "未检测到"}
    if gpu is None:
        return {"name": "", "vramMb": 0, "vramGb": 0, "vramText": "未检测到"}
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


def describe_model(local_path: str, name: str = "", tags: list[str] | None = None,
                   size_bytes: int = 0) -> dict:
    """给一条模型记录补上规格、分类与显存结论。

    返回的键直接拼到 API 响应里。
    """
    cls = classify(local_path or "", name or "", tags or [])

    directory = Path(local_path) if local_path else None
    info = None
    reason = "none"
    if directory is not None and directory.is_dir():
        w = pick_weight_file(directory)
        if w is not None:
            info = read_weight(w)
            if info is not None:
                reason = ""
            elif is_weight_file(w):
                # 有权重文件但读不出规格 —— 老格式（.ckpt/.bin）或头部损坏。
                # 跟「目录里根本没权重」是两回事，不能合并。
                reason = "unreadable"
            else:
                reason = "none"
        else:
            reason = "none"
    elif directory is not None and directory.is_file():
        info = read_weight(directory)
        reason = "" if info is not None else ("unreadable" if is_weight_file(directory) else "none")

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
