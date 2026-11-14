"""权重文件信息：精度、参数量、占用体积。

只读文件头，不加载权重 —— safetensors 的头部就写着每个张量的 dtype 与 shape，
读几百 KB 就够，毫秒级。

支持的格式：
  - safetensors（.safetensors / .sft）—— 头部是 JSON
  - gguf（.gguf）—— 头部有 magic + 版本 + 张量数 + KV 区

安全：三道闸挡住「长度字段是垃圾值」的情况。全填 ASCII '0' 的占位文件
（demo 源早期就是这么生成的）会被读成 3.4 EB 的头长度，直接 f.read(n) 会
MemoryError 把进程带走 —— 那不是「解析失败」，是「进程没了」。
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

# 各 dtype 每参数占的字节数
DTYPE_BYTES = {
    "F64": 8, "F32": 4, "F16": 2, "BF16": 2,
    "I64": 8, "I32": 4, "I16": 2, "I8": 1, "U8": 1, "BOOL": 1,
    "F8_E4M3": 1, "F8_E5M2": 1, "I4": 0.5, "U4": 0.5,
}

# dtype → 展示用的精度档位
PRECISION_LABEL = {
    "F32": "FP32", "F16": "FP16", "BF16": "BF16",
    "F8_E4M3": "FP8", "F8_E5M2": "FP8",
    "I8": "INT8", "U8": "INT8", "I4": "INT4", "U4": "INT4",
    "I64": "FP64", "F64": "FP64", "BOOL": "BOOL",
    "I32": "INT32", "I16": "INT16",
}

# safetensors 头部长度上界：JSON 头不可能超过 100 MB
MAX_HEADER_BYTES = 100 * 1024 * 1024

WEIGHT_SUFFIXES = (".safetensors", ".sft", ".gguf", ".ckpt", ".pt", ".pth", ".bin")


def safetensors_info(path: Path) -> dict | None:
    """读 safetensors 头。失败返回 None。"""
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            raw = f.read(8)
            if len(raw) < 8:
                return None
            n = struct.unpack("<Q", raw)[0]
            # 闸一：长度字段上界
            if n > MAX_HEADER_BYTES:
                return None
            # 闸二：头部长度不可能超过文件剩余字节
            if n + 8 > size:
                return None
            blob = f.read(n)
    except (OSError, ValueError, struct.error, MemoryError):
        return None

    try:
        header = json.loads(blob)
    except (ValueError, MemoryError):
        return None
    if not isinstance(header, dict):
        return None

    dtypes: dict[str, int] = {}
    dtype_bytes: dict[str, int] = {}
    params = 0
    for key, val in header.items():
        if key == "__metadata__" or not isinstance(val, dict):
            continue
        dtype = val.get("dtype") or ""
        count = 1
        for dim in val.get("shape") or []:
            count *= int(dim)
        params += count
        dtypes[dtype] = dtypes.get(dtype, 0) + 1
        dtype_bytes[dtype] = dtype_bytes.get(dtype, 0) + count * DTYPE_BYTES.get(dtype, 2)

    if not dtypes:
        return None

    total_bytes = sum(dtype_bytes.values())
    # 主体精度按【字节数】判，不是张量数。
    # F32 词嵌入张量数多但只占很小一块，F8 主干张量少却占绝大部分 ——
    # 按张量数判会把 FP8 权重误判成 FP32。
    main = max(dtype_bytes.items(), key=lambda kv: kv[1])[0]
    meta = header.get("__metadata__")
    meta = meta if isinstance(meta, dict) else {}

    # 混合档位：非主体的其它 dtype。
    # 阈值取「占 0.1% 以上或有实际张量」——
    # 词嵌入常是 F32 且只占千分之几，但它确实是这个权重的精度组成，
    # 标出来比不标更诚实（用户会问「为什么显示 FP8 却是 12.82B」）。
    mixed = [
        {"dtype": d, "percent": round(dtype_bytes[d] / total_bytes * 100, 2)}
        for d in sorted(dtype_bytes, key=lambda x: -dtype_bytes[x])
        if d != main and dtypes.get(d, 0) > 0
    ]

    return {
        "format": "safetensors",
        "precision": PRECISION_LABEL.get(main, main),
        "params": params,
        "paramsText": fmt_params(params),
        "weightBytes": total_bytes,
        "weightGb": total_bytes / 1024 ** 3,
        "tensors": sum(dtypes.values()),
        "dtypes": dtypes,
        "mixed": mixed,
        "isDemo": str(meta.get("demo", "")).lower() == "true",
        "meta": meta,
    }


def gguf_info(path: Path) -> dict | None:
    """读 GGUF 头：magic + 版本 + 张量数 + KV 数。"""
    try:
        with path.open("rb") as f:
            if f.read(4) != b"GGUF":
                return None
            version = struct.unpack("<I", f.read(4))[0]
            tensors = struct.unpack("<Q", f.read(8))[0]
            kv_count = struct.unpack("<Q", f.read(8))[0]
    except (OSError, struct.error, MemoryError):
        return None
    return {
        "format": "gguf",
        "ggufVersion": version,
        "tensors": tensors,
        "kvCount": kv_count,
        "precision": "",
        "params": 0,
        "paramsText": "",
        "weightBytes": path.stat().st_size,
        "weightGb": path.stat().st_size / 1024 ** 3,
        "dtypes": {},
        "mixed": [],
        "isDemo": False,
        "meta": {},
    }


def read_weight(path: Path) -> dict | None:
    """按扩展名分派。返回 None 表示「读不出来」。

    注意：**读不出来 ≠ 文件不存在**。调用方要区分这两种情况 ——
    `.ckpt` / `.bin` 是老式格式（PyTorch pickle），头部读不出 dtype，
    但文件实实在在存在。此时如果返回 None 就被当成「没有权重」，
    等于把一个完整的模型误报成残缺。
    """
    suffix = path.suffix.lower()
    if suffix in (".safetensors", ".sft"):
        return safetensors_info(path)
    if suffix == ".gguf":
        return gguf_info(path)
    return None


def is_weight_file(path: Path) -> bool:
    """这是不是一个权重文件（不管能不能解析出规格）。

    和 `read_weight` 分开是必须的：
    - `pick_weight_file` 找得到 `.ckpt` / `.bin`
    - `read_weight` 只认 safetensors / gguf

    两者一合，格式老但完整的模型就会被误判成「目录里没有权重」。
    """
    return path.suffix.lower() in (".safetensors", ".sft", ".gguf", ".ckpt", ".bin", ".pt", ".pth")


def fmt_params(n: int) -> str:
    if n >= 1e9:
        return f"{n / 1e9:.2f} B"
    if n >= 1e6:
        return f"{n / 1e6:.1f} M"
    if n >= 1e3:
        return f"{n / 1e3:.1f} K"
    return str(n)


def fmt_bytes(n: int) -> str:
    if n >= 1024 ** 3:
        return f"{n / 1024 ** 3:.2f} GB"
    if n >= 1024 ** 2:
        return f"{n / 1024 ** 2:.1f} MB"
    if n >= 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n} B"


def pick_weight_file(directory: Path) -> Path | None:
    """目录里挑一个「主权重」：优先 safetensors，其次 gguf，取最大的那个。"""
    best: Path | None = None
    best_rank = -1
    for pat, rank in (("*.safetensors", 3), ("*.sft", 3), ("*.gguf", 2), ("*.ckpt", 1), ("*.bin", 1)):
        for p in directory.glob(pat):
            try:
                size = p.stat().st_size
            except OSError:
                continue
            if rank > best_rank or (rank == best_rank and best is not None and size > best.stat().st_size):
                best, best_rank = p, rank
    return best
