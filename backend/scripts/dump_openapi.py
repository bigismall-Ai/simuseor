"""生成 / 校验 OpenAPI 契约。

用法：
    python backend/scripts/dump_openapi.py
    python backend/scripts/dump_openapi.py --check
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402

OUT = BACKEND / "openapi.json"


def rendered() -> str:
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    text = rendered()
    if "--check" in sys.argv:
        expected = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if text != expected:
            print("OpenAPI 契约已过期，运行：python backend/scripts/dump_openapi.py")
            return 1
        print("OpenAPI 契约一致。")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"已写入 {OUT.relative_to(BACKEND.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
