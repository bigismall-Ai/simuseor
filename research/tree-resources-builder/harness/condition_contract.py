"""条件通道契约：编码常量 + sidecar 写出器 + 静态扫描器。

这是 plans/CONTRACT-conditions.md（人读的契约）的可执行副本：
两边必须同步——契约文档改了就改这里，改了这里就改契约文档。
scan_sidecar_dir() 是「契约可自动校验」的那一半：逐个 sidecar 静态扫描七个必含字段。

为什么单独一个模块
==================
1. 编码常量不能散落成魔数。深度极性（近=1 远=0）、背景值、法线编码、调色板、
   pose 关键点集，全部集中在这里；conditions.py 只引用不重定义。
2. 契约要能被机器校验。sidecar 的必含字段由 SIDECAR_REQUIRED_FIELDS 定义，
   扫描器和文档表格用同一份清单，不会各说各话。
3. 跨仓库换算只写一处。Z_UP_TO_Y_UP 是本项目（Z-up）与 resources3D（Y-up）
   之间的唯一换算矩阵，改一次两边都对。

用法
====
    from condition_contract import (
        build_sidecar, write_sidecar, scan_sidecar_dir,
        f_px_from_fov, fov_y_from_f_px, zup_to_yup,
    )

    side = build_sidecar("depth", resolution=(512, 512), f_px=512.0,
                         near=2.61, far=40.16)
    write_sidecar("cond_depth.json", side)
    print(scan_sidecar_dir("out/"))

契约要点（详见 plans/CONTRACT-conditions.md）
==============================================
* 深度极性：近=1 远=0（与 resources3D wmcore.depth_to_unit 一致）。
* 上轴：Z-up（本项目规范）；resources3D 是 Y-up，换算见 Z_UP_TO_Y_UP。
* sidecar 必含七字段：resolution / f_px / near / far / encoding / up_axis / mask_semantics。
* f_px 是权威值；focal_mm / sensor_mm 只作参考（两仓库的 sensor-fit 约定不同，
  下游一律以 sidecar 的 f_px 为准）。
"""
from __future__ import annotations

import hashlib
import json
import math
import os

import numpy as np

# ------------------------------------------------------------------ 契约标识
CONTRACT_NAME = "conditions_contract"
CONTRACT_VERSION = "1.1.0"   # R1: 姿态关键点闭集扩成三视图（源 + 视图两层）

# ------------------------------------------------------------------ 全局约定
UNITS = "meter"
HANDEDNESS = "right"
UP_AXIS = "Z"                              # 世界 +Z 朝上（与 scene_layout.json 的 up_axis 一致）
UP_AXIS_VECTOR = (0.0, 0.0, 1.0)
AXIS_NAMES = ("X", "Y", "Z")

# Z-up -> Y-up 的唯一换算：p_yup = (x, z, -y)。
# 行列式 = +1（真旋转，右手系不变），所以相机基（right/up/fwd）在两个坐标系里
# 逐项对应：camera-space 坐标完全相同 -> 投影像素与深度逐像素可比。
Z_UP_TO_Y_UP = np.array([[1.0, 0.0, 0.0],
                         [0.0, 0.0, 1.0],
                         [0.0, -1.0, 0.0]], dtype=np.float64)
Y_UP_TO_Z_UP = Z_UP_TO_Y_UP.T               # 正交且 det=+1，转置即逆

# ------------------------------------------------------------------ 通道清单
CHANNELS = ("depth", "normal", "seg", "mask", "lineart", "pose")

# ------------------------------------------------------------------ 深度
DEPTH_POLARITY = "near_1_far_0"            # 近 = 1，远 = 0
DEPTH_NEAR_VALUE = 1.0
DEPTH_FAR_VALUE = 0.0
DEPTH_BACKGROUND = 0.0                    # 背景 = 无几何 = 无穷远 = 0（与极性自洽）
DEPTH_NORMALIZATION = "per_frame_foreground_min_max"
DEPTH_ENCODING = (
    "depth = (z_far_fg - z) / (z_far_fg - z_near_fg) ∈ [0,1]"
    "（z = 相机空间前向轴距离/米，1=最近，0=最远）；"
    "背景像素固定为 background_depth = 0.0"
)

# ------------------------------------------------------------------ 法线
NORMAL_SPACE = "world"
NORMAL_BACKGROUND = (0.0, 0.0, 0.0)
NORMAL_ENCODING = (
    "c = (n_world * 0.5 + 0.5) ∈ [0,1]^3；存 16bit: v16 = round(c * 65535)；"
    "反解: n = normalize(v16 / 65535 * 2 - 1)；背景像素固定为 (0,0,0)"
)
NORMAL_BIT_DEPTH = 16                      # 16bit 通道图才是可逆产物；8bit 仅预览

# ------------------------------------------------------------------ 语义分割
SEG_BACKGROUND = (0, 0, 0)
SEG_ENCODING = "seg = 固定调色板[label]；背景像素固定为 (0,0,0)"
SEG_BIT_DEPTH = 8
SEG_PALETTE_ID = "tree_resources_builder_fixed_v1"

# ------------------------------------------------------------------ 前景掩码
MASK_BACKGROUND = 0
MASK_FOREGROUND = 255
MASK_ANTIALIASING = "none"                 # 硬二值，不做羽化
MASK_ENCODING = (
    "mask = 前景二值图（0=背景，255=前景）；"
    "前景 = z-buffer 命中任何可见几何（hide=True 的几何不参与）；无抗锯齿、无后处理"
)
MASK_SEMANTICS = {
    "definition": "前景 = z-buffer 命中的任何可见几何；hide=True 的几何完全不参与光栅",
    "source": "conditions.render_conditions -> mask",
    "foreground_value": MASK_FOREGROUND,
    "background_value": MASK_BACKGROUND,
    "anti_aliasing": MASK_ANTIALIASING,
    "post_process": "none",
    "note": "同一帧的六个通道共享同一个前景集合；mask 与 depth/normal/seg/lineart 的前景严格一致",
}

# ------------------------------------------------------------------ 线稿
LINEART_BACKGROUND = 0
LINEART_FOREGROUND = 255
LINEART_WIDTH_PX = 1
LINEART_ANTIALIASING = "none"
LINEART_ALGORITHM = "face_id_boundary_v1"  # 与 resources3D wmcore.line_art_from_face_id 同算法
LINEART_ENCODING = (
    "lineart = 轮廓+面边界二值图（0=背景，255=线）；"
    "由 face_id 缓冲的 4-邻域边界求出，再做 1px 膨胀使线连续；"
    "线宽 1px，无抗锯齿"
)

# ------------------------------------------------------------------ 姿态
#
# R1 增补：关键点闭集从「一套」变成「源 + 视图」两层。
#
# 为什么改
# --------
# R0 只钉住「pose = 2D 骨架叠加图」的**格式**，并把「关键点集不是 COCO-17、映射表留给
# R1」明确记在 CONTRACT §9.2。R1 核实到 SOMA 的 77 个公共关节确实可用
# （assets/nongeometry/shot001_hero.npz 的 joints 是 (120, 77, 3)，pose_store 也按这 77
# 个读），所以按 ROADMAP R1 出 COCO-18 / OpenPose-25。
#
# 但 human_rig_21 不删：它是**项目自有骨架**（assets/nongeometry/character_rig.json，
# 与 harness/generate_assets.py 的 HUMAN_JOINTS 同源），是几何侧的事实源，
# generate_assets 等既有代码仍按这 21 个名字取点；删掉等于让文档与代码分家。
#
# 三层的分工（单一事实源就在这份文件里）
# ----------------------------------------
#   源 source : 一组具名 3D 关节 —— SOMA 77 公共关节（动画序列）或项目 rig 21（静态角色）
#   视图 view  : 面向下游的关键点闭集 —— human_rig_21 / coco18 / openpose25
#   角色 role  : 视图关键点 -> 源关节（直接取 / 中点 / 质心 / 不可得）
#
# 三个视图是**同一 3D 关节源的三种投影**，走同一相机、同一数值链，因此可机械互验。
# 规范视图（pose PNG 的画法）= coco18：ROADMAP R1 明确要 COCO-18/OpenPose-25，
# 且 COCO-17 前 17 个关键点顺序保持不变（下游按 [:17] 取即可）。
POSE_BACKGROUND = (0, 0, 0)
POSE_ANTIALIASING = "none"
POSE_LIMB_WIDTH_PX = 3
POSE_JOINT_RADIUS_PX = 2

# ---- 视图闭集：关键点名单 + 顺序 + 骨段（键是视图 id）
POSE_VIEWS = {
    "human_rig_21": {
        "id": "human_rig_21",
        "title": "项目自有骨架视图（character_rig.json / generate_assets.HUMAN_JOINTS 同源）",
        "keypoints": (
            ("Hips", "mid_hip"), ("Spine", "spine"), ("Chest", "chest"),
            ("Neck", "neck_base"), ("Head", "head"),
            ("L_Shoulder", "left_shoulder"), ("L_Elbow", "left_elbow"),
            ("L_Wrist", "left_wrist"), ("L_Hand", "left_hand"),
            ("R_Shoulder", "right_shoulder"), ("R_Elbow", "right_elbow"),
            ("R_Wrist", "right_wrist"), ("R_Hand", "right_hand"),
            ("L_Hip", "left_hip"), ("L_Knee", "left_knee"),
            ("L_Ankle", "left_ankle"), ("L_Toe", "left_big_toe"),
            ("R_Hip", "right_hip"), ("R_Knee", "right_knee"),
            ("R_Ankle", "right_ankle"), ("R_Toe", "right_big_toe"),
        ),
        "bones": (
            ("Hips", "Spine"), ("Spine", "Chest"), ("Chest", "Neck"), ("Neck", "Head"),
            ("Chest", "L_Shoulder"), ("L_Shoulder", "L_Elbow"),
            ("L_Elbow", "L_Wrist"), ("L_Wrist", "L_Hand"),
            ("Chest", "R_Shoulder"), ("R_Shoulder", "R_Elbow"),
            ("R_Elbow", "R_Wrist"), ("R_Wrist", "R_Hand"),
            ("Hips", "L_Hip"), ("L_Hip", "L_Knee"),
            ("L_Knee", "L_Ankle"), ("L_Ankle", "L_Toe"),
            ("Hips", "R_Hip"), ("R_Hip", "R_Knee"),
            ("R_Knee", "R_Ankle"), ("R_Ankle", "R_Toe"),
        ),
    },
    "coco18": {
        "id": "coco18",
        "title": "COCO-18 = COCO-17 原顺序 + neck 追加在末尾（index 17）",
        "keypoints": (
            ("nose", "nose"),
            ("left_eye", "left_eye"), ("right_eye", "right_eye"),
            ("left_ear", "left_ear"), ("right_ear", "right_ear"),
            ("left_shoulder", "left_shoulder"), ("right_shoulder", "right_shoulder"),
            ("left_elbow", "left_elbow"), ("right_elbow", "right_elbow"),
            ("left_wrist", "left_wrist"), ("right_wrist", "right_wrist"),
            ("left_hip", "left_hip"), ("right_hip", "right_hip"),
            ("left_knee", "left_knee"), ("right_knee", "right_knee"),
            ("left_ankle", "left_ankle"), ("right_ankle", "right_ankle"),
            ("neck", "neck_base"),
        ),
        "bones": (
            ("nose", "left_eye"), ("nose", "right_eye"),
            ("left_eye", "left_ear"), ("right_eye", "right_ear"),
            ("neck", "left_shoulder"), ("neck", "right_shoulder"),
            ("neck", "nose"),
            ("left_shoulder", "right_shoulder"),
            ("left_shoulder", "left_elbow"), ("right_shoulder", "right_elbow"),
            ("left_elbow", "left_wrist"), ("right_elbow", "right_wrist"),
            ("left_shoulder", "left_hip"), ("right_shoulder", "right_hip"),
            ("left_hip", "right_hip"),
            ("left_hip", "left_knee"), ("right_hip", "right_knee"),
            ("left_knee", "left_ankle"), ("right_knee", "right_ankle"),
        ),
    },
    "openpose25": {
        "id": "openpose25",
        "title": "OpenPose BODY_25 标准顺序（nose / neck / 肢体 / mid_hip / 足）",
        "keypoints": (
            ("Nose", "nose"), ("Neck", "neck_top"),
            ("RShoulder", "right_shoulder"), ("RElbow", "right_elbow"),
            ("RWrist", "right_wrist"),
            ("LShoulder", "left_shoulder"), ("LElbow", "left_elbow"),
            ("LWrist", "left_wrist"),
            ("MidHip", "mid_hip"),
            ("RHip", "right_hip"), ("RKnee", "right_knee"), ("RAnkle", "right_ankle"),
            ("LHip", "left_hip"), ("LKnee", "left_knee"), ("LAnkle", "left_ankle"),
            ("REye", "right_eye"), ("LEye", "left_eye"),
            ("REar", "right_ear"), ("LEar", "left_ear"),
            ("LBigToe", "left_big_toe"), ("LSmallToe", "left_small_toe"),
            ("LHeel", "left_heel"),
            ("RBigToe", "right_big_toe"), ("RSmallToe", "right_small_toe"),
            ("RHeel", "right_heel"),
        ),
        "bones": (
            ("Nose", "Neck"), ("Neck", "RShoulder"), ("Neck", "LShoulder"),
            ("RShoulder", "RElbow"), ("RElbow", "RWrist"),
            ("LShoulder", "LElbow"), ("LElbow", "LWrist"),
            ("Neck", "MidHip"),
            ("RShoulder", "RHip"), ("RHip", "RKnee"), ("RKnee", "RAnkle"),
            ("RAnkle", "RHeel"), ("RHip", "MidHip"),
            ("LHip", "MidHip"), ("LHip", "LKnee"), ("LKnee", "LAnkle"),
            ("LAnkle", "LHeel"), ("LAnkle", "LBigToe"), ("LBigToe", "LSmallToe"),
            ("LSmallToe", "LHeel"),
            ("RAnkle", "RBigToe"), ("RBigToe", "RSmallToe"), ("RSmallToe", "RHeel"),
        ),
    },
}
POSE_KEYPOINT_SETS = tuple(POSE_VIEWS)
# 规范视图：pose PNG 画的就是它；其余视图是并列发布（坐标写进 cond_pose_keypoints.json）
POSE_CANONICAL_KEYPOINT_SET = "coco18"
POSE_KEYPOINT_SET_ID = POSE_CANONICAL_KEYPOINT_SET      # 旧名保留，向后兼容
POSE_VIEWS_CANONICAL = POSE_VIEWS[POSE_CANONICAL_KEYPOINT_SET]

# ---- 角色 -> 源关节。None = 该源没有这个节点（标为 unavailable，不编造）
#
# SOMA 侧的命名是「骨骼起始关节」语义：LeftArm 是上臂起点（= 肩关节），
# LeftForeArm 是前臂起点（= 肘关节），LeftHand 是手部起点（= 腕关节）。
# 脚：LeftFoot = 踝，LeftToeBase = 趾根。SOMA 的 77 关节数组**不含 Root**，
# 所以踝是 69/74、趾根是 70/75（名字表含 Root 时是 70/75 —— 差一位，最容易搞错）。
POSE_ROLE_SOURCES = {
    "soma77": {
        "nose": ("midpoint", ("LeftEye", "RightEye")),
        "neck_base": ("joint", "Neck1"),
        "neck_top": ("joint", "Neck2"),
        "head": ("joint", "Head"),
        "spine": ("joint", "Spine1"),
        "chest": ("joint", "Chest"),
        "left_eye": ("joint", "LeftEye"),
        "right_eye": ("joint", "RightEye"),
        "left_ear": None,
        "right_ear": None,
        "left_shoulder": ("joint", "LeftArm"),
        "right_shoulder": ("joint", "RightArm"),
        "left_elbow": ("joint", "LeftForeArm"),
        "right_elbow": ("joint", "RightForeArm"),
        "left_wrist": ("joint", "LeftHand"),
        "right_wrist": ("joint", "RightHand"),
        "left_hand": ("centroid", ("LeftHandThumb1", "LeftHandIndex1",
                                   "LeftHandMiddle1", "LeftHandRing1", "LeftHandPinky1")),
        "right_hand": ("centroid", ("RightHandThumb1", "RightHandIndex1",
                                    "RightHandMiddle1", "RightHandRing1",
                                    "RightHandPinky1")),
        "mid_hip": ("joint", "Hips"),
        "left_hip": ("joint", "LeftLeg"),
        "right_hip": ("joint", "RightLeg"),
        "left_knee": ("joint", "LeftShin"),
        "right_knee": ("joint", "RightShin"),
        "left_ankle": ("joint", "LeftFoot"),
        "right_ankle": ("joint", "RightFoot"),
        "left_big_toe": ("joint", "LeftToeBase"),
        "right_big_toe": ("joint", "RightToeBase"),
        "left_small_toe": None,
        "right_small_toe": None,
        "left_heel": None,
        "right_heel": None,
    },
    "rig21": {
        "nose": None,
        "neck_base": ("joint", "Neck"),
        "neck_top": ("joint", "Neck"),
        "head": ("joint", "Head"),
        "spine": ("joint", "Spine"),
        "chest": ("joint", "Chest"),
        "left_eye": None,
        "right_eye": None,
        "left_ear": None,
        "right_ear": None,
        "left_shoulder": ("joint", "L_Shoulder"),
        "right_shoulder": ("joint", "R_Shoulder"),
        "left_elbow": ("joint", "L_Elbow"),
        "right_elbow": ("joint", "R_Elbow"),
        "left_wrist": ("joint", "L_Wrist"),
        "right_wrist": ("joint", "R_Wrist"),
        "left_hand": ("joint", "L_Hand"),
        "right_hand": ("joint", "R_Hand"),
        "mid_hip": ("joint", "Hips"),
        "left_hip": ("joint", "L_Hip"),
        "right_hip": ("joint", "R_Hip"),
        "left_knee": ("joint", "L_Knee"),
        "right_knee": ("joint", "R_Knee"),
        "left_ankle": ("joint", "L_Ankle"),
        "right_ankle": ("joint", "R_Ankle"),
        "left_big_toe": ("joint", "L_Toe"),
        "right_big_toe": ("joint", "R_Toe"),
        "left_small_toe": None,
        "right_small_toe": None,
        "left_heel": None,
        "right_heel": None,
    },
}

# 角色不可得时的原因（写进 keypoint JSON，不编造坐标）
POSE_UNAVAILABLE_REASONS = {
    "left_ear": "SOMA 与项目 rig 均无耳关节",
    "right_ear": "SOMA 与项目 rig 均无耳关节",
    "left_small_toe": "SOMA 足部骨架只有踝/趾根/趾端三个节点，无小趾",
    "right_small_toe": "SOMA 足部骨架只有踝/趾根/趾端三个节点，无小趾",
    "left_heel": "SOMA 足部骨架无跟骨节点",
    "right_heel": "SOMA 足部骨架无跟骨节点",
    "nose": "项目 rig 无鼻节点（静态角色源不出 nose）",
    "left_eye": "项目 rig 无眼节点（静态角色源不出眼）",
    "right_eye": "项目 rig 无眼节点（静态角色源不出眼）",
}

POSE_COLOR_CENTER = (240, 240, 240)
POSE_COLOR_LEFT = (255, 64, 64)
POSE_COLOR_RIGHT = (64, 128, 255)


def pose_joint_color(name: str):
    """关键点配色：左侧肢体红、右侧肢体蓝、中轴白（按关节名 L_/R_ 前缀）。"""
    if name.startswith("L_"):
        return POSE_COLOR_LEFT
    if name.startswith("R_"):
        return POSE_COLOR_RIGHT
    return POSE_COLOR_CENTER


def pose_role_color(role: str):
    """角色配色：left_* 红、right_* 蓝、中轴白。

    视图里的关键点名字各不相同（left_shoulder / LShoulder / L_Shoulder），
    统一按**角色**判侧，颜色才不会随视图变。
    """
    if role.startswith("left_"):
        return POSE_COLOR_LEFT
    if role.startswith("right_"):
        return POSE_COLOR_RIGHT
    return POSE_COLOR_CENTER


# 旧常量保留（内容与 human_rig_21 视图完全一致，不另抄一份）
POSE_JOINT_NAMES = tuple(kp[0] for kp in POSE_VIEWS["human_rig_21"]["keypoints"])
POSE_BONES = tuple(tuple(b) for b in POSE_VIEWS["human_rig_21"]["bones"])

POSE_ENCODING = (
    "pose = 2D 骨架叠加图（RGB，背景 (0,0,0)）；"
    f"关键点 = 规范视图 {POSE_CANONICAL_KEYPOINT_SET} 的 "
    f"{len(POSE_VIEWS_CANONICAL['keypoints'])} 个具名关节，由 3D 世界坐标经同一相机投影得到；"
    f"骨段线宽 {POSE_LIMB_WIDTH_PX}px、关节点半径 {POSE_JOINT_RADIUS_PX}px，无抗锯齿；"
    "不表达遮挡与深度（全身关节一律画出）；"
    "并列视图 " + "/".join(POSE_KEYPOINT_SETS) + " 的坐标写在 cond_pose_keypoints.json"
)


# ------------------------------------------------------------------ sidecar 必含字段
# 契约要求的七个字段。扫描器与契约文档表格用同一份清单。
SIDECAR_REQUIRED_FIELDS = (
    "resolution",       # [W, H]，像素
    "f_px",             # 焦距像素值（权威）
    "near",             # 深度归一化的近端度量深度（米）
    "far",              # 深度归一化的远端度量深度（米）
    "encoding",         # 通道语义 + 极性 + 编码约定
    "up_axis",          # "Z"
    "mask_semantics",   # 前景定义
)


# ------------------------------------------------------------------ 相机内参换算
def f_px_from_fov(fov_y_deg: float, height: int) -> float:
    """由垂直 FOV 推出焦距像素值。

    本项目的投影（geomlib.Camera.project / conditions._cam_to_pixel）用的是
    方形像素、垂直 FOV 驱动的口径：
        f_px = H / (2 * tan(fov_y / 2))
    注意：resources3D 的 wmcore.Camera 用的是水平 sensor-fit（f_px = focal/sensor*W），
    两边名义 focal/sensor 相同但 f_px 不同——所以跨仓库一律以 sidecar 的 f_px 为准。
    """
    return float(height) / (2.0 * math.tan(math.radians(float(fov_y_deg)) * 0.5))


def fov_y_from_f_px(f_px: float, height: int) -> float:
    """由焦距像素值反推垂直 FOV（度）。"""
    return math.degrees(2.0 * math.atan(float(height) / (2.0 * float(f_px))))


def principal_point(resolution):
    """主点：图像中心（本项目与 resources3D 一致，都是 (W/2, H/2)）。"""
    w, h = int(resolution[0]), int(resolution[1])
    return (w / 2.0, h / 2.0)


# ------------------------------------------------------------------ 坐标换算
def zup_to_yup(points):
    """Z-up 世界坐标 -> Y-up 世界坐标（右手系保持，det=+1）。"""
    p = np.asarray(points, dtype=np.float64)
    if p.ndim == 1:
        return Z_UP_TO_Y_UP @ p
    return p @ Z_UP_TO_Y_UP.T


def yup_to_zup(points):
    """Y-up 世界坐标 -> Z-up 世界坐标。"""
    p = np.asarray(points, dtype=np.float64)
    if p.ndim == 1:
        return Y_UP_TO_Z_UP @ p
    return p @ Y_UP_TO_Z_UP.T


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------ 编码描述
def channel_encoding(channel: str, palette=None, keypoints=None):
    """每个通道的 encoding 描述（字段结构统一，值随通道变）。"""
    base = {
        "channel": channel,
        "contract": CONTRACT_NAME,
        "contract_version": CONTRACT_VERSION,
        "bit_depth": 8,
        "anti_aliasing": "none",
    }
    if channel == "depth":
        base.update({
            "semantics": "相机空间前向轴深度（沿光轴的米数），按帧内前景 min/max 归一化",
            "formula": "d = (z_far_fg - z) / (z_far_fg - z_near_fg)",
            "polarity": DEPTH_POLARITY,
            "near_value": DEPTH_NEAR_VALUE,
            "far_value": DEPTH_FAR_VALUE,
            "value_range": [0.0, 1.0],
            "background": DEPTH_BACKGROUND,
            "normalization": DEPTH_NORMALIZATION,
            "metric": "camera-space forward-axis distance (meter)",
            "color_space": "linear gray",
        })
    elif channel == "normal":
        base.update({
            "semantics": "世界空间面法线（flat shading，逐像素常量）",
            "formula": "c = n_world * 0.5 + 0.5；反解 n = normalize(c * 2 - 1)",
            "polarity": "n/a",
            "value_range": [0.0, 1.0],
            "background": list(NORMAL_BACKGROUND),
            "normalization": "none",
            "metric": "world-space unit normal",
            "color_space": "linear RGB",
            "bit_depth": NORMAL_BIT_DEPTH,
            "note": "16bit 通道图（_normal_r16/_g16/_b16）才是可逆产物；8bit 仅预览",
        })
    elif channel == "seg":
        base.update({
            "semantics": "语义分割，按固定调色板着色",
            "formula": "seg = palette[label]",
            "polarity": "n/a",
            "value_range": [0, 255],
            "background": list(SEG_BACKGROUND),
            "normalization": "none",
            "metric": "palette index (fixed)",
            "color_space": "sRGB-ish palette (fixed, not photometric)",
            "palette_id": SEG_PALETTE_ID,
            "palette": {k: list(v) for k, v in sorted((palette or {}).items())},
        })
    elif channel == "mask":
        base.update({
            "semantics": "前景二值掩码（几何可见性）",
            "formula": "mask = 255 if z-buffer hit else 0",
            "polarity": "n/a",
            "value_range": [0, 255],
            "background": MASK_BACKGROUND,
            "normalization": "none",
            "metric": "binary visibility",
            "color_space": "linear gray",
        })
    elif channel == "lineart":
        base.update({
            "semantics": "轮廓 + 面边界线稿（几何分件线）",
            "formula": "edges = face_id 的 4-邻域差异 且 非背景，再做 1px 膨胀",
            "polarity": "n/a",
            "value_range": [0, 255],
            "background": LINEART_BACKGROUND,
            "normalization": "none",
            "metric": "binary edge",
            "color_space": "linear gray",
            "algorithm": LINEART_ALGORITHM,
            "line_width_px": LINEART_WIDTH_PX,
        })
    elif channel == "pose":
        base.update({
            "semantics": "2D 人体骨架叠加图（由 3D 关节经同一相机投影）",
            "formula": "project(joint_world) -> pixel；骨段画线、关节画圆点",
            "polarity": "n/a",
            "value_range": [0, 255],
            "background": list(POSE_BACKGROUND),
            "normalization": "none",
            "metric": "pixel coordinate",
            "color_space": "linear RGB",
            "keypoint_set": POSE_CANONICAL_KEYPOINT_SET,
            "keypoint_set_canonical": POSE_CANONICAL_KEYPOINT_SET,
            "keypoint_sets": list(POSE_KEYPOINT_SETS),
            "keypoint_names": [kp[0] for kp in POSE_VIEWS_CANONICAL["keypoints"]],
            "bones": [list(b) for b in POSE_VIEWS_CANONICAL["bones"]],
            "views": {vid: {"title": POSE_VIEWS[vid]["title"],
                            "keypoint_names": [kp[0] for kp in POSE_VIEWS[vid]["keypoints"]],
                            "bones": [list(b) for b in POSE_VIEWS[vid]["bones"]]}
                      for vid in POSE_KEYPOINT_SETS},
            "limb_width_px": POSE_LIMB_WIDTH_PX,
            "joint_radius_px": POSE_JOINT_RADIUS_PX,
            "occlusion": "not encoded（全身关节一律画出，不做遮挡剔除）",
            "keypoints": list(keypoints or []),
            "keypoints_file": "cond_pose_keypoints.json（并列视图的完整 2D 坐标与源关节索引）",
        })
    else:
        raise ValueError(f"未知条件通道: {channel!r}（支持 {CHANNELS}）")
    return base


# ------------------------------------------------------------------ sidecar
def build_sidecar(channel, resolution, f_px, near, far, palette=None, keypoints=None,
                  extra=None):
    """构造一份 sidecar（契约要求的七字段 + 通道附加信息 + 共享元数据）。

    参数
    ----
    channel    : 通道名（depth/normal/seg/mask/lineart/pose）
    resolution : (W, H)
    f_px       : 焦距像素值（权威内参）
    near/far   : 深度归一化的近端/远端度量深度（米）；同一帧六个通道共享
    palette    : seg 通道的调色板
    keypoints  : pose 通道的关键点列表（name / xy / depth / visible）
    extra      : 额外顶层字段（相机、场景、产物指纹等）
    """
    if channel not in CHANNELS:
        raise ValueError(f"未知条件通道: {channel!r}（支持 {CHANNELS}）")
    w, h = int(resolution[0]), int(resolution[1])
    side = {
        "kind": "condition_sidecar",
        "contract": CONTRACT_NAME,
        "contract_version": CONTRACT_VERSION,
        "channel": channel,
        "resolution": [w, h],
        "f_px": round(float(f_px), 6),
        "near": (None if near is None else round(float(near), 6)),
        "far": (None if far is None else round(float(far), 6)),
        "near_far_unit": UNITS,
        "encoding": channel_encoding(channel, palette=palette, keypoints=keypoints),
        "up_axis": UP_AXIS,
        "up_axis_vector": list(UP_AXIS_VECTOR),
        "handedness": HANDEDNESS,
        "units": UNITS,
        "mask_semantics": dict(MASK_SEMANTICS),
        "principal_point": list(principal_point((w, h))),
    }
    if extra:
        side.update(extra)
    return side


def write_sidecar(path, sidecar):
    """把 sidecar 写成 JSON（UTF-8、缩进 2）。"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, ensure_ascii=False, indent=2)
    return path


def scan_sidecar_file(path):
    """静态扫描一个 sidecar：七字段是否齐全。

    目录里可能还有**不是 sidecar** 的 JSON（比如 R1 的 cond_pose_keypoints.json），
    那种文件按 kind 字段自我声明类型，扫描时**跳过**并计入 n_skipped —— 不判它不合格，
    但也不把它算成 sidecar（否则「七字段齐备率」会被不相干的文件稀释）。
    """
    out = {"path": os.path.basename(path), "ok": False, "missing": [], "channel": None,
           "kind": None, "skipped": False, "error": None}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception as exc:                    # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
        return out
    out["channel"] = doc.get("channel")
    out["kind"] = doc.get("kind")
    if out["kind"] not in (None, "condition_sidecar"):
        out["skipped"] = True
        out["ok"] = True
        return out
    missing = [f for f in SIDECAR_REQUIRED_FIELDS if f not in doc]
    out["missing"] = missing
    out["ok"] = not missing
    return out


def scan_sidecar_dir(out_dir, pattern=".json"):
    """扫描目录下所有 sidecar，返回汇总（逐个文件一行 + 总判定）。"""
    files = sorted(f for f in os.listdir(out_dir) if f.endswith(pattern))
    rows = [scan_sidecar_file(os.path.join(out_dir, f)) for f in files]
    return {
        "dir": out_dir,
        "required_fields": list(SIDECAR_REQUIRED_FIELDS),
        "n_files": len(rows),
        "n_ok": sum(1 for r in rows if r["ok"] and not r.get("skipped")),
        "n_skipped": sum(1 for r in rows if r.get("skipped")),
        "all_ok": bool(rows) and all(r["ok"] for r in rows),
        "files": rows,
    }


if __name__ == "__main__":                      # pragma: no cover - 手工查看常量
    print(json.dumps({
        "contract": CONTRACT_NAME,
        "version": CONTRACT_VERSION,
        "channels": list(CHANNELS),
        "depth_polarity": DEPTH_POLARITY,
        "depth_background": DEPTH_BACKGROUND,
        "up_axis": UP_AXIS,
        "sidecar_required_fields": list(SIDECAR_REQUIRED_FIELDS),
        "pose_keypoints": len(POSE_JOINT_NAMES),
        "pose_bones": len(POSE_BONES),
    }, ensure_ascii=False, indent=2))
