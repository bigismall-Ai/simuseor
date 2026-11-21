"""`check_repo_state.py` 的自检：门禁自己得先是对的。

用法
----
    & E:\\Projects\\model-downloader\\.venv\\Scripts\\python.exe -m pytest `
        research\\tree-resources-builder\\harness\\test_repo_state.py -p no:cacheprovider
    # 或者不用 pytest：
    & E:\\Projects\\model-downloader\\.venv\\Scripts\\python.exe `
        research\\tree-resources-builder\\harness\\test_repo_state.py

设计理由
--------
1. **「造冲突」一律在临时目录里做。** 本测试与另外几个子代理并行，
   真实产物（`assets/validation/*.json`、`report.html`）是别人的作业对象，
   改一个 mtime 都可能污染别人的结论。所以新鲜度/覆盖度的「阳性用例」
   只在 `tempfile.TemporaryDirectory()` 里造文件。

2. **真实仓库上的测试只做「读」。** 允许断言门禁能报出已知问题
   （报告过期 / research 未入库 / 两个新 JSON 没进报告），
   但不允许任何写操作——测试前后对真实产物做 mtime + size + sha256 快照比对。

3. **断言的是「可定位的证据」而不是布尔值。** 一条只说「有问题」的告警没人能处理；
   证据里必须带文件名、路径或时间戳，人才知道去看哪儿。
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import check_repo_state as C  # noqa: E402

ROOT = C.ROOT
VAL_DIR = C.VAL_DIR
REPORT = C.REPORT_PATH

# 真实产物快照用的文件清单（只读）
WATCH = [
    os.path.join(VAL_DIR, n) for n in (
        "retarget_bvh.json", "public_decimated.json", "exports.json",
        "validation_report.json", "shot_001.json",
    )
] + [
    REPORT,
    os.path.join(ROOT, "plans", "ENV.md"),
    os.path.join(ROOT, "plans", "PLAN.md"),
]


def _snapshot():
    """对受保护文件做 (mtime, size, sha256) 快照。"""
    out = {}
    for p in WATCH:
        if not os.path.isfile(p):
            out[p] = None
            continue
        st = os.stat(p)
        with open(p, "rb") as fh:
            out[p] = (st.st_mtime, st.st_size,
                      hashlib.sha256(fh.read()).hexdigest())
    return out


# ------------------------------------------------------------------ 阳性用例（临时目录）
def test_freshness_detects_manufactured_conflict():
    """人造的新鲜度冲突必须被门禁抓到，且证据里带文件名与时间差。"""
    with tempfile.TemporaryDirectory() as td:
        val = os.path.join(td, "assets", "validation")
        os.makedirs(val)
        report = os.path.join(td, "report.html")

        with open(os.path.join(val, "fresh_artifact.json"), "w", encoding="utf-8") as fh:
            json.dump({"kind": "fresh_artifact"}, fh)
        with open(report, "w", encoding="utf-8") as fh:
            fh.write("<html></html>")

        # 把报告的时间戳往前拨 1 小时，产物保持「现在」——制造过期
        old = time.time() - 3600
        os.utime(report, (old, old))

        f = C.check_freshness(val, report)
        assert f.status == C.FAIL, f"应判定报告过期，实际 {f.status}"
        blob = " ".join(f.evidence) + " " + f.summary
        assert "fresh_artifact.json" in blob, f"证据里应有产物文件名：{blob}"
        assert "report.html" in blob, f"证据里应有报告路径：{blob}"
        assert "mtime=" in blob, f"证据里应带 mtime：{blob}"


def test_freshness_passes_when_report_is_newer():
    """报告比所有产物新时必须判 PASS（反向用例，避免门禁只会喊 FAIL）。"""
    with tempfile.TemporaryDirectory() as td:
        val = os.path.join(td, "assets", "validation")
        os.makedirs(val)
        report = os.path.join(td, "report.html")
        with open(os.path.join(val, "old_artifact.json"), "w", encoding="utf-8") as fh:
            json.dump({"kind": "old_artifact"}, fh)
        with open(report, "w", encoding="utf-8") as fh:
            fh.write("<html></html>")
        old = time.time() - 3600
        os.utime(os.path.join(val, "old_artifact.json"), (old, old))

        f = C.check_freshness(val, report)
        assert f.status == C.PASS, f"应判 PASS，实际 {f.status}：{f.summary}"


def test_report_coverage_detects_missing_kind():
    """产物的 kind 不在报告里 -> FAIL，且证据点名是哪个产物。"""
    with tempfile.TemporaryDirectory() as td:
        val = os.path.join(td, "assets", "validation")
        os.makedirs(val)
        report = os.path.join(td, "report.html")
        with open(os.path.join(val, "ghost.json"), "w", encoding="utf-8") as fh:
            json.dump({"kind": "ghost_kind_not_in_report"}, fh)
        with open(report, "w", encoding="utf-8") as fh:
            fh.write("<html>只有别的内容</html>")

        f = C.check_report_coverage(val, report)
        assert f.status == C.FAIL, f"应判 FAIL，实际 {f.status}"
        blob = " ".join(f.evidence)
        assert "ghost.json" in blob and "ghost_kind_not_in_report" in blob, \
            f"证据应同时含文件名与 kind：{blob}"


def test_report_coverage_soft_when_only_stem_present():
    """文件名主干出现、kind 没出现 -> WARN（内容可能在报告里，只是契约标识缺失）。"""
    with tempfile.TemporaryDirectory() as td:
        val = os.path.join(td, "assets", "validation")
        os.makedirs(val)
        report = os.path.join(td, "report.html")
        with open(os.path.join(val, "partial.json"), "w", encoding="utf-8") as fh:
            json.dump({"kind": "partial_contract_id"}, fh)
        with open(report, "w", encoding="utf-8") as fh:
            fh.write("<html>提到了 partial 这个文件</html>")

        f = C.check_report_coverage(val, report)
        assert f.status == C.WARN, f"应判 WARN，实际 {f.status}：{f.summary}"
        blob = " ".join(f.evidence)
        assert "partial.json" in blob and "partial_contract_id" in blob, blob


# ------------------------------------------------------------------ 真实仓库（只读）
def test_runs_on_real_repo_without_crashing():
    """在当前仓库状态下跑全量检查，不能崩、不能改东西。"""
    before = _snapshot()
    findings = C.run_all(ROOT, C.PROJ)
    after = _snapshot()

    assert before == after, "门禁修改了受保护的真实产物（检查器必须是只读的）"
    assert len(findings) == 6, f"应跑 6 组检查，实际 {len(findings)}"
    for f in findings:
        assert f.status in (C.PASS, C.WARN, C.FAIL), f"非法状态 {f.status}"
        assert f.evidence, f"{f.id} 没给任何证据：{f.summary}"


def test_reports_known_real_problems():
    """门禁必须如实报出当前仓库的真实问题。"""
    findings = {f.id: f for f in C.run_all(ROOT, C.PROJ)}

    # 1) 报告过期：retarget_bvh.json / public_decimated.json 比 report.html 新
    fresh = findings["artifact_freshness"]
    assert fresh.status == C.FAIL, f"报告过期应判 FAIL，实际 {fresh.status}"
    blob = " ".join(fresh.evidence)
    assert "retarget_bvh.json" in blob, f"证据应点名 retarget_bvh.json：{blob}"
    assert "public_decimated.json" in blob, f"证据应点名 public_decimated.json：{blob}"
    assert "report.html" in blob, blob

    # 2) 报告覆盖度：这两个 kind 没进 report.html
    cover = findings["report_coverage"]
    assert cover.status == C.FAIL, f"覆盖度不足应判 FAIL，实际 {cover.status}"
    blob = " ".join(cover.evidence)
    assert "retarget_bvh" in blob, f"证据应含 retarget_bvh：{blob}"
    assert "public_decimated" in blob, f"证据应含 public_decimated：{blob}"

    # 3) git：research/ 零跟踪
    git = findings["git_tracking"]
    assert git.status == C.WARN, f"research 未入库应判 WARN，实际 {git.status}"
    blob = " ".join(git.evidence)
    assert "已跟踪文件 0 个" in blob, f"应报出 research/ 零跟踪：{blob}"
    assert "未跟踪文件" in blob and "字节" in blob, f"应报出数量与字节：{blob}"

    # 4) PLAN 回填：这两个 kind 没在 PLAN.md 里回填
    plan = findings["plan_backfill"]
    assert plan.status == C.WARN, f"PLAN 未回填应判 WARN，实际 {plan.status}"
    blob = " ".join(plan.evidence)
    assert "retarget_bvh" in blob and "public_decimated" in blob, blob


def test_evidence_is_locatable_not_just_boolean():
    """每条 FAIL/WARN 的证据里必须带文件名 / 路径 / 时间戳，人才能定位。"""
    for f in C.run_all(ROOT, C.PROJ):
        if f.status == C.PASS:
            continue
        blob = " ".join(f.evidence)
        assert ("assets/validation/" in blob or "harness/" in blob
                or "plans/" in blob or "report.html" in blob
                or "未跟踪文件" in blob or "mtime=" in blob), \
            f"{f.id} 的证据不可定位：{blob[:400]}"
        assert any(ch.isdigit() for ch in blob), f"{f.id} 的证据里没有任何数字（数量/时间）：{blob[:200]}"


def test_script_interpreter_table_matches_import_scan():
    """ENV.md 的脚本对照表必须与实际 import 扫描逐项一致（门禁第 3 条自证）。"""
    f = {x.id: x for x in C.run_all(ROOT, C.PROJ)}["script_interpreter"]
    assert f.status == C.PASS, f"ENV.md 与 import 扫描不一致：{f.summary} / {f.evidence}"
    req = C.script_requirements(C.HERE)
    assert len(req) >= 20, f"harness 脚本数 {len(req)} < 20"
    doc = C.parse_env_doc(os.path.join(ROOT, "plans", "ENV.md"))
    assert len(doc["scripts"]) >= 20, f"ENV.md 只覆盖 {len(doc['scripts'])} 个脚本"
    for name, info in req.items():
        assert name in doc["scripts"], f"ENV.md 缺少 {name}"
        assert C._token_class(doc["scripts"][name]) == C.env_class(info["envs"]), \
            f"{name} 解释器不一致：扫描={C.env_class(info['envs'])} 表={doc['scripts'][name]}"


def test_interpreter_capability_matrix_matches_probe():
    """ENV.md 的能力矩阵必须与两个解释器的实测一致（门禁第 4 条自证）。"""
    f = {x.id: x for x in C.run_all(ROOT, C.PROJ)}["interpreter_caps"]
    assert f.status == C.PASS, f"能力矩阵与实测不一致：{f.summary} / {f.evidence}"


# ------------------------------------------------------------------ CLI 行为
def test_cli_exit_codes_and_json_output():
    """默认退出 0、--strict 退出 2、--json 输出合法 JSON。"""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc_default = C.main([])
    assert rc_default == 0, f"默认退出码应为 0，实际 {rc_default}"
    text = buf.getvalue()
    assert "artifact_freshness" in text and "git_tracking" in text, text[:500]

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc_strict = C.main(["--strict"])
    assert rc_strict == 2, f"--strict 在有 FAIL 时应退出 2，实际 {rc_strict}"

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc_json = C.main(["--json"])
    assert rc_json == 0, f"--json 退出码应为 0，实际 {rc_json}"
    payload = json.loads(buf.getvalue())
    assert isinstance(payload["findings"], list) and len(payload["findings"]) == 6
    ids = {f["id"] for f in payload["findings"]}
    assert ids == {"artifact_freshness", "report_coverage", "script_interpreter",
                   "interpreter_caps", "git_tracking", "plan_backfill"}, ids
    for f in payload["findings"]:
        assert f["status"] in ("PASS", "WARN", "FAIL")
        assert f["evidence"], f"{f['id']} 没有证据"


# ------------------------------------------------------------------ 直接跑
def _run_all_tests():
    """没有 pytest 时的兜底入口。"""
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"[ok]   {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"[FAIL] {fn.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"[ERR]  {fn.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(_run_all_tests())
