"""R8.0 · 中性灰白模渲染（从既有条件通道后处理，不重跑光栅）。

为什么从条件通道后处理
======================
R1/R2 已经为每个镜头落了 `conditions/frame_*/cond_normal.png` 与 `cond_mask.png`，
它们与 `cond_depth/seg` 来自**同一次光栅化**。白模视频只需要「几何 + 法线 + 遮挡」，
所以直接从 normal + mask 合成中性灰图，既不改 R1 的渲染器，也不产生第二套几何口径。

关键口径
========
* 全灰：不引入 seg 调色板，避免视频模型把替身颜色渗进成片。
* 世界固定光：和相机无关，镜头转动时高光/明暗会随几何变化，给视频模型 3D 线索。
* 背景固定浅灰；前景与背景只靠法线明暗区分。
* 帧号、fps、时长与 `shot_spec.json` / `camera_intrinsics.json` 一致。
"""
from __future__ import annotations

import glob
import json
import os
import re
import struct
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# 世界固定光：方向归一化后使用；和 camera_moves 的相机基无关。
LIGHT = np.array([0.45, 0.35, 0.82], dtype=np.float64)
LIGHT = LIGHT / np.linalg.norm(LIGHT)

BACKGROUND = 0.700          # 中灰背景（0..1），比白底更能读出体积
AMBIENT = 0.40              # 背光面
DIFFUSE = 0.58              # 受光面增量


def _frame_dirs(conditions_dir: str) -> list[str]:
    dirs = sorted(glob.glob(os.path.join(conditions_dir, "frame_*")))
    return [d for d in dirs if os.path.isdir(d)]


def _load_normal_mask(frame_dir: str):
    npath = os.path.join(frame_dir, "cond_normal.png")
    mpath = os.path.join(frame_dir, "cond_mask.png")
    if not os.path.exists(npath) or not os.path.exists(mpath):
        raise FileNotFoundError(f"{frame_dir} 缺少 cond_normal.png 或 cond_mask.png")
    normal = np.asarray(Image.open(npath).convert("RGB"), dtype=np.float64) / 255.0
    normal = normal * 2.0 - 1.0
    length = np.linalg.norm(normal, axis=2, keepdims=True)
    normal = normal / np.maximum(length, 1e-9)
    mask = np.asarray(Image.open(mpath).convert("L"), dtype=np.uint8) > 127
    return normal, mask


def _character_mask(frame_dir: str) -> np.ndarray | None:
    """从 seg 通道取 character 调色板色，得到主体掩码。

    为什么不用 mask 通道：mask 的前景包含地面/道路，能排除全空帧，但证明不了
    "人还在画里"。seg 的 character 色是唯一能单独数主体的通道。
    """
    seg_path = os.path.join(frame_dir, "cond_seg.png")
    side_path = os.path.join(frame_dir, "cond_seg.json")
    if not os.path.exists(seg_path) or not os.path.exists(side_path):
        return None
    try:
        side = json.load(open(side_path, encoding="utf-8"))
        palette = (side.get("encoding") or {}).get("palette") or {}
        color = palette.get("character")
        if not color:
            return None
        seg = np.asarray(Image.open(seg_path).convert("RGB"), dtype=np.uint8)
        return np.all(seg == np.asarray(color, dtype=np.uint8), axis=2)
    except Exception:
        return None


def compose_clay(normal: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """normal + mask → 中性灰单通道图（0..255）。"""
    lam = np.clip(normal @ LIGHT, 0.0, 1.0)
    shade = AMBIENT + DIFFUSE * lam
    gray = np.where(mask, shade, BACKGROUND)
    return np.clip(gray * 255.0, 0, 255).astype(np.uint8)


def write_contact_sheet(frames: list[str], out_path: str, fps: float, cols: int = 4,
                        rows: int = 2) -> None:
    """抽 8 帧拼一张联系表，标签写时间。"""
    if not frames:
        return
    picks = [frames[int(round(k * (len(frames) - 1) / 7.0))] for k in range(8)]
    thumbs = [Image.open(p).convert("RGB") for p in picks]
    tw, th = thumbs[0].size
    scale = min(1.0, 360.0 / tw)
    tw, th = int(tw * scale), int(th * scale)
    sheet = Image.new("RGB", (tw * cols, (th + 24) * rows), (250, 250, 251))
    draw = ImageDraw.Draw(sheet)
    for k, (path, im) in enumerate(zip(picks, thumbs)):
        im = im.resize((tw, th), Image.LANCZOS)
        x, y = (k % cols) * tw, (k // cols) * (th + 24)
        sheet.paste(im, (x, y))
        idx = int(re.search(r"frame_(\d+)", os.path.basename(path)).group(1))
        draw.text((x + 6, y + th + 5), f"frame {idx:04d}  t={idx / fps:.2f}s",
                  fill=(60, 65, 75))
    sheet.save(out_path, "JPEG", quality=90)


def ffmpeg_exe() -> str | None:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    # 兼容 PATH 里的 ffmpeg
    for name in ("ffmpeg", "ffmpeg.exe"):
        for base in os.environ.get("PATH", "").split(os.pathsep):
            cand = os.path.join(base, name)
            if os.path.exists(cand):
                return cand
    return None


def write_mjpeg_avi(path: str, jpegs: list[bytes], width: int, height: int, fps: float) -> str:
    """纯 Python MJPEG AVI（无 ffmpeg 时的兜底；逐帧无损于 JPEG 原帧）。"""
    n = len(jpegs)
    micro = int(round(1e6 / float(fps)))

    def chunk(fourcc: bytes, data: bytes) -> bytes:
        out = fourcc + struct.pack("<I", len(data)) + data
        if len(data) % 2:
            out += b"\x00"
        return out

    max_frame = max(len(j) for j in jpegs)
    avih = struct.pack("<IIIIIIIIIIIIII", micro, int(fps * n), 0, 0x10,
                       n, 0, 1, max_frame, width, height, 0, 0, 0, 0)
    strh = struct.pack("<4s4sIHHIIIIIIIIhhhh", b"vids", b"MJPG", 0, 0, 0, 0,
                       1, int(fps), 0, n, max_frame, 0xFFFFFFFF, 0, 0, 0,
                       width, height)
    strf = struct.pack("<IiiHH4sIiiII", 40, width, height, 1, 24, b"MJPG",
                       width * height * 3, 0, 0, 0, 0)
    strl = chunk(b"LIST", b"strl" + chunk(b"strh", strh) + chunk(b"strf", strf))
    hdrl = chunk(b"LIST", b"hdrl" + chunk(b"avih", avih) + strl)
    movi_body = bytearray()
    index = []
    for j in jpegs:
        off = len(movi_body) + 4
        movi_body.extend(chunk(b"00dc", j))
        index.append(struct.pack("<4sIII", b"00dc", 0x10, off, len(j)))
    movi = chunk(b"LIST", b"movi" + bytes(movi_body))
    idx1 = chunk(b"idx1", b"".join(index))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"RIFF" + struct.pack("<I", 4 + len(hdrl) + len(movi) + len(idx1)))
        fh.write(b"AVI " + hdrl + movi + idx1)
    return path


def encode_video(frames_dir: str, out_mp4: str, out_avi: str, fps: float,
                 width: int, height: int, jpegs: list[bytes]) -> dict:
    """优先 MP4（H.264），失败回退 MJPEG AVI。"""
    ff = ffmpeg_exe()
    if os.path.exists(out_mp4):
        os.remove(out_mp4)
    if ff:
        pattern = os.path.join(frames_dir, "frame_%04d.jpg")
        cmd = [ff, "-y", "-framerate", str(fps), "-i", pattern,
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
               "-movflags", "+faststart", out_mp4]
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            return {"path": out_mp4, "format": "mp4", "codec": "h264", "encoder": ff}
        except Exception as exc:
            print(f"[r8] ffmpeg 编码失败，回退 AVI：{exc}")
            if os.path.exists(out_mp4):
                os.remove(out_mp4)
    write_mjpeg_avi(out_avi, jpegs, width, height, fps)
    return {"path": out_avi, "format": "avi", "codec": "mjpeg", "encoder": "pure-python"}


def _diff(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a.astype(np.float64) - b.astype(np.float64))))


def render_clay(shot_dir: str, fps: float | None = None) -> dict:
    """读 conditions/，写 clay/ 帧序列 + 联系表 + 视频 + index.json。"""
    spec_path = os.path.join(shot_dir, "shot_spec.json")
    spec = json.load(open(spec_path, encoding="utf-8"))
    fps = float(fps or spec.get("fps") or 24)
    cond_dir = os.path.join(shot_dir, "conditions")
    frame_dirs = _frame_dirs(cond_dir)
    if not frame_dirs:
        raise FileNotFoundError(f"{shot_dir} 没有 conditions/frame_*")

    out_dir = os.path.join(shot_dir, "clay")
    os.makedirs(out_dir, exist_ok=True)
    jpegs: list[bytes] = []
    grays: list[np.ndarray] = []
    per_frame = []
    masks = []
    subject_ratios = []
    subject_heights = []
    width = height = None

    for i, fdir in enumerate(frame_dirs):
        normal, mask = _load_normal_mask(fdir)
        if width is None:
            height, width = mask.shape
        gray = compose_clay(normal, mask)
        grays.append(gray)
        masks.append(mask)
        subj = _character_mask(fdir)
        subj_ratio = None
        subj_height = None
        if subj is not None:
            subj_ratio = float(subj.mean())
            ys, _xs = np.where(subj)
            if ys.size:
                subj_height = float((ys.max() - ys.min() + 1) / height)
            subject_ratios.append(subj_ratio)
            if subj_height is not None:
                subject_heights.append(subj_height)
        out = os.path.join(out_dir, f"frame_{i:04d}.jpg")
        Image.fromarray(gray, "L").save(out, "JPEG", quality=92)
        with open(out, "rb") as fh:
            jpegs.append(fh.read())
        per_frame.append({
            "frame": i,
            "t": round(i / fps, 4),
            "foreground_ratio": round(float(mask.mean()), 6),
            "subject_ratio": None if subj_ratio is None else round(subj_ratio, 6),
            "subject_height_ratio": None if subj_height is None else round(subj_height, 4),
            "mean_gray": round(float(gray.mean()), 3),
        })

    # 时间差分：首帧结算检查（f0→f1 ÷ f1→f2；越接近 1 越正常）
    diffs = [None] + [_diff(grays[i - 1], grays[i]) for i in range(1, len(grays))]
    first_ratio = None
    if len(diffs) >= 3 and diffs[1] and diffs[2]:
        first_ratio = round(float(diffs[1] / max(diffs[2], 1e-6)), 4)
    first_settled = None if first_ratio is None else bool(first_ratio < 2.0)

    contact = os.path.join(out_dir, "contact_sheet.jpg")
    write_contact_sheet([os.path.join(out_dir, f"frame_{i:04d}.jpg")
                         for i in range(len(jpegs))], contact, fps)

    video = encode_video(out_dir, os.path.join(out_dir, "clay.mp4"),
                         os.path.join(out_dir, "clay.avi"), fps, width, height, jpegs)

    index = {
        "kind": "r8_clay_render",
        "schema": "r8-clay/1",
        "shot_id": spec.get("shot_id"),
        "move_type": spec.get("move_type"),
        "fps": fps,
        "frames": len(jpegs),
        "resolution": [width, height],
        "source": "conditions/frame_*/cond_normal.png + cond_mask.png（同一次光栅化）",
        "material": {
            "mode": "neutral_gray",
            "background": BACKGROUND,
            "ambient": AMBIENT,
            "diffuse": DIFFUSE,
            "light_world": [round(float(x), 4) for x in LIGHT],
            "note": "不引用 seg 调色板；全灰，避免视频模型的颜色泄漏",
        },
        "video": os.path.basename(video["path"]),
        "video_meta": {k: v for k, v in video.items() if k != "encoder"},
        "contact_sheet": os.path.basename(contact),
        "checks": {
            "frame_count_ok": len(jpegs) == int(spec.get("duration_s", 5) * fps),
            "foreground_min": round(float(min(m.mean() for m in masks)), 6),
            "foreground_max": round(float(max(m.mean() for m in masks)), 6),
            "subject_min": round(float(min(subject_ratios)), 6) if subject_ratios else None,
            "subject_max": round(float(max(subject_ratios)), 6) if subject_ratios else None,
            "subject_height_mean": round(float(np.mean(subject_heights)), 4) if subject_heights else None,
            "subject_present": bool(subject_ratios and min(subject_ratios) > 0.001
                                    and subject_heights and min(subject_heights) > 0.03),
            "first_frame_settle_ratio": first_ratio,
            "first_frame_settled": first_settled,
            "all_gray": True,
        },
        "per_frame": per_frame,
    }
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return index


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="R8.0 中性灰白模渲染")
    ap.add_argument("shots", nargs="+", help="镜头目录（如 shots/shot_orbit）")
    args = ap.parse_args()
    for shot in args.shots:
        d = shot if os.path.isabs(shot) else os.path.join(ROOT, shot)
        idx = render_clay(d)
        print(json.dumps({"shot": idx["shot_id"], "video": idx["video"],
                          "frames": idx["frames"], "checks": idx["checks"]},
                         ensure_ascii=False))
