# R7 闭环驱动：云端 LLM 出配方 → 本地确定性执行 → 校验器判定 → hint → 修复。
#
# 一轮闭环
# --------
#   1. 提示词 = 任务规格（字段/区间/关系）+（修复轮再附上一轮配方与错误清单）
#   2. 云端 LLM 出 JSON 配方（唯一出口）
#   3. 本地执行器把配方变成几何（确定性，纯 CPU）
#   4. 校验器机器判定（形状/关系/几何/结构四层）
#   5. 失败项压成结构化 hint，进下一轮提示词（hint 链全程留痕）
#
# 落盘
# ----
#   assets/validation/r7_llm_tasks.json  任务库（规格 + 来源）
#   assets/validation/r7_llm_loop.json   逐任务记录（配方/判定/hint 链/调用）
#   assets/validation/r7_llm_calls.json  调用账（模型/次数/token/耗时，无密钥）
#
# 纪律：密钥不打印、不入库、不进读数文件；只走云端 API；本机不推理。
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import r7_contract as K
import r7_execute as X
import r7_judge as J
import r7_tasks as T
from r7_llm_client import LlmClient

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VAL = os.path.join(ROOT, "assets", "validation")

DEFAULT_MODEL = "minimax-direct/MiniMax-M3.1-Flash"


def _sha(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]


def _write(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ------------------------------------------------------------------ 自检

def selftest(tasks, out_path):
    """不调云端：用台账中心值（参考配方）跑一遍执行器+判定器。

    作用有两个：
      * 证明判据是可满足的（没有「谁也修不通过」的死条件）；
      * 给「参考配方本身过不过」一个基线，和 LLM 的首过率对照。
    """
    rows = []
    for task in tasks:
        recipe = {
            "kind": "r7_recipe", "schema": "r7-recipe/1",
            "task_id": task["task_id"], "asset_name": task["asset_name_hint"],
            "usage_level": task["usage_level"], "category": task["category"],
            "params": task.get("reference_params") or {},
            "license": {"spdx": "LicenseRef-Proprietary",
                        "credit": "程序化生成（harness/r7_execute.py，纯 CPU）",
                        "source_url": "", "attribution_required": True},
            "notes": "reference",
        }
        built = X.execute_deterministic(task, recipe)
        res = J.judge(task, recipe, built.get("built") or {"ok": False,
                                                           "error": built.get("error")})
        rows.append({
            "task_id": task["task_id"], "category": task["category"],
            "usage_level": task["usage_level"],
            "pass": bool(res["pass"]), "failed_codes": res["failed_codes"],
            "deterministic": bool(built.get("same")),
            "metrics": res.get("metrics") or {},
        })
    out = {
        "kind": "r7_selftest",
        "note": ("不调用云端：用 R4 台账中心值当参考配方，验证执行器与判据本身"
                 "是可满足的；这是 LLM 首过率的基线，不是 LLM 的成绩。"),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(rows),
        "passed": sum(1 for r in rows if r["pass"]),
        "failed": [r for r in rows if not r["pass"]],
        "rows": rows,
    }
    _write(out_path, out)
    return out


# ------------------------------------------------------------------ 单任务闭环

def run_task(task, client, model_ref, max_rounds, timeout_s=90.0,
              max_tokens=8000):
    record = {
        "task_id": task["task_id"],
        "category": task["category"],
        "family": task["family"],
        "instance": task["instance"],
        "usage_level": task["usage_level"],
        "budget_faces": task["budget_faces"],
        "pass": False,
        "first_pass": False,
        "rounds_used": 0,
        "llm_error": "",
        "rounds": [],
        "hint_chain": [],
    }
    previous = None
    hint_chain = []
    for rnd in range(max_rounds):
        prompt = K.build_user_prompt(task, previous, hint_chain)
        res = client.call(model_ref, K.SYSTEM_PROMPT, prompt,
                          max_tokens=max_tokens, temperature=0.2, timeout=timeout_s)
        llm_info = {
            "round": rnd,
            "model": res.get("model"),
            "provider": res.get("provider"),
            "protocol": res.get("protocol"),
            "usage": res.get("usage"),
            "latency_ms": res.get("latency_ms"),
            "http_status": res.get("http_status"),
            "attempts": res.get("attempts"),
            "ok": bool(res.get("ok")),
            "error": res.get("error", ""),
            "prompt_sha256": _sha(prompt),
            "response_sha256": _sha(res.get("text", "")),
        }
        if not res.get("ok"):
            record["llm_error"] = res.get("error", "")
            record["rounds"].append({"round": rnd, "llm": llm_info,
                                      "recipe": None, "checks": [],
                                      "failed_codes": ["LLM_CALL_FAILED"],
                                      "hint": [], "parse_error": res.get("error", "")})
            break

        raw = res.get("text", "")
        recipe, parse_error = K.extract_json(raw)
        built = X.execute_deterministic(task, recipe) if recipe is not None else \
            {"ok": False, "built": {"ok": False, "error": parse_error}, "same": False}
        judged = J.judge(task, recipe if isinstance(recipe, dict) else {},
                         built.get("built") or {"ok": False, "error": parse_error})
        hint = K.build_hint(judged["checks"])
        hint_chain.extend(hint)
        record["rounds"].append({
            "round": rnd,
            "llm": llm_info,
            "raw_response": raw[:4000],
            "recipe": recipe if isinstance(recipe, dict) else None,
            "parse_error": parse_error,
            "deterministic": bool(built.get("same")),
            "checks": judged["checks"],
            "failed_codes": judged["failed_codes"],
            "metrics": judged.get("metrics") or {},
            "hint": hint,
        })
        record["rounds_used"] = rnd + 1
        if judged["pass"]:
            record["pass"] = True
            record["first_pass"] = (rnd == 0)
            break
        previous = recipe if isinstance(recipe, dict) else previous
    record["hint_chain"] = hint_chain
    record["final_recipe"] = (record["rounds"][-1].get("recipe")
                              if record["rounds"] else None)
    return record


# ------------------------------------------------------------------ 主流程

def main():
    ap = argparse.ArgumentParser(description="R7 云端 LLM 验证闭环")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--rounds", type=int, default=3, help="最多几轮（1 首轮 + N-1 修复轮）")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0, help="最多跑多少个任务（0=全跑）")
    ap.add_argument("--per-category", type=int, default=0, help="每类最多跑多少个（0=不限）")
    ap.add_argument("--categories", default="", help="只跑这些类别，逗号分隔")
    ap.add_argument("--timeout", type=float, default=90.0)
    ap.add_argument("--selftest", action="store_true", help="只跑参考配方自检（不调云端）")
    args = ap.parse_args()

    tasks = T.build_tasks()
    cats = [c.strip() for c in args.categories.split(",") if c.strip()]
    if cats:
        tasks = [t for t in tasks if t["category"] in cats]
    if args.per_category:
        seen = {}
        keep = []
        for t in tasks:
            seen[t["category"]] = seen.get(t["category"], 0) + 1
            if seen[t["category"]] <= args.per_category:
                keep.append(t)
        tasks = keep
    if args.limit:
        tasks = tasks[:args.limit]

    os.makedirs(VAL, exist_ok=True)
    _write(os.path.join(VAL, "r7_llm_tasks.json"), {
        "kind": "r7_tasks",
        "note": ("R7 任务库：规格来自 R4 台账（只读引用），"
                 "实例按固定倍率档位派生；每类样本 ≥ 20。"),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "buckets": T.bucket_stats(tasks),
        "tasks": tasks,
    })

    if args.selftest:
        out = selftest(tasks, os.path.join(VAL, "r7_llm_selftest.json"))
        print("[selftest] %d/%d 通过（参考配方基线，未调用云端）"
              % (out["passed"], out["total"]))
        for row in out["failed"][:10]:
            print("   FAIL %-34s %s" % (row["task_id"], row["failed_codes"]))
        return 0

    client = LlmClient(timeout=args.timeout)
    status = client.credential_status(args.model)
    if not status["ok"]:
        print("[block] 没有可用凭据：%s" % status.get("reason"))
        print("[block] 可用模型：%s"
              % ", ".join(m["ref"] for m in client.list_models()))
        return 2

    started = time.time()
    records = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [pool.submit(run_task, t, client, args.model, args.rounds, args.timeout)
                   for t in tasks]
        for i, fut in enumerate(futures, 1):
            rec = fut.result()
            records.append(rec)
            print("[%3d/%d] %-34s pass=%-5s rounds=%d %s"
                  % (i, len(tasks), rec["task_id"], rec["pass"], rec["rounds_used"],
                     rec["llm_error"] or ""))

    calls = []
    for rec in records:
        for rnd in rec["rounds"]:
            llm = rnd.get("llm") or {}
            calls.append({
                "task_id": rec["task_id"], "round": rnd["round"],
                "model": llm.get("model"), "provider": llm.get("provider"),
                "protocol": llm.get("protocol"), "usage": llm.get("usage"),
                "latency_ms": llm.get("latency_ms"), "http_status": llm.get("http_status"),
                "attempts": llm.get("attempts"), "ok": llm.get("ok"),
                "error": llm.get("error", ""),
                "prompt_sha256": llm.get("prompt_sha256"),
                "response_sha256": llm.get("response_sha256"),
            })

    _write(os.path.join(VAL, "r7_llm_loop.json"), {
        "kind": "r7_llm_loop",
        "note": ("逐任务闭环记录：每轮的配方、机器判定、hint 链与调用账。"
                 "密钥不落盘：这里只有模型名、token 用量与判定结果。"),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model": args.model,
        "max_rounds": args.rounds,
        "workers": args.workers,
        "elapsed_s": round(time.time() - started, 1),
        "buckets": T.bucket_stats(tasks),
        "records": records,
    })
    _write(os.path.join(VAL, "r7_llm_calls.json"), {
        "kind": "r7_llm_calls",
        "note": "云端调用账：模型名/协议/token 用量/耗时/HTTP 状态；不含任何凭据。",
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model": args.model,
        "calls": calls,
        "summary": {
            "calls": len(calls),
            "ok": sum(1 for c in calls if c["ok"]),
            "failed": sum(1 for c in calls if not c["ok"]),
            "prompt_tokens": sum((c.get("usage") or {}).get("prompt_tokens", 0) for c in calls),
            "completion_tokens": sum((c.get("usage") or {}).get("completion_tokens", 0)
                                     for c in calls),
            "total_tokens": sum((c.get("usage") or {}).get("total_tokens", 0) for c in calls),
        },
    })
    passed = sum(1 for r in records if r["pass"])
    first = sum(1 for r in records if r["first_pass"])
    print("[done] %d/%d 通过；首过 %d；用时 %.1fs"
          % (passed, len(records), first, time.time() - started))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
