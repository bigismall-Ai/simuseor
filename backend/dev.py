"""开发用热重载器（Windows 可靠版）。

为什么不用 uvicorn 自带的 --reload：
uvicorn 0.54 的 StatReload 在 Windows 上**重启会卡死**。它的 restart() 是

    os.kill(self.process.pid, signal.CTRL_C_EVENT)   # Windows 分支
    self.process.join()                              # ← 永久卡住

CTRL_C_EVENT 送达了子进程，但子进程是被 KeyboardInterrupt 打断的异常退出路径，
multiprocessing 的 sentinel 管道不会关闭，父进程就永远卡在 join() 上。
表现是日志打出 "Reloading..." 之后就没有 "Started server process"，
老进程还在提供服务（所以看起来"没反应"），实际永远不会换成新代码。

官方解法是装 watchfiles（换用 WatchFilesReload），但本机 PyPI 不可达，装不上。
所以这里自己实现：自己盯文件变化，用 terminate() 干净地结束 server 进程，
再起一个**全新**的进程。

三个关键点：
1. 用 terminate() 而不是 CTRL_C_EVENT —— 前者能让子进程走正常退出路径。
2. 每次重启起**全新进程**，不复用 socket —— 复用会让第二个进程
   报 WinError 87（端口/套接字已被前一个进程占用）。
3. 只盯 .py 且忽略 __pycache__ —— 否则每次导入都会触发一次无意义的重启。
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

# 轮询间隔：够快（改完文件 1 秒内生效），又不至于把 CPU 跑满
POLL_INTERVAL = 0.4

# server 崩溃后的自动拉起策略：
# 前几次快速重试（覆盖端口占用、文件锁这类非代码原因的瞬时失败），
# 之后转为「等文件改动」—— 有人改坏代码时，重试再多也没用，
# 等他改回来才是正解。
MAX_CRASH_RETRIES = 3
CRASH_RETRY_INTERVAL = 5.0


def _iter_watched() -> list[Path]:
    """要盯的 .py 文件（排除 __pycache__ 里的）。"""
    out: list[Path] = []
    for path in BACKEND_DIR.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        out.append(path)
    return out


def _snapshot() -> dict[Path, float]:
    snap: dict[Path, float] = {}
    for path in _iter_watched():
        try:
            snap[path] = path.stat().st_mtime
        except OSError:
            continue
    return snap


def _spawn_server(host: str, port: int) -> subprocess.Popen:
    """起一个全新的 uvicorn 进程。

    用子进程而不是 uvicorn 的 multiprocessing：multiprocessing 的 spawn
    在 Windows 上要重新导入 __main__，还得处理 socket 继承，
    自己拉 subprocess 反而更可控。
    """
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND_DIR)
    # 代理会让本机 127.0.0.1 的请求被系统代理接走 → aria2 RPC 连不上、
    # ComfyUI 探针失败。开发时明确清掉。
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(key, None)
    env["NO_PROXY"] = "127.0.0.1,localhost"
    env["no_proxy"] = "127.0.0.1,localhost"

    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            host,
            "--port",
            str(port),
            "--log-level",
            "info",
        ],
        cwd=str(BACKEND_DIR),
        env=env,
    )


def _stop(proc: subprocess.Popen) -> None:
    """结束 server 进程树。

    只 terminate 父进程不够：uvicorn 在 reload=false 时不 spawn 子进程，
    但 ComfyUI 实例管理器可能已经拉起了自己的子进程（安装 Python 环境、
    跑 node 脚本）。用 taskkill /T 杀整棵树，否则会留下占端口的孤儿。
    """
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()


def run(host: str, port: int) -> int:
    """看门狗主循环：起 server → 盯文件 → 变了就重启。

    server 崩了要能自愈。常见的崩溃原因是「有人改坏了一个文件」——
    这时如果直接放弃退出，开发者改回正确代码后服务也不会再起来，
    只能手动重启整套。所以崩溃后进入「等文件变化」的状态：
    改回代码 → mtime 变化 → 自动重启 → 恢复。
    另外给几次低频重试兜底（比如端口被别的进程占了这类非代码原因）。
    """
    print(f"[dev] 启动热重载：http://{host}:{port}（改动后端 .py 自动重启）", flush=True)
    proc = _spawn_server(host, port)
    snap = _snapshot()

    crash_count = 0
    next_retry = 0.0

    try:
        while True:
            time.sleep(POLL_INTERVAL)
            now = time.time()

            # ---- server 还活着吗 ----
            if proc is not None and proc.poll() is not None:
                code = proc.returncode
                crash_count += 1
                print(f"[dev] server 进程退出（code={code}）", flush=True)
                proc = None
                # 有限次重试：覆盖端口占用这类非代码原因；
                # 超过上限就纯等文件改动，避免错误被无限刷屏盖掉。
                if crash_count <= MAX_CRASH_RETRIES and now >= next_retry:
                    print(f"[dev] 尝试拉起（第 {crash_count} 次）", flush=True)
                    time.sleep(0.8)
                    proc = _spawn_server(host, port)
                    snap = _snapshot()
                    next_retry = now + CRASH_RETRY_INTERVAL
                    continue
                print("[dev] 等待代码改动后自动恢复（或 Ctrl+C 重新启动）", flush=True)

            # ---- 文件有变化吗 ----
            current = _snapshot()
            changed = [
                p for p, mtime in current.items()
                if p in snap and mtime > snap[p]
            ]
            # 文件被删了也要重启（snap 里有、current 里没有）
            removed = [p for p in snap if p not in current]

            if changed or removed:
                names = ", ".join(p.name for p in (changed + removed)[:4])
                print(f"[dev] 检测到改动：{names} → 重启", flush=True)
                if proc is not None:
                    _stop(proc)
                time.sleep(0.6)  # 等端口释放
                proc = _spawn_server(host, port)
                snap = _snapshot()
                crash_count = 0
                next_retry = 0.0
                print("[dev] 已重启", flush=True)
    except KeyboardInterrupt:
        print("\n[dev] 停止", flush=True)
    finally:
        if proc is not None:
            _stop(proc)
    return 0


if __name__ == "__main__":
    raise SystemExit(run("0.0.0.0", 8000))
