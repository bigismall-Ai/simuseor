# R7 统计：首过率、3 轮内收敛率、失败分布（从闭环记录重算，不重新调云端）。
#
# 口径（PLAN.md §6 的 V5）
# ----------------------
# * 首过率        = 第 1 轮（首次执行）就通过机器判定的比例；
# * 3 轮内收敛率  = 在最多 3 次执行内通过机器判定的比例；
# * 判定权在校验器：模型自评、模型说「我改好了」都不算；
# * LLM 调用失败（网络/凭据）单独计，不混进「配方不通过」里。
#
# 分档：按类别（五类资产）与按用途档位（low/mid/hero）各出一份，
# 每档样本数一起落盘（ROADMAP R7 验收要求每档 ≥ 20）。
from __future__ import annotations

import argparse
import collections
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VAL = os.path.join(ROOT, "assets", "validation")

MIN_SAMPLES = 20


def _read(path, default=None):
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return default


def _rate(num, den):
    return round(num / den, 4) if den else None


def _group_stats(records):
    n = len(records)
    first = sum(1 for r in records if r.get("first_pass"))
    passed = sum(1 for r in records if r.get("pass"))
    llm_errors = sum(1 for r in records if r.get("llm_error"))
    judged = n - llm_errors
    rounds_used = [r.get("rounds_used") or 0 for r in records if r.get("pass")]
    fail_codes = collections.Counter()
    for r in records:
        if r.get("pass") or r.get("llm_error"):
            continue
        rounds = r.get("rounds") or []
        codes = rounds[-1].get("failed_codes") if rounds else []
        for c in codes:
            fail_codes[c] += 1
    curve = collections.Counter()
    for r in records:
        for i, rnd in enumerate(r.get("rounds") or []):
            if rnd.get("failed_codes") == [] and not (rnd.get("parse_error") or ""):
                curve[i] += 1
                break
    cum = []
    run = 0
    for i in range(4):
        run += curve.get(i, 0)
        cum.append({"round": i + 1, "cumulative_pass": run,
                    "cumulative_rate": _rate(run, judged)})
    return {
        "samples": n,
        "judged_samples": judged,
        "llm_errors": llm_errors,
        "first_pass": first,
        "first_pass_rate": _rate(first, judged),
        "converged_within_3": passed,
        "converged_within_3_rate": _rate(passed, judged),
        "mean_rounds_to_pass": (round(sum(rounds_used) / len(rounds_used), 3)
                                if rounds_used else None),
        "convergence_curve": cum,
        "final_failed_codes": dict(fail_codes.most_common()),
    }


def build_report(loop_path, calls_path):
    loop = _read(loop_path) or {}
    calls_doc = _read(calls_path) or {}
    records = loop.get("records") or []
    calls = calls_doc.get("calls") or []

    by_cat = collections.defaultdict(list)
    by_tier = collections.defaultdict(list)
    for r in records:
        by_cat[r.get("category")].append(r)
        by_tier[r.get("usage_level")].append(r)

    call_summary = dict(calls_doc.get("summary") or {})
    if not call_summary and calls:
        call_summary = {
            "calls": len(calls),
            "ok": sum(1 for c in calls if c.get("ok")),
            "failed": sum(1 for c in calls if not c.get("ok")),
            "prompt_tokens": sum((c.get("usage") or {}).get("prompt_tokens", 0) for c in calls),
            "completion_tokens": sum((c.get("usage") or {}).get("completion_tokens", 0)
                                     for c in calls),
            "total_tokens": sum((c.get("usage") or {}).get("total_tokens", 0) for c in calls),
        }

    groups = {
        "overall": _group_stats(records),
        "by_category": {k: _group_stats(v) for k, v in sorted(by_cat.items())},
        "by_tier": {k: _group_stats(v) for k, v in sorted(by_tier.items())},
    }
    small = [name for name, g in groups["by_category"].items() if g["samples"] < MIN_SAMPLES]
    small += [("tier:" + name) for name, g in groups["by_tier"].items()
              if g["samples"] < MIN_SAMPLES]

    models = sorted({c.get("model") for c in calls if c.get("model")})
    providers = sorted({c.get("provider") for c in calls if c.get("provider")})

    return {
        "kind": "r7_llm_stats",
        "note": ("V5 统计：首过率 = 首次执行即通过机器判定的比例；"
                 "3 轮内收敛率 = 最多 3 次执行内通过的比例。"
                 "判定权在校验器（模型自评不算）；LLM 调用失败单独计。"),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model": loop.get("model"),
        "models_used": models,
        "providers_used": providers,
        "max_rounds": loop.get("max_rounds"),
        "elapsed_s": loop.get("elapsed_s"),
        "sample_floor": MIN_SAMPLES,
        "buckets_below_floor": small,
        "calls": call_summary,
        "stats": groups,
    }


def main():
    ap = argparse.ArgumentParser(description="R7 统计（首过率 / 3 轮内收敛率）")
    ap.add_argument("--loop", default=os.path.join(VAL, "r7_llm_loop.json"))
    ap.add_argument("--calls", default=os.path.join(VAL, "r7_llm_calls.json"))
    ap.add_argument("--out", default=os.path.join(VAL, "r7_llm_stats.json"))
    args = ap.parse_args()

    report = build_report(args.loop, args.calls)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps(report["stats"]["overall"], ensure_ascii=False, indent=2))
    print("calls:", json.dumps(report["calls"], ensure_ascii=False))
    print("written:", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
