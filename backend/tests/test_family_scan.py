"""厂标资产巡检。

这套机制的价值全在「不打扰」和「不越权」两件事上：

- 不打扰：24 小时节流，连续触发只跑一次；触发点在用户搜索时，不额外占用定时器
- 不越权：巡检**只报告**，永远不替换正式资产 —— 换不换是设计判断，由人执行 --promote

锁住这些行为，因为它们一旦破了，代价是全站封面无声无息地变样。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from app import family_scan


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """把状态文件与报告文件挪到临时目录，别碰真实的 var/data。"""
    state = tmp_path / "family_scan.json"
    report = tmp_path / "report.json"
    monkeypatch.setattr(family_scan, "STATE_PATH", state)
    monkeypatch.setattr(family_scan, "REPORT_PATH", report)
    monkeypatch.setattr(family_scan, "_running", False)
    return state


def _fake_run(payload: dict, calls: list):
    """造一个假的 subprocess.run：写报告文件、记录调用参数。"""

    def run(cmd, **kwargs):
        calls.append({"cmd": cmd, **kwargs})
        family_scan.REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        family_scan.REPORT_PATH.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")

        class R:
            returncode = 0
            stdout = "ok"
            stderr = ""

        return R()

    return run


def test_first_trigger_starts_scan(monkeypatch: pytest.MonkeyPatch):
    calls: list = []
    monkeypatch.setattr(family_scan.subprocess, "run", _fake_run({"summary": {}, "families": [], "attention": []}, calls))
    monkeypatch.setattr(family_scan, "_node_exe", lambda: "node")

    res = family_scan.trigger()
    assert res["started"] is True
    assert res["skipped"] is False

    # 后台线程要跑完
    for _ in range(50):
        if calls:
            break
        time.sleep(0.05)
    assert calls, "应当真的调起了巡检脚本"
    assert "--report" in calls[0]["cmd"]
    assert str(family_scan.SCRIPT) in calls[0]["cmd"]


def test_second_trigger_within_window_is_throttled(monkeypatch: pytest.MonkeyPatch):
    calls: list = []
    monkeypatch.setattr(family_scan.subprocess, "run", _fake_run({"summary": {}, "families": [], "attention": []}, calls))
    monkeypatch.setattr(family_scan, "_node_exe", lambda: "node")

    family_scan.trigger()
    for _ in range(50):
        if calls:
            break
        time.sleep(0.05)
    n_after_first = len(calls)

    res = family_scan.trigger()
    assert res["started"] is False
    assert res["skipped"] is True
    assert "24" in res["reason"]
    assert len(calls) == n_after_first, "节流期内不该再调脚本"


def test_force_bypasses_throttle(monkeypatch: pytest.MonkeyPatch):
    calls: list = []
    monkeypatch.setattr(family_scan.subprocess, "run", _fake_run({"summary": {}, "families": [], "attention": []}, calls))
    monkeypatch.setattr(family_scan, "_node_exe", lambda: "node")

    family_scan.trigger()
    for _ in range(50):
        if calls:
            break
        time.sleep(0.05)
    n_after_first = len(calls)

    res = family_scan.trigger(force=True)
    assert res["started"] is True
    for _ in range(50):
        if len(calls) > n_after_first:
            break
        time.sleep(0.05)
    assert len(calls) > n_after_first, "force 必须绕过节流"


def test_concurrent_triggers_start_only_one_scan(monkeypatch: pytest.MonkeyPatch):
    """并发触发（比如用户连按搜索）只能起一次巡检。"""
    calls: list = []
    release = {"go": False}

    def slow_run(cmd, **kwargs):
        calls.append(cmd)
        # 卡住，等其它触发都返回
        while not release["go"]:
            time.sleep(0.02)
        family_scan.REPORT_PATH.write_text(json.dumps({"summary": {}}), "utf-8")

        class R:
            returncode = 0
            stdout = ""
            stderr = ""

        return R()

    monkeypatch.setattr(family_scan.subprocess, "run", slow_run)
    monkeypatch.setattr(family_scan, "_node_exe", lambda: "node")

    results = [family_scan.trigger() for _ in range(5)]
    release["go"] = True

    started = [r for r in results if r["started"]]
    assert len(started) == 1, f"只该起一次巡检，实际起了 {len(started)} 次"

    # 后台线程是异步的，等它真的调到脚本再断言
    for _ in range(100):
        if calls:
            break
        time.sleep(0.05)
    assert len(calls) == 1, f"只该调一次脚本，实际调了 {len(calls)} 次"


def test_report_is_merged_into_state(monkeypatch: pytest.MonkeyPatch):
    payload = {
        "scannedAt": "2026-11-16T00:00:00.000Z",
        "summary": {"families": 17, "upToDate": 3, "drifted": 1, "unreachable": 0},
        "attention": [{"id": "flux", "kind": "simple-icons", "state": "drifted", "variants": []}],
        "families": [{"id": "flux", "state": "drifted"}],
    }
    monkeypatch.setattr(family_scan.subprocess, "run", _fake_run(payload, []))
    monkeypatch.setattr(family_scan, "_node_exe", lambda: "node")

    family_scan.trigger()
    for _ in range(60):
        st = family_scan.status()
        if st["lastScanAt"]:
            break
        time.sleep(0.05)

    st = family_scan.status()
    assert st["lastScanAt"], "状态里应记下巡检时间"
    assert st["ok"] is True
    assert st["summary"]["drifted"] == 1
    assert [a["id"] for a in st["attention"]] == ["flux"]


def test_missing_node_does_not_crash(monkeypatch: pytest.MonkeyPatch):
    """找不到 node 只能记个错，绝不能让搜索接口跟着炸。"""
    monkeypatch.setattr(family_scan, "_node_exe", lambda: None)

    res = family_scan.trigger()
    assert res["started"] is True  # 受理了，但内部会失败

    for _ in range(60):
        st = family_scan.status()
        if st["lastError"]:
            break
        time.sleep(0.05)
    st = family_scan.status()
    assert st["lastError"], "应记下错误原因"
    assert st["attention"] == []


def test_scan_never_touches_official_assets():
    """最重要的一条：巡检只读不写。

    跑一次真巡检（需要 node），确认正式资产一个字节都没变 ——
    漂移只体现在报告里，正式资产必须等人执行 --promote 才会换。
    """
    import shutil

    node = shutil.which("node")
    if not node:
        pytest.skip("环境里没有 node")

    assets = Path(__file__).resolve().parents[2] / "web" / "public" / "families"
    if not assets.is_dir():
        pytest.skip("没有资产目录")

    before = {p.name: p.read_bytes() for p in assets.glob("*.svg")}

    import subprocess as sp

    script = Path(__file__).resolve().parents[2] / "scripts" / "fetch-family-assets.mjs"
    proc = sp.run(
        [node, str(script), "--report", str(family_scan.REPORT_PATH)],
        cwd=str(Path(__file__).resolve().parents[2]),
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert proc.returncode == 0, proc.stderr[-500:]

    after = {p.name: p.read_bytes() for p in assets.glob("*.svg")}
    assert before == after, "巡检改了正式资产 —— 这是越权"
