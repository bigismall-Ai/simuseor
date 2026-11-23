"""R8.0 · 白模接口探针：一次跑通 clay → prompt → request → mock → 自检。

这一层不接下游模型。它只证明：
  1. 每个镜头都有中性灰白模视频（不是彩色预览）；
  2. 每个镜头都有从几何量出的 prompt 与参考绑定；
  3. 每个镜头都有本地模型可读的 request + 评分表；
  4. 文件/时长/fps/分辨率/首帧结算这些机器可判的东西全部过。

下游本地模型接入后，适配器读 `probe/request.json`，写 `probe/result.json` 与
`probe/generated.mp4`；本脚本的 `--check` 会继续检查结果文件。
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import r8_clay
import r8_prompt

DEFAULT_SHOTS = ["shot_dolly_in", "shot_orbit", "shot_follow"]
VALIDATION = os.path.join(ROOT, "assets", "validation", "r8_probe.json")


def _dir(shot: str) -> str:
    if os.path.isabs(shot):
        return shot
    if os.sep in shot or "/" in shot:
        return os.path.join(ROOT, shot)
    return os.path.join(ROOT, "shots", shot)


def _write(path: str, obj) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def _read(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _exists(*parts: str) -> bool:
    return os.path.exists(os.path.join(*parts))


def video_info(path: str) -> dict:
    """用 ffmpeg -i 的 stderr 读时长/fps/分辨率；读不到就返回空。"""
    ff = r8_clay.ffmpeg_exe()
    if not ff or not os.path.exists(path):
        return {}
    proc = subprocess.run([ff, "-i", path], capture_output=True, text=True,
                          errors="ignore")
    text = (proc.stderr or "") + (proc.stdout or "")
    out = {}
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
        out["duration_s"] = round(h * 3600 + mi * 60 + s, 3)
    m = re.search(r"(\d{2,5})x(\d{2,5})", text)
    if m:
        out["resolution"] = [int(m.group(1)), int(m.group(2))]
    m = re.search(r"(\d+(?:\.\d+)?)\s*fps", text)
    if m:
        out["fps"] = float(m.group(1))
    m = re.search(r"Video:\s*([a-zA-Z0-9]+)", text)
    if m:
        out["codec"] = m.group(1)
    return out


def check_shot(shot: str) -> dict:
    d = _dir(shot)
    checks = []

    def add(code, ok, message, hint=""):
        checks.append({"code": code, "ok": bool(ok), "message": message, "hint": hint})

    spec_path = os.path.join(d, "shot_spec.json")
    add("SHOT_SPEC", os.path.exists(spec_path), "shot_spec.json", "镜头包缺 spec")
    if not os.path.exists(spec_path):
        return {"shot_id": os.path.basename(d), "checks": checks, "pass": False}

    spec = _read(spec_path)
    fps = float(spec.get("fps") or 24)
    duration = float(spec.get("duration_s") or 5)
    res = spec.get("resolution") or [720, 404]
    n_expected = int(round(fps * duration))

    clay_dir = os.path.join(d, "clay")
    idx_path = os.path.join(clay_dir, "index.json")
    add("CLAY_INDEX", os.path.exists(idx_path), "clay/index.json", "先跑 --render")
    idx = _read(idx_path) if os.path.exists(idx_path) else {}
    clay_video = os.path.join(clay_dir, "clay.mp4")
    if not os.path.exists(clay_video):
        clay_video = os.path.join(clay_dir, "clay.avi")
    add("CLAY_VIDEO", os.path.exists(clay_video), os.path.basename(clay_video), "先跑 --render")
    add("CLAY_FRAMES", len(idx.get("per_frame") or []) == n_expected,
        f"帧数 {len(idx.get('per_frame') or [])}/{n_expected}", "检查 conditions 是否完整")
    add("CLAY_COUNT", bool((idx.get("checks") or {}).get("frame_count_ok")),
        f"frame_count_ok={(idx.get('checks') or {}).get('frame_count_ok')}", "帧数应与 duration×fps 一致")
    add("CLAY_FOREGROUND", float((idx.get("checks") or {}).get("foreground_min") or 0) > 0.001,
        f"foreground_min={(idx.get('checks') or {}).get('foreground_min')}", "白模可能全空")
    add("CLAY_SUBJECT", bool((idx.get("checks") or {}).get("subject_present")),
        f"subject_min={(idx.get('checks') or {}).get('subject_min')} "
        f"height_mean={(idx.get('checks') or {}).get('subject_height_mean')}",
        "主体可能在画外/过小；用 seg character 掩码复查")
    settle = (idx.get("checks") or {}).get("first_frame_settled")
    add("CLAY_FIRST_FRAME", settle is not False,
        f"first_frame_settled={settle} ratio={(idx.get('checks') or {}).get('first_frame_settle_ratio')}",
        "首帧可能未结算；量 f0→f1 / f1→f2，必要时做帧手术")
    add("CLAY_GRAY", bool((idx.get("checks") or {}).get("all_gray")),
        "全灰模式", "视频参考不应带 seg 颜色")

    if os.path.exists(clay_video):
        info = video_info(clay_video)
        add("CLAY_DURATION", info.get("duration_s") is not None
            and abs(float(info["duration_s"]) - duration) <= 0.08,
            f"时长 {info.get('duration_s')} / 目标 {duration}", "检查视频帧数/编码")
        add("CLAY_FPS", info.get("fps") is not None and abs(float(info["fps"]) - fps) <= 0.1,
            f"fps {info.get('fps')} / 目标 {fps}", "检查编码参数")
        add("CLAY_RESOLUTION", info.get("resolution") == list(res),
            f"分辨率 {info.get('resolution')} / 目标 {res}", "检查渲染尺寸")
    else:
        info = {}

    for rel in ("prompt/prompt.md", "prompt/prompt.json", "refs/refs.json",
                "narrative.json", "refs/bindings.json",
                "probe/request.json", "probe/score_sheet.json"):
        add("PROMPT_FILE:" + rel, _exists(d, rel), rel, "先跑 --prompt")

    prompt = _read(os.path.join(d, "prompt", "prompt.json")) if _exists(d, "prompt", "prompt.json") else {}
    measured = prompt.get("measured") or {}
    add("PROMPT_STATUS", prompt.get("status") == "ready", f"status={prompt.get('status')}", "clay 就绪后再生成 prompt")
    add("PROMPT_FACTS", all(measured.get(k) for k in
                            ("lens_mm", "distance_m", "camera_height_m",
                             "subject_height_ratio_mean", "shot_size")),
        "镜头事实齐全", "数字必须从 intrinsics/validation 量出")
    add("PROMPT_MOVE", bool((prompt.get("move") or {}).get("type")),
        f"move={(prompt.get('move') or {}).get('type')}", "缺少运镜类型")

    narrative = _read(os.path.join(d, "narrative.json")) if _exists(d, "narrative.json") else {}
    segs = narrative.get("segments") or []
    no_placeholder = all("[待填" not in str(s.get("action", "")) for s in segs)
    add("NARRATIVE", bool(segs) and no_placeholder,
        f"segments={len(segs)} placeholder={'有' if not no_placeholder else '无'}",
        "在 narrative.json 里补时间线动作，不要留 [待填]")

    t_md = os.path.join(d, "prompt", "prompt_textonly.md")
    t_json = os.path.join(d, "prompt", "prompt_textonly.json")
    add("TEXTONLY_FILES", os.path.exists(t_md) and os.path.exists(t_json),
        "prompt_textonly.md/json", "先跑 --prompt")
    t_text = open(t_md, encoding="utf-8").read() if os.path.exists(t_md) else ""
    add("TEXTONLY_CONTENT", "@图片" not in t_text and "【镜头事实】" in t_text,
        f"len={len(t_text)} contains_facts={'【镜头事实】' in t_text}",
        "text-only 版本不应依赖参考图，且必须带镜头事实")
    t_data = _read(t_json) if os.path.exists(t_json) else {}
    add("TEXTONLY_FACTS", (t_data.get("measured") or {}) == measured,
        "text-only 与 refs 版 measured 一致", "两版必须共用同一份几何事实")
    add("REFS_STATUS", prompt.get("refs_status") in ("ready", "partial"),
        f"refs_status={prompt.get('refs_status')}",
        "至少 @白模1 要 ready；@图片1/@图片2 可以 unbound")

    request = _read(os.path.join(d, "probe", "request.json")) if _exists(d, "probe", "request.json") else {}
    add("REQUEST_STATUS", request.get("status") == "ready",
        f"status={request.get('status')}", "prompt 就绪后再生成 request")
    add("REQUEST_CONTRACT", bool((request.get("output_contract") or {}).get("metadata")),
        "output_contract 存在", "本地模型适配器需要输出契约")

    mock_path = os.path.join(d, "probe", "result.mock.json")
    if os.path.exists(mock_path):
        mock = _read(mock_path)
        add("MOCK_RESULT", mock.get("status") == "mock", f"status={mock.get('status')}",
            "mock 只验证接口，不代表模型质量")

    result_path = os.path.join(d, "probe", "result.json")
    if os.path.exists(result_path):
        result = _read(result_path)
        required = (request.get("output_contract") or {}).get("required_fields") or []
        missing = [k for k in required if k not in result]
        add("RESULT_FIELDS", not missing,
            f"缺字段 {missing or '无'}", "按 request.output_contract.required_fields 写")
        add("RESULT_STATUS", result.get("status") in ("ok", "failed"),
            f"status={result.get('status')}", "status 必须是 ok / failed")
        vid = result.get("video")
        if vid and result.get("status") == "ok":
            vpath = vid if os.path.isabs(vid) else os.path.join(d, vid)
            add("RESULT_VIDEO", os.path.exists(vpath), str(vid),
                "真实运行必须写 probe/generated.mp4")
    else:
        add("RESULT_OPTIONAL", True,
            "probe/result.json 尚未生成（下游本地模型未接入）",
            "接入后由适配器写；本项不阻塞 R8.0")

    passed = all(c["ok"] for c in checks)
    return {
        "shot_id": spec.get("shot_id") or os.path.basename(d),
        "move_type": spec.get("move_type"),
        "clay": {
            "video": os.path.relpath(clay_video, d).replace(os.sep, "/"),
            "info": info,
            "index": os.path.relpath(idx_path, d).replace(os.sep, "/") if os.path.exists(idx_path) else None,
            "checks": idx.get("checks") if idx else None,
        },
        "prompt": {
            "status": prompt.get("status"),
            "refs_status": prompt.get("refs_status"),
            "measured": measured,
            "refs": prompt.get("refs"),
            "narrative": prompt.get("narrative"),
            "text_only": "prompt/prompt_textonly.md",
        },
        "request": {
            "status": request.get("status"),
            "path": "probe/request.json",
        },
        "score_sheet": "probe/score_sheet.json",
        "mock": "probe/result.mock.json" if os.path.exists(mock_path) else None,
        "result": "probe/result.json" if os.path.exists(result_path) else None,
        "checks": checks,
        "pass": passed,
    }


def run(shots: list[str], render: bool, prompt: bool, mock: bool, check: bool) -> dict:
    results = []
    for shot in shots:
        d = _dir(shot)
        if not os.path.isdir(d):
            results.append({"shot_id": shot, "pass": False,
                            "checks": [{"code": "SHOT_DIR", "ok": False,
                                        "message": d, "hint": "镜头目录不存在"}]})
            continue
        if render:
            idx = r8_clay.render_clay(d)
            print(f"[r8] clay {idx['shot_id']}: {idx['video']} ({idx['frames']} frames)")
        if prompt:
            pack = r8_prompt.write_prompt_pack(d)
            print(f"[r8] prompt {pack['facts']['shot_id']}: {pack['prompt']['status']}")
        if mock:
            res = r8_prompt.write_mock_result(d)
            print(f"[r8] mock {res['shot_id']}: {res['status']}")
        if check:
            row = check_shot(shot)
            results.append(row)
            print(f"[r8] check {row['shot_id']}: {'PASS' if row['pass'] else 'FAIL'} "
                  f"({sum(1 for c in row['checks'] if c['ok'])}/{len(row['checks'])})")
    refs_counts = {"ready": 0, "partial": 0, "blocked": 0}
    for r in results:
        status = ((r.get("prompt") or {}).get("refs_status")) or "blocked"
        refs_counts[status] = refs_counts.get(status, 0) + 1
    return {
        "kind": "r8_probe_report",
        "schema": "r8-probe/1",
        "generated_at": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "decisions": {
            "clay_material": "neutral_gray",
            "downstream": "not_integrated_local_first",
            "refs_policy": "bind images with --bind; text-only works without them",
            "shots": shots,
        },
        "shots": results,
        "summary": {
            "n_shots": len(results),
            "passed": sum(1 for r in results if r.get("pass")),
            "failed": sum(1 for r in results if not r.get("pass")),
            "all_pass": bool(results) and all(r.get("pass") for r in results),
            "refs_status": refs_counts,
            "downstream_models": [],
            "note": "下游本地模型尚未接入；本次只验证 clay/prompt/request 接口与机器可判项。",
        },
    }


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="R8.0 白模接口探针")
    ap.add_argument("--shots", default=",".join(DEFAULT_SHOTS),
                    help="逗号分隔的镜头名或路径")
    ap.add_argument("--all", action="store_true", help="render + prompt + mock + check + report")
    ap.add_argument("--render", action="store_true", help="生成 clay 帧/视频")
    ap.add_argument("--prompt", action="store_true", help="生成 prompt/refs/request/score")
    ap.add_argument("--mock", action="store_true", help="写 mock result（仅接口闭环）")
    ap.add_argument("--check", action="store_true", help="机器自检")
    return ap.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    shots = [s.strip() for s in args.shots.split(",") if s.strip()]
    if args.all:
        args.render = args.prompt = args.mock = args.check = True
    if not any((args.render, args.prompt, args.mock, args.check)):
        args.check = True
    report = run(shots, args.render, args.prompt, args.mock, args.check)
    if args.check:
        _write(VALIDATION, report)
        print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
        return 0 if report["summary"]["all_pass"] else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
