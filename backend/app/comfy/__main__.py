"""python -m app.comfy：打印设备探测 JSON，供人工验证。

用法（backend 目录下）：.venv/Scripts/python.exe -m app.comfy
"""
from __future__ import annotations

import json
import sys

from .probe import probe_device


def main() -> int:
    # 中文 Windows 控制台默认 GBK，先切 UTF-8 避免打印中文告警时炸掉
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    report = probe_device()
    print(json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
