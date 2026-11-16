"""厂标资产巡检 —— 搭车触发。

触发点：模型发现页搜索时调一次，后端按 24 小时节流，一天最多真跑一次。

为什么搭车而不是定时任务：
    定时任务会在没人用的时候也去抓上游，纯属浪费；而「用户正在找模型」这个
    时刻恰好是资产状态最该被知道的时刻。触发点选在这里，既不打扰也不遗漏。

为什么不自己抓、而是调 Node 脚本：
    抓取逻辑在 ``scripts/fetch-family-assets.mjs``（simple-icons 的颜色段、
    语义签名、变体配对都在那儿）。在这里再写一份 Python 的，必然漂移 ——
    这正是家族表改成单一数据源时要消灭的问题，这里同理。

**这个模块永远不会替换正式资产。** 巡检只回答「上游变了没有」，
换不换是设计判断，由人执行 ``--promote``。
"""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path

from .config import DATA_DIR, ROOT, TMP_DIR

# 巡检间隔：一天最多一次。
INTERVAL_SECONDS = 24 * 3600
# 子进程上限：正常 2 秒内跑完，给网络留余量。
SCAN_TIMEOUT = 180

STATE_PATH = DATA_DIR / "family_scan.json"
REPORT_PATH = TMP_DIR / "family_scan_report.json"
SCRIPT = ROOT / "scripts" / "fetch-family-assets.mjs"

_lock = threading.Lock()
_running = False


def _load() -> dict:
    try:
        return json.loads(STATE_PATH.read_text("utf-8"))
    except Exception:
        return {}


def _save(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")


def _node_exe() -> str | None:
    """找 node。找不到就放弃巡检 —— 绝不能因为环境缺个运行时就让搜索接口报错。"""
    exe = shutil.which("node")
    if exe:
        return exe
    for cand in ("node.exe", "node"):
        for base in (ROOT / "node_modules", ROOT / "web" / "node_modules"):
            p = base / cand
            if p.exists():
                return str(p)
    return None


def _run_scan() -> None:
    """后台跑一次巡检，把结果并进状态文件。"""
    global _running
    try:
        node = _node_exe()
        if not node:
            _save({**_load(), "lastError": "找不到 node 运行时", "lastScanAt": time.strftime("%Y-%m-%dT%H:%M:%S")})
            return
        if not SCRIPT.exists():
            _save({**_load(), "lastError": f"巡检脚本不存在：{SCRIPT}", "lastScanAt": time.strftime("%Y-%m-%dT%H:%M:%S")})
            return

        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            REPORT_PATH.unlink()
        except OSError:
            pass

        proc = subprocess.run(
            [node, str(SCRIPT), "--report", str(REPORT_PATH)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=SCAN_TIMEOUT,
        )

        report: dict = {}
        if REPORT_PATH.exists():
            try:
                report = json.loads(REPORT_PATH.read_text("utf-8"))
            except Exception:
                report = {}

        prev = _load()
        state = {
            "lastScanAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "lastScanTs": time.time(),
            "ok": proc.returncode == 0 and bool(report),
            "summary": report.get("summary", {}),
            "attention": report.get("attention", []),
            "families": report.get("families", []),
            "scannedAt": report.get("scannedAt"),
        }
        if proc.returncode != 0:
            state["lastError"] = (proc.stderr or proc.stdout or "").strip()[-500:] or f"退出码 {proc.returncode}"
        else:
            state.pop("lastError", None)
        # 保留上一轮的其它字段（比如首次失败时的提示）
        _save({**prev, **state})
    except subprocess.TimeoutExpired:
        _save({**_load(), "lastError": f"巡检超时（>{SCAN_TIMEOUT}s）", "lastScanAt": time.strftime("%Y-%m-%dT%H:%M:%S")})
    except Exception as e:  # 巡检失败绝不能影响主流程
        _save({**_load(), "lastError": f"{type(e).__name__}: {e}"})
    finally:
        _running = False


def trigger(force: bool = False) -> dict:
    """搭车触发一次巡检。

    24 小时内已巡检过就直接返回，不跑。返回值里的 ``attention`` 是真正
    需要人看的部分（上游改了 / 抓不到了）—— 已知的「官方地址没登记」
    不算，那不是异常。
    """
    global _running
    now = time.time()
    state = _load()
    last = state.get("lastScanTs") or 0

    if not force and last and (now - last) < INTERVAL_SECONDS:
        return {
            "started": False,
            "skipped": True,
            "reason": "24 小时内已巡检",
            "lastScanAt": state.get("lastScanAt"),
            "attention": state.get("attention", []),
        }

    with _lock:
        state = _load()
        last = state.get("lastScanTs") or 0
        if not force and last and (time.time() - last) < INTERVAL_SECONDS:
            return {
                "started": False,
                "skipped": True,
                "reason": "24 小时内已巡检",
                "lastScanAt": state.get("lastScanAt"),
                "attention": state.get("attention", []),
            }
        if _running:
            return {"started": False, "skipped": True, "reason": "巡检进行中", "attention": state.get("attention", [])}
        _running = True
        threading.Thread(target=_run_scan, daemon=True).start()

    return {"started": True, "skipped": False, "reason": "已启动巡检"}


def status() -> dict:
    """当前巡检状态（前端读取用）。"""
    state = _load()
    return {
        "lastScanAt": state.get("lastScanAt"),
        "ok": state.get("ok"),
        "summary": state.get("summary", {}),
        "attention": state.get("attention", []),
        "lastError": state.get("lastError"),
        "running": _running,
        "intervalHours": INTERVAL_SECONDS // 3600,
    }
