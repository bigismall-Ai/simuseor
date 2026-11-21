"""ComfyUI 实例进程：启动 / 停止 / 状态。

实例目录 `comfy/<name>/` 只放代码，用户资产全部落在 workspace/：

    --base-directory  <项目>/workspace           模型、插件、输入、出图
    --user-directory  <项目>/workspace/userdata  工作流与界面设置
    --temp-directory  <项目>/var/tmp/<实例>       临时文件

注意：`--temp-directory` 指向的目录下 ComfyUI 还会再建一层 `temp/`，
实际路径是 `var/tmp/<实例>/temp`。

进程只由本模块拉起和回收；外部另外启动的 ComfyUI 不接管，状态一律报 stopped。
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from ..config import (
    COMFY_DIR,
    COMFY_ENV_DIR,
    LOG_DIR,
    WORKSPACE_DIR,
    WORKSPACE_USERDATA_DIR,
    ensure_workspace,
    instance_tmp_dir,
)
from .names import validate_instance_name

# ComfyUI 默认端口；被占用时从这里往后顺延扫描
DEFAULT_PORT = 8188
PORT_SCAN = 100

# 实例名 → {proc, port, log, log_file, started_at}。只记录本进程拉起的实例。
_running: dict[str, dict[str, Any]] = {}
_lock = threading.RLock()


def comfy_dir(name: str) -> Path:
    """实例里的 ComfyUI 代码目录。"""
    return COMFY_DIR / name / "ComfyUI"


def python_exe() -> Path:
    """共享基础环境里的内置解释器。"""
    if os.name == "nt":
        return COMFY_ENV_DIR / "python" / "python.exe"
    return COMFY_ENV_DIR / "python" / "bin" / "python"


def site_packages() -> Path:
    return COMFY_ENV_DIR / "site-packages"


def _meta(name: str) -> dict[str, Any]:
    path = COMFY_DIR / name / "instance.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_port(name: str, port: int) -> None:
    """把实际端口写回 instance.json，下次启动优先复用。"""
    path = COMFY_DIR / name / "instance.json"
    data = _meta(name)
    if not path.is_file() or data.get("port") == port:
        return
    data["port"] = port
    try:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _pick_port(name: str) -> int:
    used = {int(info["port"]) for info in _running.values()}
    saved = int(_meta(name).get("port") or 0)
    if saved and saved not in used and _port_free(saved):
        return saved
    for port in range(DEFAULT_PORT, DEFAULT_PORT + PORT_SCAN):
        if port not in used and _port_free(port):
            return port
    raise RuntimeError("没有可用端口，请先释放 8188 起的端口区间")


def _http_ok(port: int) -> bool:
    try:
        # trust_env=False：本机探测不能走 HTTP_PROXY。代理环境变量下这个请求会被
        # 代理接走，实例明明起来了也一律判成 starting。
        resp = httpx.get(f"http://127.0.0.1:{port}/system_stats", timeout=2, trust_env=False)
    except httpx.HTTPError:
        return False
    return resp.status_code == 200


def _alive(info: dict[str, Any]) -> bool:
    proc = info.get("proc")
    return proc is not None and proc.poll() is None


def _forget(name: str) -> None:
    """从表里移除实例并关闭日志句柄（调用方需持锁）。"""
    info = _running.pop(name, None)
    handle = (info or {}).get("log_file")
    if handle is not None:
        try:
            handle.close()
        except OSError:
            pass


def is_running(name: str) -> bool:
    with _lock:
        info = _running.get(name)
        return bool(info) and _alive(info)


def active() -> dict[str, Any] | None:
    """当前正在跑的实例。

    同一时间只允许一个实例占用端口与显存，所以这里最多返回一条。
    不探测 HTTP：`/env` 会被频繁轮询，就绪状态由 /instances/{name}/status 判定。
    """
    with _lock:
        for name, info in _running.items():
            if _alive(info):
                port = int(info["port"])
                return {"name": name, "port": port, "url": f"http://127.0.0.1:{port}/"}
    return None


def start(name: str, wait: float = 8.0) -> dict[str, Any]:
    """启动实例。立即返回状态；`state=starting` 表示进程已拉起但还没响应 HTTP。"""
    name = validate_instance_name(name)
    with _lock:
        info = _running.get(name)
        if info and _alive(info):
            return status(name)

        # 同一时间只允许一个实例运行：显存是独占资源，两个实例同时跑只会互相拖垮
        for other, other_info in _running.items():
            if other != name and _alive(other_info):
                raise RuntimeError(f"实例「{other}」正在运行，请先停止后再启动")

        work = comfy_dir(name)
        main_py = work / "main.py"
        if not main_py.is_file():
            raise ValueError(f"实例代码不完整，找不到 {main_py}")
        py = python_exe()
        if not py.is_file():
            raise RuntimeError("基础环境未安装，请先安装基础环境")
        if not site_packages().is_dir():
            raise RuntimeError("基础环境缺少 site-packages，请重新安装基础环境")

        port = _pick_port(name)
        ensure_workspace()
        tmp_dir = instance_tmp_dir(name)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_path = LOG_DIR / f"comfy-run-{name}.log"

        cmd = [
            str(py),
            "main.py",
            "--listen",
            "0.0.0.0",
            "--port",
            str(port),
            "--disable-auto-launch",
            "--base-directory",
            str(WORKSPACE_DIR),
            "--user-directory",
            str(WORKSPACE_USERDATA_DIR),
            "--temp-directory",
            str(tmp_dir),
        ]
        env = os.environ.copy()
        # 后端自己跑在某个 venv 里，别让子进程继承到那套路径
        env.pop("VIRTUAL_ENV", None)
        env.pop("PYTHONHOME", None)
        env["PYTHONPATH"] = str(site_packages())
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("PYTHONIOENCODING", "utf-8")
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

        handle = log_path.open("a", encoding="utf-8", errors="replace")
        handle.write(f"\n# {time.strftime('%Y-%m-%dT%H:%M:%S')} 启动 {name} :{port}\n")
        handle.flush()
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(work),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=handle,
                stderr=subprocess.STDOUT,
                creationflags=flags,
                start_new_session=os.name != "nt",
            )
        except OSError as exc:
            handle.close()
            raise RuntimeError(f"启动失败: {exc}") from exc

        _running[name] = {
            "proc": proc,
            "port": port,
            "log": str(log_path),
            "log_file": handle,
            "started_at": time.time(),
        }
        _write_port(name, port)

    return status(name, wait=wait)


def status(name: str, wait: float = 0.0) -> dict[str, Any]:
    """查询实例状态：stopped / starting / running。wait>0 时短暂等待其就绪。"""
    name = validate_instance_name(name)
    deadline = time.time() + max(0.0, wait)
    while True:
        with _lock:
            info = _running.get(name)
            if info is None:
                return {"name": name, "state": "stopped", "port": None, "url": ""}
            proc = info["proc"]
            code = proc.poll()
            if code is not None:
                log = info["log"]
                _forget(name)
                return {
                    "name": name,
                    "state": "stopped",
                    "port": None,
                    "url": "",
                    "exit_code": code,
                    "log": log,
                }
            port = int(info["port"])
            log = info["log"]
            pid = proc.pid

        ready = _http_ok(port)
        if ready or time.time() >= deadline:
            return {
                "name": name,
                "state": "running" if ready else "starting",
                "port": port,
                "url": f"http://127.0.0.1:{port}/" if ready else "",
                "pid": pid,
                "log": log,
            }
        time.sleep(0.5)


def stop(name: str) -> dict[str, Any]:
    """停止实例；先 terminate，超时再 kill。"""
    name = validate_instance_name(name)
    with _lock:
        info = _running.get(name)
    if not info:
        return {"name": name, "state": "stopped", "port": None}

    proc = info["proc"]
    port = info["port"]
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
    with _lock:
        _forget(name)
    return {"name": name, "state": "stopped", "port": port, "exit_code": proc.returncode}


def stop_all() -> None:
    """应用退出时收掉自己拉起的实例，避免留下占端口的孤儿进程。"""
    for name in list(_running):
        try:
            stop(name)
        except Exception:  # noqa: BLE001 - 退出路径不允许抛
            continue
