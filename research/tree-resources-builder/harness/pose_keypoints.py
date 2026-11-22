"""Pose 关键点：3D 关节源 -> 下游关键点闭集（COCO-18 / OpenPose-25 / human_rig_21）。

这是 R1 的新增模块。R0 的 pose 通道只有「本项目具名骨架的静态 rest pose」，
R1 把它接到**真正的关节序列**上（SOMA 77 公共关节），并按 ROADMAP §4 R1
补出 COCO-18 / OpenPose-25 两个下游闭集。

分工（唯一事实源在 harness/condition_contract.py）
==================================================
* **源 source**：一组具名 3D 关节。
  - `soma77`：SOMA 的 77 个公共关节（动画序列用，来源是 assets/nongeometry/*.npz 的
    `joints` 数组，与 pose_store.py 读的是同一份数）。
  - `rig21`：项目自有骨架（静态角色用，与 character_rig.json 同源）。
* **视图 view**：面向下游的关键点闭集 —— human_rig_21 / coco18 / openpose25。
  闭集（名单 + 顺序 + 骨段）写在 condition_contract.POSE_VIEWS。
* **角色 role**：视图关键点 -> 源关节。映射表写在 condition_contract.POSE_ROLE_SOURCES，
  取值只有四种：`joint`（直接取）/ `midpoint`（两关节中点）/ `centroid`（多关节质心）/
  `None`（该源没有这个节点 -> 标 unavailable，**不编造坐标**）。

三个视图是同一 3D 关节源的三种投影，走同一相机、同一数值链，所以可以机械互验
（这就是「关键点图与 pose_store 的关节序列数值一致」能自动验的原因）。

一个必须记住的坑：Root 偏移
==========================
SOMA 输出的 77 个公共关节**不含 Root**（= `_public_joint_names[1:]`）。
于是踝关节是 69 / 74，70 / 75 是**趾根**。名字表（含 Root）里 LeftFoot=70，
直接拿去索引不含 Root 的数组就会整体错一位——本仓库历史上
`pose_store.ANK_L=70` / `render_shot.ANK_L=70` 用的其实是趾根。
本模块用 `SOMA_INDEX_ANCHORS` + `verify_soma_source()` 把这条钉死：名字与下标对不上
就抛错，不让错位的映射悄悄出图。

用法
====
    from pose_keypoints import JointSource, project_view, draw_view, build_pose_payload

    src = JointSource.from_soma77(joints_frame)          # (77, 3) 世界坐标（Z-up，米）
    kps = project_view(src, cam, "coco18")                # 投影成 2D 关键点
    img = draw_view(kps, "coco18", width, height)         # 画骨架
    doc = build_pose_payload(src, cam, (width, height), f_px, {"coco18": kps})
"""

from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image, ImageDraw

from condition_contract import (
    POSE_BACKGROUND,
    POSE_CANONICAL_KEYPOINT_SET,
    POSE_JOINT_RADIUS_PX,
    POSE_KEYPOINT_SETS,
    POSE_LIMB_WIDTH_PX,
    POSE_ROLE_SOURCES,
    POSE_UNAVAILABLE_REASONS,
    POSE_VIEWS,
    pose_role_color,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NGEO = os.path.join(ROOT, "assets", "nongeometry")

SOMA_JOINT_COUNT = 77
SOMA_NAMES_FILE = os.path.join(NGEO, "soma_anny_adult_joints.json")

# 索引锚点：SOMA 的 77 个公共关节不含 Root，这些下标必须与名字表对上。
# （含 Root 的名字表里 LeftFoot=70；不含 Root 的数组里左踝是 69。）
SOMA_INDEX_ANCHORS = {
    "Hips": 0, "Spine1": 1, "Spine2": 2, "Chest": 3, "Neck1": 4, "Neck2": 5,
    "Head": 6, "HeadEnd": 7, "LeftEye": 9, "RightEye": 10,
    "LeftArm": 12, "LeftForeArm": 13, "LeftHand": 14,
    "RightArm": 40, "RightForeArm": 41, "RightHand": 42,
    "LeftLeg": 67, "LeftShin": 68, "LeftFoot": 69, "LeftToeBase": 70,
    "LeftToeEnd": 71,
    "RightLeg": 72, "RightShin": 73, "RightFoot": 74, "RightToeBase": 75,
    "RightToeEnd": 76,
}


# ------------------------------------------------------------------ 关节源
def load_soma_joint_names(path=None):
    """读 SOMA 的 77 个公共关节名字（去掉 Root），并校验索引锚点。

    名字表来自项目自己的产物 assets/nongeometry/soma_anny_adult_joints.json
    （`names` 去掉首项 Root 就是 77 个公共关节，与 pose_store 的口径一致）。
    """
    path = path or SOMA_NAMES_FILE
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    names = tuple(str(n) for n in doc.get("names", []))
    if names and names[0] == "Root":
        names = names[1:]
    if len(names) != SOMA_JOINT_COUNT:
        raise ValueError(f"SOMA 关节名数量应为 {SOMA_JOINT_COUNT}，实际 {len(names)}（{path}）")
    for name, idx in SOMA_INDEX_ANCHORS.items():
        if names[idx] != name:
            raise ValueError(
                f"SOMA 关节顺序与锚点不符：names[{idx}] = {names[idx]!r}，期望 {name!r}"
                f"（{path}）——关节表换了，映射表必须同步改")
    return names


class JointSource:
    """一组具名 3D 关节（世界坐标、Z-up、米制）。"""

    def __init__(self, kind, names, points):
        if kind not in POSE_ROLE_SOURCES:
            raise ValueError(f"未知关节源类型 {kind!r}（支持 {tuple(POSE_ROLE_SOURCES)}）")
        self.kind = kind
        self.names = tuple(str(n) for n in names)
        self.points = np.asarray(points, dtype=np.float64)
        if self.points.shape != (len(self.names), 3):
            raise ValueError(f"关节坐标形状应为 ({len(self.names)}, 3)，实际 {self.points.shape}")
        self._index = {n: i for i, n in enumerate(self.names)}

    # -- 构造
    @classmethod
    def from_soma77(cls, joints, names=None):
        """从 (77, 3) 的 SOMA 关节数组建源。"""
        arr = np.asarray(joints, dtype=np.float64)
        if arr.shape != (SOMA_JOINT_COUNT, 3):
            raise ValueError(f"SOMA 关节数组形状应为 (77, 3)，实际 {arr.shape}")
        return cls("soma77", names or load_soma_joint_names(), arr)

    @classmethod
    def from_mapping(cls, mapping):
        """从 {名字: (x, y, z)} 建源（项目自有 rig / 静态角色）。"""
        names = tuple(mapping.keys())
        pts = np.asarray([mapping[n] for n in names], dtype=np.float64)
        return cls("rig21", names, pts)

    # -- 查询
    def index_of(self, joint_name):
        return self._index.get(joint_name)

    def points_for(self, joint_names):
        idx = []
        for n in joint_names:
            i = self._index.get(n)
            if i is None:
                raise KeyError(f"关节源 {self.kind} 里没有 {n!r}")
            idx.append(i)
        return self.points[idx], idx

    def resolve(self, role):
        """角色 -> (kind, 世界坐标, 源关节名, 源下标)。

        kind ∈ {joint, midpoint, centroid, unavailable}
        """
        spec = POSE_ROLE_SOURCES[self.kind].get(role)
        if spec is None:
            return ("unavailable", None, [], [])
        kind, joint_names = spec
        if isinstance(joint_names, str):        # ("joint", "Spine") -> ("Spine",)
            joint_names = (joint_names,)
        pts, idx = self.points_for(joint_names)
        if kind == "joint":
            world = pts[0]
        elif kind == "midpoint":
            world = pts.mean(axis=0)
        elif kind == "centroid":
            world = pts.mean(axis=0)
        else:
            raise ValueError(f"未知解析方式 {kind!r}")
        return (kind, world, list(joint_names), list(idx))


# ------------------------------------------------------------------ 投影
def project_view(source, cam, view_id):
    """把一个视图的关键点投影成 2D（像素坐标 + 深度 + 可见性）。"""
    if view_id not in POSE_VIEWS:
        raise ValueError(f"未知关键点视图 {view_id!r}（支持 {tuple(POSE_VIEWS)}）")
    view = POSE_VIEWS[view_id]
    out = []
    for i, (name, role) in enumerate(view["keypoints"]):
        kind, world, src_names, src_idx = source.resolve(role)
        if kind == "unavailable":
            out.append({
                "index": i, "name": name, "role": role,
                "x": None, "y": None, "depth_m": None, "visible": False,
                "in_frame": False, "world": None,
                "source": "unavailable", "source_kind": "unavailable",
                "source_joints": [], "source_indices": [],
                "reason": POSE_UNAVAILABLE_REASONS.get(role, "该源没有这个节点"),
            })
            continue
        px, z = cam.project(world.reshape(1, 3))
        x, y = float(px[0, 0]), float(px[0, 1])
        d = float(z[0])
        out.append({
            "index": i, "name": name, "role": role,
            "x": round(x, 3), "y": round(y, 3), "depth_m": round(d, 4),
            "visible": bool(d > 0.0),
            "in_frame": bool(d > 0.0 and 0 <= x < getattr(cam, "width", 0)
                             and 0 <= y < getattr(cam, "height", 0)),
            "world": [round(float(v), 6) for v in world],
            "source": (src_names[0] if kind == "joint" else
                       f"{kind}({','.join(src_names)})"),
            "source_kind": kind,
            "source_joints": list(src_names),
            "source_indices": list(src_idx),
        })
    return out


def draw_view(keypoints, view_id, width, height, background=POSE_BACKGROUND):
    """画 2D 骨架：骨段画线 + 关键点画圆点（无抗锯齿）。"""
    if view_id not in POSE_VIEWS:
        raise ValueError(f"未知关键点视图 {view_id!r}")
    img = Image.new("RGB", (int(width), int(height)), tuple(background))
    draw = ImageDraw.Draw(img)
    index = {kp["name"]: kp for kp in keypoints}
    for a, b in POSE_VIEWS[view_id]["bones"]:
        ka, kb = index.get(a), index.get(b)
        if ka is None or kb is None:
            continue
        if not (ka["visible"] and kb["visible"]):
            continue
        draw.line([(ka["x"], ka["y"]), (kb["x"], kb["y"])],
                  fill=pose_role_color(ka["role"]), width=POSE_LIMB_WIDTH_PX)
    r = POSE_JOINT_RADIUS_PX
    for kp in keypoints:
        if not kp["visible"]:
            continue
        c = pose_role_color(kp["role"])
        draw.ellipse([kp["x"] - r, kp["y"] - r, kp["x"] + r, kp["y"] + r], fill=c)
    return np.asarray(img, dtype=np.uint8)


def build_pose_payload(source, cam, resolution, f_px, views=None, extra=None):
    """构造关键点 JSON（三视图 + 源关节索引 + 相机 + 契约标识）。"""
    views = views or {}
    doc = {
        "kind": "pose_keypoints",
        "contract": "conditions_contract",
        "contract_version": "1.1.0",
        "canonical_view": POSE_CANONICAL_KEYPOINT_SET,
        "views": list(POSE_KEYPOINT_SETS),
        "resolution": [int(resolution[0]), int(resolution[1])],
        "f_px": round(float(f_px), 6),
        "up_axis": "Z",
        "units": "meter",
        "source": {
            "type": source.kind,
            "joint_count": len(source.names),
            "joint_names": list(source.names),
        },
        "camera": {
            "eye": [float(v) for v in cam.eye],
            "target": [float(v) for v in cam.target],
            "up": [float(v) for v in cam.up],
            "fov_y": round(float(cam.fov_y), 6),
        },
        "keypoints": {vid: views[vid] for vid in views},
        "bones": {vid: [list(b) for b in POSE_VIEWS[vid]["bones"]] for vid in views},
        "note": ("所有视图都是同一 3D 关节源经同一相机的投影；unavailable 的关键点"
                 "没有坐标（不编造）；源关节下标可直接回查 npz 的 joints 数组"),
    }
    if extra:
        doc.update(extra)
    return doc


# ------------------------------------------------------------------ 自检
def verify_soma_source(joints, names=None, tol=0.05):
    """结构自检：确认 77 关节数组的语义锚点没被搞错（Root 偏移是最容易犯的错）。

    判据（对 rest pose 与动画帧都成立）：
    * 小腿/脚三关节（Shin / Foot / ToeBase）x 坐标几乎相同（同一根腿）；
    * 高度沿 Shin > Foot > ToeBase 递减；
    * 左右同名关节分居 +x / -x（本项目 rig 里 **左 = +x**）。
    """
    arr = np.asarray(joints, dtype=np.float64)
    names = tuple(names) if names else load_soma_joint_names()
    if arr.shape != (len(names), 3):
        raise ValueError(f"关节数组形状应为 ({len(names)}, 3)，实际 {arr.shape}")
    idx = {n: i for i, n in enumerate(names)}
    checks = []

    def add(code, ok, msg):
        checks.append({"code": code, "ok": bool(ok), "message": msg})
        if not ok:
            raise ValueError(f"{code}: {msg}")

    for side, off in (("Left", 0), ("Right", 0)):
        shin, foot, toe = (idx[f"{side}Shin"], idx[f"{side}Foot"], idx[f"{side}ToeBase"])
        xs = arr[[shin, foot, toe], 0]
        zs = arr[[shin, foot, toe], 2]
        add(f"LEG_X_ALIGNED_{side.upper()}",
            float(np.abs(xs - xs.mean()).max()) < tol,
            f"{side} 腿三关节 x 应同值，实测 {np.round(xs, 4).tolist()}")
        add(f"LEG_Z_DESC_{side.upper()}",
            bool(zs[0] > zs[1] > zs[2]),
            f"{side} 腿高度应 Shin>Foot>ToeBase，实测 {np.round(zs, 4).tolist()}")
    le, re_ = arr[idx["LeftEye"], 0], arr[idx["RightEye"], 0]
    add("EYE_SIDE_SIGN", float(le) > float(re_),
        f"左眼 x 应大于右眼（左=+x），实测 {float(le):.4f} vs {float(re_):.4f}")
    al, ar = arr[idx["LeftArm"], 0], arr[idx["RightArm"], 0]
    add("ARM_SIDE_SIGN", float(al) > float(ar),
        f"左肩 x 应大于右肩（左=+x），实测 {float(al):.4f} vs {float(ar):.4f}")
    hz = float(arr[idx["Hips"], 2])
    add("HIPS_HEIGHT", 0.6 < hz < 1.4, f"髋高应在 0.6~1.4 m，实测 {hz:.4f}")
    return {"ok": True, "checks": checks}


def project_independent(points, eye, target, up, f_px, width, height):
    """**独立**的第二套投影实现（不调用 geomlib.Camera），用于交叉验算。

    公式取自契约 §1.1：px = W/2 + (x/z)·f_px，py = H/2 − (y/z)·f_px。
    """
    eye = np.asarray(eye, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    up = np.asarray(up, dtype=np.float64)
    fwd = target - eye
    fwd = fwd / max(float(np.linalg.norm(fwd)), 1e-12)
    right = np.cross(fwd, up)
    right = right / max(float(np.linalg.norm(right)), 1e-12)
    upv = np.cross(right, fwd)
    d = np.asarray(points, dtype=np.float64) - eye
    z = d @ fwd
    x = d @ right
    y = d @ upv
    zz = np.where(np.abs(z) < 1e-9, 1e-9, z)
    px = (width / 2.0 + (x / zz) * float(f_px)).reshape(-1, 1)
    py = (height / 2.0 - (y / zz) * float(f_px)).reshape(-1, 1)
    return np.concatenate([px, py], axis=1), z


def check_keypoints_against_source(keypoints, cam, width, height, f_px=None):
    """交叉验算：把落盘关键点用**独立实现**重投影一遍，和记录值逐点比。

    返回 max_abs_px / max_abs_depth_m / n_checked / n_failed。
    """
    f_px = float(f_px if f_px is not None else
                 (height / (2.0 * np.tan(np.radians(float(cam.fov_y)) * 0.5))))
    max_px, max_d, n_fail = 0.0, 0.0, 0
    n = 0
    for kp in keypoints:
        if not kp.get("visible") or kp.get("world") is None:
            continue
        world = np.asarray(kp["world"], dtype=np.float64).reshape(1, 3)
        px, z = project_independent(world, cam.eye, cam.target, cam.up, f_px, width, height)
        d_px = float(np.hypot(px[0, 0] - kp["x"], px[0, 1] - kp["y"]))
        max_px = max(max_px, d_px)
        max_d = max(max_d, abs(float(z[0]) - float(kp["depth_m"])))
        if d_px > 0.01:
            n_fail += 1
        n += 1
    return {"n_checked": n, "n_failed": n_fail,
            "max_abs_px": round(max_px, 6), "max_abs_depth_m": round(max_d, 6)}


def _main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description="SOMA 77 关节 -> 关键点闭集（自检/查看）")
    ap.add_argument("--verify", default=None, help="校验某个 npz 的 joints 数组")
    ap.add_argument("--frames", type=int, default=1, help="校验前 N 帧")
    args = ap.parse_args(argv)
    if args.verify:
        with np.load(args.verify, allow_pickle=False) as z:
            joints = z["joints"][: max(args.frames, 1)]
        names = load_soma_joint_names()
        for f in range(joints.shape[0]):
            res = verify_soma_source(joints[f], names)
            print(f"frame {f}: {len(res['checks'])} 项结构自检全过")
        return 0
    print(json.dumps({
        "views": {vid: {"keypoints": len(POSE_VIEWS[vid]["keypoints"]),
                        "bones": len(POSE_VIEWS[vid]["bones"])}
                  for vid in POSE_KEYPOINT_SETS},
        "canonical": POSE_CANONICAL_KEYPOINT_SET,
        "soma_anchors": SOMA_INDEX_ANCHORS,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":                      # pragma: no cover - 手工查看
    raise SystemExit(_main())
