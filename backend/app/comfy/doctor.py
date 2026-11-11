"""基础环境自检（「环境检测」按钮的后端）。

GET /api/comfy/env 是只读文件探测，快但不一定准——文件在未必能跑。
这里真的启动内置解释器 import torch，用来在环境出问题时定位故障，
并告诉前端哪些问题可以通过重新安装基础环境修复。全程不写盘。
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from ..config import COMFY_ENV_DIR
from .installer import clean_env

CHECK_TIMEOUT = 90

_SNIPPET = r"""
import json, sys
info = {
    "python": ".".join(str(part) for part in sys.version_info[:3]),
    "torch": None, "backend": None, "accelerator": None,
}
try:
    import torch
    info["torch"] = torch.__version__
    hip = getattr(torch.version, "hip", None)
    if hip:
        info["backend"] = "rocm"
        info["accelerator"] = bool(torch.cuda.is_available())
    elif hasattr(torch, "xpu") and torch.xpu.is_available():
        info["backend"] = "xpu"
        info["accelerator"] = True
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        info["backend"] = "mps"
        info["accelerator"] = True
    elif torch.cuda.is_available():
        info["backend"] = "cuda"
        info["accelerator"] = True
    else:
        info["backend"] = "cpu"
        info["accelerator"] = False
except Exception as exc:
    info["error"] = "{}: {}".format(type(exc).__name__, exc)
print(json.dumps(info))
"""


def _python_exe() -> Path:
    return COMFY_ENV_DIR / "python" / (
        "python.exe" if os.name == "nt" else "bin/python3"
    )


def _issue(code: str, title: str, detail: str, fix: str | None = "install") -> dict[str, Any]:
    return {"code": code, "title": title, "detail": detail, "fix": fix}


def check_environment() -> dict[str, Any]:
    """返回实测结果与问题清单；任何异常都转成 issue，绝不抛到 HTTP 层。"""
    result: dict[str, Any] = {
        "ok": False,
        "python": None,
        "torch": None,
        "backend": None,
        "accelerator": None,
        "issues": [],
        "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    python_exe = _python_exe()
    if not python_exe.is_file():
        result["issues"].append(
            _issue(
                "python-missing",
                "内置 Python 缺失",
                "共享环境里没有找到解释器，重新安装基础环境即可补上。",
            )
        )
        return result

    env = clean_env()
    env["PYTHONPATH"] = str(COMFY_ENV_DIR / "site-packages")
    try:
        proc = subprocess.run(
            [str(python_exe), "-c", _SNIPPET],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=CHECK_TIMEOUT,
            env=env,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        result["issues"].append(
            _issue("python-broken", "内置 Python 无法运行", f"启动解释器失败：{exc}")
        )
        return result

    info: dict[str, Any] = {}
    for line in reversed((proc.stdout or "").splitlines()):
        if line.startswith("{") and line.endswith("}"):
            try:
                info = json.loads(line)
            except ValueError:
                pass
            break

    if not info or proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-300:] or f"退出码 {proc.returncode}"
        result["issues"].append(
            _issue("python-broken", "内置 Python 无法运行", detail)
        )
        return result

    result["python"] = info.get("python")
    result["torch"] = info.get("torch")
    result["backend"] = info.get("backend")
    result["accelerator"] = info.get("accelerator")

    if not result["torch"]:
        detail = info.get("error") or "共享环境里没有可导入的 PyTorch。"
        result["issues"].append(
            _issue("torch-missing", "PyTorch 不可用", detail)
        )
    elif result["accelerator"] is False:
        result["issues"].append(
            _issue(
                "no-accelerator",
                "显卡加速不可用",
                "PyTorch 能导入，但当前只能使用 CPU。请检查显卡驱动；驱动由系统安装，不在本环境内。",
                fix=None,
            )
        )

    result["ok"] = not result["issues"]
    return result
