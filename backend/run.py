"""启动入口: .venv/Scripts/python backend/run.py"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

from app.config import load_settings  # noqa: E402
from app.main import app  # noqa: E402


def main() -> None:
    cfg = load_settings()["app"]
    uvicorn.run(app, host=cfg.get("host", "127.0.0.1"), port=int(cfg.get("port", 8000)), log_level="info")


if __name__ == "__main__":
    main()
