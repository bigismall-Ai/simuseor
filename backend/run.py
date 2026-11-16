"""启动入口: .venv/Scripts/python backend/run.py

开发时开启热重载：

    RELOAD=1 .venv/Scripts/python backend/run.py

（Windows PowerShell 用 `$env:RELOAD=1`；Git Bash 用 `RELOAD=1 ...` 前缀）

也可以用命令行参数：--reload / --no-reload 覆盖环境变量。

热重载不用 uvicorn 自带的 --reload：它在 Windows 上重启会卡死
（StatReload 用 CTRL_C_EVENT 结束子进程，join() 永远不返回，
日志停在 "Reloading..." 就再也不动了）。改用 app/dev.py 自己盯文件、
terminate 掉旧进程再起新的。详见 backend/dev.py 的说明。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import load_settings  # noqa: E402


def _reload_enabled(argv: list[str]) -> bool:
    """三处都能开热重载，优先级从高到低：命令行 > 环境变量 > 默认关。

    默认关是有意的：正式运行里 reload 会在每次改文件时重启进程，
    内存态（下载任务的进度、ComfyUI 实例句柄）会丢。
    """
    if "--reload" in argv:
        return True
    if "--no-reload" in argv:
        return False
    return os.environ.get("RELOAD", "").strip().lower() in ("1", "true", "yes", "on")


def main() -> None:
    argv = sys.argv[1:]
    cfg = load_settings()["app"]
    host = cfg.get("host", "127.0.0.1")
    port = int(cfg.get("port", 8000))
    reload_enabled = _reload_enabled(argv)

    if reload_enabled:
        # dev.py 在 backend/ 下（与 run.py 同级），不在 app 包里，
        # 所以按模块路径导入而不是 `from app import dev`。
        import dev

        raise SystemExit(dev.run(host, port))

    import uvicorn

    from app.main import app

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
