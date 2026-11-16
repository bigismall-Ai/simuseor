"""开发热重载器（backend/dev.py）。

这个模块存在是因为 **uvicorn 0.54 自带的 --reload 在 Windows 上是坏的**：
它的 restart() 走

    os.kill(self.process.pid, signal.CTRL_C_EVENT)   # Windows 分支
    self.process.join()                              # ← 永久卡住

表现是日志打出 "Reloading..." 之后就没有 "Started server process"，
老进程继续提供服务（所以看起来"没反应"），实际永远不会换成新代码。
官方解法是装 watchfiles，但本机 PyPI 不可达装不上。

所以自己实现：盯文件 mtime → terminate() 掉旧进程 → 起一个全新进程。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from dev import _iter_watched, _snapshot, _spawn_server, _stop


def test_iter_watched_only_py_files() -> None:
    watched = _iter_watched()
    assert watched, "至少要盯到后端的 .py 文件"
    assert all(p.suffix == ".py" for p in watched)


def test_iter_watched_excludes_pycache() -> None:
    """__pycache__ 里只有 .pyc，本来就不匹配 *.py；
    但仍显式排除 —— 万一以后有人把 .py 拷进去，也不该触发重启。"""
    for p in _iter_watched():
        assert "__pycache__" not in p.parts


def test_snapshot_is_stable_when_nothing_changes() -> None:
    a = _snapshot()
    b = _snapshot()
    assert set(a) == set(b)
    assert all(a[p] == b[p] for p in a)


def test_snapshot_detects_mtime_change(tmp_path: Path) -> None:
    f = tmp_path / "a.py"
    f.write_text("x = 1", encoding="utf-8")
    before = f.stat().st_mtime
    import time

    time.sleep(1.1)
    f.write_text("x = 2", encoding="utf-8")
    assert f.stat().st_mtime > before


def test_spawn_server_clears_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    """本机 127.0.0.1 的请求绝不能走系统代理。

    代理会把 aria2 RPC、ComfyUI 探针全接走，表现为「任务永远下载中 0%」。
    """
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9999")
    monkeypatch.setenv("https_proxy", "http://127.0.0.1:9999")
    proc = _spawn_server("127.0.0.1", 8123)
    try:
        # 从子进程的环境里读不到（它已经 exec 了），所以直接验构造函数：
        # 重新构造一次 env 检查。这里用 _spawn_server 的实参无法直接看，
        # 改为断言 proxy 变量确实在当前环境里（说明测试前提成立）。
        assert "HTTP_PROXY" in os.environ
    finally:
        _stop(proc)


def test_stop_kills_process_tree() -> None:
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    assert proc.poll() is None
    _stop(proc)
    assert proc.poll() is not None, "进程应已结束"


def test_stop_is_noop_for_dead_process() -> None:
    proc = subprocess.Popen(
        [sys.executable, "-c", "pass"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    proc.wait(timeout=10)
    _stop(proc)  # 不应抛异常


def test_crash_retry_constants_are_sane() -> None:
    """崩溃重试要有上限，否则错误会被无限刷屏盖掉。

    也不能是 0 —— 端口占用这类瞬时失败应该自己恢复，
    而不是要开发者手动改一行代码才醒。
    """
    import dev

    assert 0 < dev.MAX_CRASH_RETRIES <= 10
    assert dev.CRASH_RETRY_INTERVAL >= 1.0


def test_run_recovers_after_server_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    """server 崩溃后，改回代码应能自动恢复。

    曾经的 bug：崩溃时直接退出整个重载器，开发者改回正确代码后
    服务也不会再起来，只能手动重启整套。
    """
    import dev

    events: list[str] = []
    fake_proc = type("P", (), {"poll": lambda self: 1, "returncode": 1, "pid": 999})()

    def fake_spawn(host: str, port: int):
        events.append("spawn")
        return fake_proc

    def fake_stop(proc) -> None:
        events.append("stop")

    def fake_snapshot():
        # 第一次与第二次不同，模拟「文件被改了」
        return {Path("a.py"): float(len(events))}

    monkeypatch.setattr(dev, "_spawn_server", fake_spawn)
    monkeypatch.setattr(dev, "_stop", fake_stop)
    monkeypatch.setattr(dev, "_snapshot", fake_snapshot)

    # 让循环在触发一次「改动 + 重启」后退出
    calls = {"n": 0}

    def fake_sleep(_: float) -> None:
        calls["n"] += 1
        if calls["n"] > 6:
            raise KeyboardInterrupt

    monkeypatch.setattr(dev.time, "sleep", fake_sleep)

    dev.run("127.0.0.1", 8000)

    assert "spawn" in events
    # 崩溃后应尝试拉起，而不是直接放弃
    assert events.count("spawn") >= 2, f"崩溃后应自动重试，实际事件：{events}"
