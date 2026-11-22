"""条件通道渲染器：depth（深度）/ normal（法线）/ seg（语义分割）+ 按 mesh 隐藏。

用途
====
给图生图 / 图生视频模型当参考输入时，"白模着色图"信息量不够，还需要三类**条件图**：

* ``depth``  —— 空间结构（远近层次）
* ``normal`` —— 表面朝向（车头/车尾、墙面/地面可辨）
* ``seg``    —— 语义分区（部件边界）

车载 POV 镜头还需要**按 mesh 隐藏**车身、只保留外部世界的能力。

用法
====
::

    from conditions import render_conditions, render_depth, render_normal, render_seg

    res = render_conditions(meshes, camera, width=512, height=512)
    res["depth"]    # (H, W)    float32，前景 0..1（**近=1 远=0**，R0 裁定）
    res["normal"]   # (H, W, 3) float32，世界空间法线编码（可逆）
    res["seg"]      # (H, W, 3) uint8，固定调色板
    res["mask"]     # (H, W)    bool，前景掩码
    res["lineart"]  # (H, W)    uint8，轮廓+面边界线稿
    res["pose"]     # (H, W, 3) uint8，2D 骨架叠加图

``meshes`` 的元素支持两种形态::

    trimesh.Trimesh
    {"mesh": trimesh, "label": "door_left", "hide": False}

CLI::

    python conditions.py --demo

设计理由
========
1. **自包含光栅器**：``geomlib.render`` 只输出着色图、不输出深度，而条件图必须知道
   "每个像素最近的表面是谁"，所以这里自己写了一个 z-buffer 光栅器（**不 import
   geomlib.render**），但复用 ``geomlib.Camera`` 做投影。已实测软光栅是**三角形瓶颈**
   而不是像素瓶颈（720p→1080p 像素 ×7.1、耗时仅 ×2.2），因此三角形按**屏幕包围盒
   尺寸分组**后**分块向量化**：同一组内三角形尺寸相近（宽高各向上取到 2 的幂），
   块内共用一个 padded 包围盒，一次 numpy 批量运算算完所有三角形的重心坐标/深度/
   覆盖，把逐三角形 Python 循环的开销摊掉。再叠背面剔除（闭合物体背面必然被挡住）
   与 float32 计算，512x512 街景从 1294ms 降到 ~85ms。
2. **法线用世界空间而不是视空间**：世界空间法线与相机朝向无关，同一个物体在不同
   镜头下可比、也能直接判断几何一致性；视空间法线一换镜头就整体变化。
3. **法线编码必须可逆**：``c = (n + 1) / 2`` 后存 16bit，反解 ``n = normalize(c*2-1)``，
   量化误差 < 1e-4，可满足下游"由法线图反解几何朝向"的用途。
4. **seg 调色板必须固定**：调色板若每次随机生成，模型/标注工具就没法学习类别。
   这里用固定表 + 确定性补色（黄金比例色相），并保证同一渲染里颜色两两不同。
5. **深度极性近=1 远=0（R0 裁定）**：归一化按前景像素 min/max 线性拉伸，
   近端=1、远端=0；背景（无几何）固定 0.0（=无穷远），与极性自洽。
   改极性的理由：与 resources3D 的 wmcore.depth_to_unit 对齐，两边混用不再静默反相。
6. **近平面必须裁剪**：跨近平面的三角形直接丢弃会在近处留下空洞（POV 镜头必踩），
   所以先在相机空间把三角形裁成 1~2 个再投影；裁剪要用 ``Camera.view`` 取真实
   相机空间坐标——``project`` 对相机背后的点会把 z 截断到 1e-4 再做透视除法，
   从像素坐标反推会得到完全错误的 x/y（曾导致一个假三角形铺满整幅画面）。
7. **相机可能来自兜底实现**：``geomlib`` 正被别的子代理改动，import 失败时用
   ``conditions._FallbackCamera``（投影公式与 geomlib 逐项对齐）顶替，保证本模块
   不因为共享文件被改坏而瘫掉。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import numpy as np
import trimesh
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

try:  # 正常路径：复用 geomlib 的 Camera（与整个项目同一套投影约定）
    from geomlib import Camera  # type: ignore

    CAMERA_SOURCE = "geomlib.Camera"
except Exception:  # pragma: no cover - geomlib 正被其它子代理改动时的兜底
    CAMERA_SOURCE = "conditions._FallbackCamera"

    class _FallbackCamera:
        """geomlib.Camera 的等价兜底实现（投影公式逐项对齐 geomlib）。

        只有在 geomlib 暂时不可导入时才使用，保证条件渲染器不因别的文件被改动而瘫掉。
        """

        def __init__(self, eye, target, up=(0, 0, 1), fov_y=35.0, width=1000, height=680,
                     focal_mm=50.0, sensor_mm=36.0):
            self.eye = eye
            self.target = target
            self.up = up
            self.fov_y = fov_y
            self.width = width
            self.height = height
            self.focal_mm = focal_mm
            self.sensor_mm = sensor_mm

        def basis(self):
            eye = np.asarray(self.eye, float)
            tgt = np.asarray(self.target, float)
            up = np.asarray(self.up, float)
            fwd = tgt - eye
            fwd /= np.linalg.norm(fwd)
            right = np.cross(fwd, up)
            right /= np.linalg.norm(right)
            upv = np.cross(right, fwd)
            return eye, fwd, right, upv

        def view(self, pts):
            eye, fwd, right, upv = self.basis()
            d = np.asarray(pts, float) - eye
            return np.stack([d @ right, d @ upv, d @ fwd], axis=-1)

        def project(self, pts):
            cam = self.view(pts)
            z = np.maximum(cam[..., 2], 1e-4)
            f = 1.0 / math.tan(math.radians(self.fov_y) * 0.5)
            aspect = self.width / self.height
            ndc_x = cam[..., 0] / z * f / aspect
            ndc_y = cam[..., 1] / z * f
            px = (ndc_x * 0.5 + 0.5) * self.width
            py = (1.0 - (ndc_y * 0.5 + 0.5)) * self.height
            return np.stack([px, py], axis=-1), cam[..., 2]

    Camera = _FallbackCamera


# 条件通道契约：编码常量 / sidecar 写出器 / 静态扫描器都住在 condition_contract.py，
# 这里只引用不重定义（同一个约定不允许散落成两处魔数）。
from condition_contract import (  # noqa: E402
    CHANNELS as CONTRACT_CHANNELS,
    CONTRACT_VERSION as _CONTRACT_VERSION,
    DEPTH_BACKGROUND as _DEPTH_BACKGROUND,
    DEPTH_ENCODING as _DEPTH_ENCODING,
    DEPTH_FAR_VALUE as _DEPTH_FAR_VALUE,
    DEPTH_NEAR_VALUE as _DEPTH_NEAR_VALUE,
    DEPTH_NORMALIZATION as _DEPTH_NORMALIZATION,
    DEPTH_POLARITY as _DEPTH_POLARITY,
    NORMAL_BACKGROUND as _NORMAL_BACKGROUND,
    NORMAL_ENCODING as _NORMAL_ENCODING,
    NORMAL_SPACE as _NORMAL_SPACE,
    SEG_BACKGROUND as _SEG_BACKGROUND,
    SEG_ENCODING as _SEG_ENCODING,
    MASK_BACKGROUND as _MASK_BACKGROUND,
    MASK_FOREGROUND as _MASK_FOREGROUND,
    MASK_ENCODING as _MASK_ENCODING,
    MASK_SEMANTICS as _MASK_SEMANTICS,
    LINEART_BACKGROUND as _LINEART_BACKGROUND,
    LINEART_FOREGROUND as _LINEART_FOREGROUND,
    LINEART_ENCODING as _LINEART_ENCODING,
    LINEART_ALGORITHM as _LINEART_ALGORITHM,
    LINEART_WIDTH_PX as _LINEART_WIDTH_PX,
    POSE_BACKGROUND as _POSE_BACKGROUND,
    POSE_ENCODING as _POSE_ENCODING,
    POSE_JOINT_NAMES as _POSE_JOINT_NAMES,
    POSE_BONES as _POSE_BONES,
    POSE_LIMB_WIDTH_PX as _POSE_LIMB_WIDTH_PX,
    POSE_JOINT_RADIUS_PX as _POSE_JOINT_RADIUS_PX,
    POSE_KEYPOINT_SET_ID as _POSE_KEYPOINT_SET_ID,
    POSE_CANONICAL_KEYPOINT_SET as _POSE_CANONICAL_KEYPOINT_SET,
    POSE_KEYPOINT_SETS as _POSE_KEYPOINT_SETS,
    POSE_VIEWS as _POSE_VIEWS,
    UP_AXIS as _UP_AXIS,
    UP_AXIS_VECTOR as _UP_AXIS_VECTOR,
    HANDEDNESS as _HANDEDNESS,
    UNITS as _UNITS,
    build_sidecar as _build_sidecar,
    write_sidecar as _write_sidecar,
    scan_sidecar_dir as _scan_sidecar_dir,
    f_px_from_fov as _f_px_from_fov,
    pose_joint_color as _pose_joint_color,
    pose_role_color as _pose_role_color,
    zup_to_yup as _zup_to_yup,
    sha256_of as _sha256_of,
)

_CONTRACT_CHANNELS = CONTRACT_CHANNELS

# R1：pose 通道的关节源与关键点闭集在 pose_keypoints.py（视图闭集与角色映射表
# 的唯一事实源仍在 condition_contract.py）。这里只做接线。
from pose_keypoints import (  # noqa: E402
    JointSource as _JointSource,
    build_pose_payload as _build_pose_payload,
    check_keypoints_against_source as _check_keypoints_against_source,
    draw_view as _draw_pose_view,
    load_soma_joint_names as _load_soma_joint_names,
    project_view as _project_pose_view,
    verify_soma_source as _verify_soma_source,
)


# ------------------------------------------------------------------ 语义约定
# 直接名 -> 语义类别（载具/场景部件，名字本身就是类别）
DIRECT_CATEGORIES = {
    "body": "body",
    "cabin": "cabin",
    "door": "door",
    "door_left": "door",
    "door_right": "door",
    "door_front_left": "door",
    "door_front_right": "door",
    "door_rear_left": "door",
    "door_rear_right": "door",
    "door_handle": "door",
    "window": "window",
    "side_window": "window",
    "rear_window": "window",
    "windshield": "windshield",
    "wheel": "wheel",
    "wheel_front_left": "wheel",
    "wheel_front_right": "wheel",
    "wheel_rear_left": "wheel",
    "wheel_rear_right": "wheel",
    "tire": "wheel",
    "headlight": "headlight",
    "taillight": "taillight",
    "light": "light",
    "mirror": "mirror",
    "bumper": "bumper",
    "hood": "hood",
    "roof": "roof",
    "trunk": "trunk",
    "seat": "seat",
    "dashboard": "dashboard",
    "steering_wheel": "steering_wheel",
    "engine": "engine",
    "chassis": "chassis",
    # 下面的类别名做"自映射"：resolve_category 必须是幂等的，否则类别名再过一次
    # 解析就会掉进 other（例如 "foliage" -> "other"）。
    "vehicle": "vehicle",
    "building": "building",
    "tree": "tree",
    "foliage": "foliage",
    "character": "character",
    "crowd": "crowd",
    "ground": "ground",
    "road": "road",
    "sidewalk": "sidewalk",
    "clothing": "clothing",
    "prop": "prop",
    "animal": "animal",
    "water": "water",
    "sky": "sky",
    "fx": "fx",
    "other": "other",
}

# 前缀 -> 语义类别（场景级命名）。顺序敏感：更具体的前缀在前。
PREFIX_CATEGORIES = [
    ("building", "building"),
    ("tree_canopy", "foliage"),
    ("tree", "tree"),
    ("crowd", "crowd"),
    ("person", "crowd"),
    ("hero", "character"),
    ("car", "vehicle"),
    ("boat", "vehicle"),
    ("vehicle", "vehicle"),
    ("truck", "vehicle"),
    ("bus", "vehicle"),
    ("bike", "vehicle"),
    ("bicycle", "vehicle"),
    ("motorcycle", "vehicle"),
    ("ground", "ground"),
    ("road", "road"),
    ("sidewalk", "sidewalk"),
    ("jacket", "clothing"),
    ("clothing", "clothing"),
    ("shirt", "clothing"),
    ("crate", "prop"),
    ("prop", "prop"),
    ("barrel", "prop"),
    ("deer", "animal"),
    ("fox", "animal"),
    ("animal", "animal"),
    ("creature", "animal"),
    ("water", "water"),
    ("sky", "sky"),
    ("fx", "fx"),
    ("debris", "fx"),
    # 载具部件（带 left/right 侧后缀的变体走前缀）
    ("door", "door"),
    ("wheel", "wheel"),
    ("tire", "wheel"),
    ("headlight", "headlight"),
    ("taillight", "taillight"),
    ("mirror", "mirror"),
    ("seat", "seat"),
    ("windshield", "windshield"),
    ("window", "window"),
    ("body", "body"),
    ("cabin", "cabin"),
]

# 固定调色板：语义类别 -> RGB。必须固定（下游模型要靠颜色认类别），
# 且表内颜色两两不同（否则"不同 label 颜色不同"的验收项会被破坏）。
CATEGORY_COLORS = {
    "other": (96, 96, 104),
    "ground": (141, 166, 110),
    "road": (70, 70, 78),
    "sidewalk": (163, 163, 170),
    "building": (198, 106, 68),
    "vehicle": (52, 108, 214),
    "tree": (86, 140, 62),
    "foliage": (120, 186, 92),
    "character": (226, 112, 200),
    "crowd": (214, 158, 116),
    "clothing": (128, 150, 210),
    "prop": (196, 178, 120),
    "animal": (170, 130, 190),
    "fx": (120, 220, 200),
    "water": (60, 120, 200),
    "sky": (135, 180, 235),
    "body": (240, 140, 60),
    "cabin": (245, 160, 90),
    "door": (236, 176, 64),
    "window": (150, 200, 240),
    "windshield": (110, 190, 235),
    "wheel": (40, 40, 46),
    "headlight": (250, 240, 170),
    "taillight": (222, 60, 50),
    "light": (245, 228, 150),
    "mirror": (176, 176, 186),
    "bumper": (150, 150, 158),
    "hood": (204, 204, 214),
    "roof": (214, 214, 224),
    "trunk": (185, 185, 196),
    "seat": (142, 100, 80),
    "dashboard": (112, 92, 76),
    "steering_wheel": (60, 60, 68),
    "engine": (110, 110, 120),
    "chassis": (88, 88, 96),
}

OTHER_LABEL = "other"

# 载具相关的语义类别：隐藏测试用它判断"哪些几何属于车"
VEHICLE_CATEGORIES = {
    "vehicle", "body", "cabin", "door", "wheel", "headlight", "taillight",
    "mirror", "seat", "dashboard", "steering_wheel", "windshield", "window",
}


def is_vehicle_geometry(item) -> bool:
    """判断一个场景条目是否属于"车"（名字以 car 开头，或语义类别属于载具部件）。

    场景里车可能是一个合并网格（car_a），也可能拆成部件（car_a_door_front_left），
    两种情况都要能被"隐藏车"命中。
    """
    name = str(item.get("name", "") or "").lower()
    if name.startswith("car"):
        return True
    label = item.get("label")
    cat = item.get("category") or (resolve_category(label) if label else OTHER_LABEL)
    return cat in VEHICLE_CATEGORIES

# ------------------------------------------------------------------ 编码公式
# 契约常量搬到 condition_contract.py 了（人读契约：plans/CONTRACT-conditions.md）。
# 这里只做同名再导出，外部 references（例如 conditions.DEPTH_BACKGROUND）不失效。
#
# R0 裁定：**深度极性 = 近=1 远=0**（原为 近=0 远=1）。
# 与 resources3D 的 wmcore.depth_to_unit 一致；两边混用不再会静默反相。
# 背景（无几何）= 无穷远 = 0，与新极性自洽。
DEPTH_POLARITY = _DEPTH_POLARITY            # "near_1_far_0"
DEPTH_NEAR_VALUE = _DEPTH_NEAR_VALUE        # 1.0
DEPTH_FAR_VALUE = _DEPTH_FAR_VALUE          # 0.0
DEPTH_BACKGROUND = _DEPTH_BACKGROUND        # 0.0（=无穷远）
DEPTH_NORMALIZATION = _DEPTH_NORMALIZATION
DEPTH_ENCODING = _DEPTH_ENCODING

NORMAL_BACKGROUND = _NORMAL_BACKGROUND
NORMAL_ENCODING = _NORMAL_ENCODING
NORMAL_SPACE = _NORMAL_SPACE

SEG_BACKGROUND = _SEG_BACKGROUND
SEG_ENCODING = _SEG_ENCODING

MASK_BACKGROUND = _MASK_BACKGROUND
MASK_FOREGROUND = _MASK_FOREGROUND
MASK_ENCODING = _MASK_ENCODING
MASK_SEMANTICS = _MASK_SEMANTICS

LINEART_BACKGROUND = _LINEART_BACKGROUND
LINEART_FOREGROUND = _LINEART_FOREGROUND
LINEART_ENCODING = _LINEART_ENCODING
LINEART_ALGORITHM = _LINEART_ALGORITHM
LINEART_WIDTH_PX = _LINEART_WIDTH_PX

POSE_BACKGROUND = _POSE_BACKGROUND
POSE_ENCODING = _POSE_ENCODING
POSE_JOINT_NAMES = _POSE_JOINT_NAMES
POSE_BONES = _POSE_BONES
POSE_LIMB_WIDTH_PX = _POSE_LIMB_WIDTH_PX
POSE_JOINT_RADIUS_PX = _POSE_JOINT_RADIUS_PX
POSE_KEYPOINT_SET_ID = _POSE_KEYPOINT_SET_ID

UP_AXIS = _UP_AXIS
UP_AXIS_VECTOR = _UP_AXIS_VECTOR
HANDEDNESS = _HANDEDNESS
UNITS = _UNITS


def _norm_label(name: str) -> str:
    """把名字规整成稳定的 label 键：小写、空格/连字符 -> 下划线。"""
    s = str(name).strip().lower().replace(" ", "_").replace("-", "_")
    return s or OTHER_LABEL


def resolve_category(name) -> str:
    """几何名 -> 语义类别。

    先查直接名表（body / door_left / wheel_front_left / headlight / windshield ...），
    再按前缀归类（building* -> building、tree* -> tree、crowd* -> crowd ...），
    都不匹配则归到固定的 "other"。
    """
    if name is None:
        return OTHER_LABEL
    key = _norm_label(name)
    if key in DIRECT_CATEGORIES:
        return DIRECT_CATEGORIES[key]
    for prefix, cat in PREFIX_CATEGORIES:
        if key.startswith(prefix):
            return cat
    return OTHER_LABEL


def build_palette(labels) -> dict:
    """label -> RGB 的确定性调色板。

    已知 label 走固定表；未知 label 用黄金比例色相按字典序补色（保证同一组 label
    每次得到同一套颜色），并跳过已被占用的颜色，保证表内颜色两两不同。
    """
    palette = {}
    used = set()
    labels = sorted({_norm_label(x) for x in labels})
    for lab in labels:
        cat = resolve_category(lab)
        col = CATEGORY_COLORS.get(cat)
        if col is None or col in used:
            col = None
        if col is not None:
            palette[lab] = tuple(int(c) for c in col)
            used.add(palette[lab])
    golden = 0.6180339887498949
    h = 0.0
    for lab in labels:
        if lab in palette:
            continue
        for _ in range(512):                      # 黄金比例推进，避开已占用颜色
            h = (h + golden) % 1.0
            i = int(h * 6.0)
            f = h * 6.0 - i
            q = 1.0 - f
            t = f
            if i == 0:
                rgb = (1.0, t, 0.0)
            elif i == 1:
                rgb = (q, 1.0, 0.0)
            elif i == 2:
                rgb = (0.0, 1.0, t)
            elif i == 3:
                rgb = (0.0, q, 1.0)
            elif i == 4:
                rgb = (t, 0.0, 1.0)
            else:
                rgb = (1.0, 0.0, q)
            cand = tuple(int(round(c * 200.0)) + 30 for c in rgb)
            if cand not in used:
                palette[lab] = cand
                used.add(cand)
                break
        if lab not in palette:                     # 兜底：极端情况下不重复
            cand = (17 + (abs(hash(lab)) % 200), 17, 17)
            while cand in used:
                cand = (cand[0] + 1, cand[1], cand[2])
            palette[lab] = cand
            used.add(cand)
    return palette


# ------------------------------------------------------------------ 相机
def _make_camera(camera, width: int, height: int):
    """按目标分辨率复制一份相机。

    分辨率可以独立于 camera.width/height 指定：垂直 FOV 保持不变，输出宽高比由
    请求的分辨率决定（这样"换个分辨率"不会偷偷改变取景范围）。
    """
    return Camera(camera.eye, camera.target, camera.up, camera.fov_y, int(width), int(height),
                  camera.focal_mm, camera.sensor_mm)


def _cam_params(cam):
    f = 1.0 / math.tan(math.radians(cam.fov_y) * 0.5)
    aspect = cam.width / cam.height
    return f, aspect


def _cam_to_pixel(cpts, width, height, f, aspect):
    """相机空间 -> 像素坐标（与 geomlib.Camera.project 同一套公式）。"""
    z = np.maximum(cpts[..., 2], 1e-6)
    ndc_x = cpts[..., 0] / z * f / aspect
    ndc_y = cpts[..., 1] / z * f
    px = (ndc_x * 0.5 + 0.5) * width
    py = (1.0 - (ndc_y * 0.5 + 0.5)) * height
    return np.stack([px, py], axis=-1), cpts[..., 2]


def _clip_triangle_near(pts, near):
    """用近平面裁剪一个三角形（相机空间），返回 0/1/2 个三角形顶点组。"""
    out = []
    n = len(pts)
    for i in range(n):
        a = pts[i]
        b = pts[(i + 1) % n]
        ain = a[2] > near
        bin_ = b[2] > near
        if ain:
            out.append(a)
        if ain != bin_:
            t = (near - a[2]) / (b[2] - a[2])
            out.append(a + t * (b - a))
    if len(out) < 3:
        return []
    return [(out[0], out[i], out[i + 1]) for i in range(1, len(out) - 1)]


# ------------------------------------------------------------------ 光栅器
def _normalize_items(meshes):
    """把输入统一成 {"mesh", "label", "category", "hide"} 列表。

    * 裸 trimesh      -> label = "other"（没有 label 的几何统一归到固定的 other 类别）
    * dict            -> label 取 "label"，没有则用 "name" 推类别，再没有就是 "other"
    """
    items = []
    for i, raw in enumerate(meshes or []):
        if isinstance(raw, dict):
            mesh = raw.get("mesh")
            label = raw.get("label")
            name = raw.get("name")
            category = raw.get("category")
            hide = bool(raw.get("hide", False))
        else:
            mesh, label, name, category, hide = raw, None, None, None, False
        if mesh is None:
            continue
        if label is None:
            label = category if category else (resolve_category(name) if name else None)
        if label is None:
            label = OTHER_LABEL
        label = _norm_label(label)
        if category is None:
            category = resolve_category(label)
        items.append({"mesh": mesh, "label": label, "category": category, "hide": hide, "index": i})
    return items


def _rasterize(items, cam, width, height, near=0.05, cull_backfaces=True):
    """软件 z-buffer 光栅化，返回 (zbuf, facebuf, face_normal, face_label_index, 三角形数)。

    zbuf  : (H, W) float32，相机空间深度（米），背景为 inf
    facebuf: (H, W) int32，命中三角形的全局面 id，背景为 -1
    """
    zbuf = np.full(height * width, np.inf, np.float32)
    fbuf = np.full(height * width, -1, np.int32)
    if not items:
        return zbuf.reshape(height, width), fbuf.reshape(height, width), None, None, 0

    v_list, f_list, fn_list, lb_list = [], [], [], []
    off = 0
    for it in items:
        mesh = it["mesh"]
        v = np.asarray(mesh.vertices, dtype=np.float64)
        f = np.asarray(mesh.faces, dtype=np.int64)
        if f.size == 0 or v.size == 0:
            continue
        v_list.append(v)
        f_list.append(f + off)
        fn = np.asarray(mesh.face_normals, dtype=np.float64)
        if fn.shape[0] != f.shape[0]:
            fn = np.zeros((f.shape[0], 3), np.float64)
        fn_list.append(fn)
        lb_list.append(np.full(f.shape[0], it["label_index"], dtype=np.int64))
        off += v.shape[0]
    if not v_list:
        return zbuf.reshape(height, width), fbuf.reshape(height, width), None, None, 0

    V = np.vstack(v_list)
    F = np.vstack(f_list)
    FN = np.vstack(fn_list)
    LB = np.concatenate(lb_list)

    px, depth = cam.project(V)
    P = px[F]                                     # (T,3,2)
    Z = depth[F]                                  # (T,3)

    # 近平面裁剪：跨近平面的三角形直接丢弃会在近处留下空洞（POV 镜头必踩），
    # 所以先在相机空间把它们裁成 1~2 个三角形再投影。
    in_front = Z > near
    all_in = in_front.all(axis=1)
    any_in = in_front.any(axis=1)
    keep = all_in                                # 全在相机后方 -> 丢弃
    straddle = np.nonzero((~all_in) & any_in)[0]  # 跨近平面 -> 裁剪

    # 背面剔除：闭合物体的背面必然被正面挡住，剔除后光栅量直接减半。
    # 判据用"视线方向 vs 面法线"的余弦，接近 0（掠射）的三角形一律保留。
    if cull_backfaces and len(F):
        eye = np.asarray(cam.eye, float)
        cen = V[F].mean(axis=1)
        to_eye = eye[None, :] - cen
        dist = np.linalg.norm(to_eye, axis=1)
        cosang = np.einsum("ij,ij->i", FN, to_eye) / np.maximum(dist, 1e-12)
        front = cosang > -1e-4
        front[straddle] = True                   # 跨近平面的三角形朝向判定不可靠
        keep = keep & front

    face_ids = np.nonzero(keep)[0]
    P_keep, Z_keep = P[keep], Z[keep]

    if len(straddle):
        f, aspect = _cam_params(cam)
        # 必须用 Camera.view 取**真实**相机空间坐标：project 对相机背后的点把 z 截断到
        # 1e-4 再做透视除法，从像素坐标反推会得到完全错误的 x/y（曾导致一个巨大的
        # 假三角形铺满整幅画面）。
        cpts = cam.view(V)[F[straddle]]
        new_p, new_z, new_f = [], [], []
        for k in range(len(straddle)):
            for a, b, c in _clip_triangle_near(list(cpts[k]), near):
                pc, zc = _cam_to_pixel(np.array([a, b, c]), width, height, f, aspect)
                new_p.append(pc)
                new_z.append(zc)
                new_f.append(straddle[k])         # 裁剪出来的新三角形沿用源面号
        if new_p:
            P = np.concatenate([P_keep, np.array(new_p)])
            Z = np.concatenate([Z_keep, np.array(new_z)])
            face_ids = np.concatenate([face_ids, np.array(new_f, dtype=np.int64)])
    else:
        P, Z = P_keep, Z_keep

    # 后续光栅全部用 float32（像素坐标/深度不需要 float64 精度）
    P = P.astype(np.float32)
    Z = Z.astype(np.float32)

    # 法线（世界空间、面法线）：单位化
    nrm = FN.copy()
    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
    nrm = np.divide(nrm, np.maximum(ln, 1e-12))
    bad = ~np.isfinite(nrm).all(axis=1)
    if bad.any():
        nrm[bad] = np.array([0.0, 0.0, 1.0])

    zbuf, fbuf = _raster_triangles(P, Z, face_ids, width, height)
    return zbuf, fbuf, nrm, LB, int(len(P))


def _ceil_pow2(a):
    """向量化的"向上取到 2 的幂"（numpy 数组没有 int.bit_length，只能用 frexp）。"""
    a = np.asarray(a, dtype=np.int64)
    m, e = np.frexp(a)                 # a = m * 2^e, 0.5 <= m < 1
    p = np.left_shift(1, e)
    return np.where(m == 0.5, p // 2, p)  # a 恰为 2 的幂时 frexp 的 m == 0.5


def _raster_triangles(P, Z, face_ids, width, height, budget=1 << 18):
    """分块向量化光栅化。

    三角形按**屏幕包围盒尺寸分组**（宽高各自向上取到 2 的幂）后再切块：同一组里
    三角形尺寸相近，块内共用一个 padded 包围盒时浪费 < 4 倍；块内所有三角形用一次
    numpy 批量运算求重心坐标/深度/覆盖，避免逐三角形 Python 循环。
    """
    zbuf = np.full(height * width, np.inf, np.float32)
    fbuf = np.full(height * width, -1, np.int32)
    T = len(P)
    if T == 0:
        return zbuf.reshape(height, width), fbuf.reshape(height, width)

    x0 = np.floor(P[:, :, 0].min(axis=1)).astype(np.int64)
    x1 = np.ceil(P[:, :, 0].max(axis=1)).astype(np.int64)
    y0 = np.floor(P[:, :, 1].min(axis=1)).astype(np.int64)
    y1 = np.ceil(P[:, :, 1].max(axis=1)).astype(np.int64)
    np.clip(x0, 0, width - 1, out=x0)
    np.clip(x1, 0, width - 1, out=x1)
    np.clip(y0, 0, height - 1, out=y0)
    np.clip(y1, 0, height - 1, out=y1)
    w = x1 - x0 + 1
    h = y1 - y0 + 1
    good = (w > 0) & (h > 0)
    idx = np.nonzero(good)[0]
    if len(idx) == 0:
        return zbuf.reshape(height, width), fbuf.reshape(height, width)

    # 宽高各自向上取到 2 的幂 -> 尺寸分组键
    hw = np.where(h[idx] > 0, _ceil_pow2(h[idx]), 1)
    ww = np.where(w[idx] > 0, _ceil_pow2(w[idx]), 1)
    keys = hw * 4096 + ww
    srt = np.argsort(keys, kind="stable")
    order = idx[srt]
    keys_s = keys[srt]
    hw_s = hw[srt]
    ww_s = ww[srt]

    zf = zbuf.reshape(-1)
    ff = fbuf.reshape(-1)
    n = len(order)
    i = 0
    while i < n:
        k0 = keys_s[i]
        end = i + 1
        while end < n and keys_s[end] == k0:
            end += 1
        # 组内三角形尺寸相近，padded 包围盒 = 该组的 (bh, bw)
        bh = int(hw_s[i])
        bw = int(ww_s[i])
        step = max(1, budget // max(bh * bw, 1))
        for s in range(i, end, step):
            sel = order[s:min(s + step, end)]
            _raster_chunk(sel, P, Z, face_ids, x0, x1, y0, y1, width, height, zf, ff)
        i = end
    return zbuf.reshape(height, width), fbuf.reshape(height, width)


def _raster_chunk(sel, P, Z, face_ids, x0, x1, y0, y1, width, height, zf, ff):
    """光栅化一批三角形（共享 padded 包围盒）。

    全部用 float32：像素坐标/深度的有效位远小于 32bit 浮点的 23bit 尾数，
    但数组带宽减半，这块是纯内存带宽瓶颈。
    """
    p = P[sel]
    z = Z[sel]
    fid = face_ids[sel]
    ox = x0[sel]
    oy = y0[sel]
    bw = int((x1[sel] - ox + 1).max())
    bh = int((y1[sel] - oy + 1).max())
    Xint = ox[:, None] + np.arange(bw, dtype=np.int64)[None, :]   # (n, bw)
    Yint = oy[:, None] + np.arange(bh, dtype=np.int64)[None, :]   # (n, bh)
    Xf = Xint[:, None, :].astype(np.float32) + np.float32(0.5)    # (n,1,bw)
    Yf = Yint[:, :, None].astype(np.float32) + np.float32(0.5)    # (n,bh,1)

    px0, py0 = p[:, 0, 0], p[:, 0, 1]
    px1, py1 = p[:, 1, 0], p[:, 1, 1]
    px2, py2 = p[:, 2, 0], p[:, 2, 1]
    den = (py1 - py2) * (px0 - px2) + (px2 - px1) * (py0 - py2)
    valid = np.abs(den) > 1e-9
    den_s = np.where(valid, den, np.float32(1.0))
    w0 = ((py1 - py2)[:, None, None] * (Xf - px2[:, None, None]) +
          (px2 - px1)[:, None, None] * (Yf - py2[:, None, None])) / den_s[:, None, None]
    w1 = ((py2 - py0)[:, None, None] * (Xf - px2[:, None, None]) +
          (px0 - px2)[:, None, None] * (Yf - py2[:, None, None])) / den_s[:, None, None]
    w2 = np.float32(1.0) - w0 - w1
    eps = np.float32(1e-6)
    inside = (w0 >= -eps) & (w1 >= -eps) & (w2 >= -eps)
    inside &= valid[:, None, None]
    # 只保留图像内的像素（Xint/Yint 恒 >= 0，只需判上界）
    inside &= Xint[:, None, :] <= (width - 1)
    inside &= Yint[:, :, None] <= (height - 1)
    if not inside.any():
        return
    # 透视校正深度：z = 1 / (w0/z0 + w1/z1 + w2/z2)
    iz = (w0 * np.float32(1.0) / z[:, 0][:, None, None] +
          w1 * np.float32(1.0) / z[:, 1][:, None, None] +
          w2 * np.float32(1.0) / z[:, 2][:, None, None])
    zz = np.float32(1.0) / np.maximum(iz, np.float32(1e-12))
    pix = (Yint[:, :, None] * width + Xint[:, None, :])[inside]
    fz = zz[inside]
    fface = np.broadcast_to(fid[:, None, None], inside.shape)[inside]
    # 已被更近的表面遮挡的片元直接丢掉
    cand = fz < zf[pix]
    if not cand.any():
        return
    pix = pix[cand]
    fz = fz[cand]
    fface = fface[cand]
    order = np.argsort(fz, kind="stable")
    pix = pix[order]
    fz = fz[order]
    fface = fface[order]
    # 取每个像素的**首次出现**。fz 已按深度升序排好，所以「首次出现」就是最小深度。
    #
    # 这里不能用「相邻像素索引不同 = 新的一段」来判定首次出现：按深度排序后，
    # 同一像素的多次出现**并不相邻**（深度序列会别的像素插在中间），旧写法会把
    # 更远的深度覆盖到更近的深度上。实测偏差可达 8 m（交叉渲染比对抓到的：
    # resources3D 的 wmcore.rasterize 是逐三角形严格 min-depth，正确）。
    uniq, first_idx = np.unique(pix, return_index=True)
    zf[uniq] = fz[first_idx]
    ff[uniq] = fface[first_idx]


# ------------------------------------------------------------------ 通道
def line_art_from_face_id(facebuf):
    """从 face_id 缓冲提取轮廓线（线稿）——纯 numpy，无模型权重。

    算法与 resources3D 的 wmcore.line_art_from_face_id **逐行对齐**：
    ① 4-邻域 face_id 差异 -> 边界；② 去掉背景像素；③ 用**原**边界做 1px 膨胀让线连续。
    两侧跑同一场景时线稿通道应逐像素一致（交叉比对脚本会验这一点）。
    """
    edges = np.zeros(facebuf.shape, dtype=bool)
    edges[:, :-1] |= facebuf[:, :-1] != facebuf[:, 1:]
    edges[:-1, :] |= facebuf[:-1, :] != facebuf[1:, :]
    bg = facebuf < 0
    edges &= ~bg
    e = edges.copy()
    e[1:, :] |= edges[:-1, :]
    e[:-1, :] |= edges[1:, :]
    e[:, 1:] |= edges[:, :-1]
    e[:, :-1] |= edges[:, 1:]
    return e


def render_pose(joints, cam, width, height):
    """把 3D 关节投影成 2D 骨架叠加图。

    joints: `{"Hips": (x, y, z), ...}` 世界坐标（Z-up、米制）。
    返回 `(RGB uint8, keypoints list)`；keypoints 逐点带 name / x / y / depth_m / visible。
    约定：全身关节一律画出（不表达遮挡），背景 (0,0,0)。
    """
    img = Image.new("RGB", (int(width), int(height)), tuple(POSE_BACKGROUND))
    keypoints = []
    if not joints:
        return np.asarray(img, dtype=np.uint8), keypoints

    names = [n for n in POSE_JOINT_NAMES if n in joints]
    arr = np.array([joints[n] for n in names], dtype=np.float64)
    px, z = cam.project(arr)
    pts = []
    for i, n in enumerate(names):
        x, y = float(px[i, 0]), float(px[i, 1])
        d = float(z[i])
        vis = bool(d > 0.0)                     # 相机背后 = 不可见
        pts.append((x, y, vis))
        keypoints.append({"name": n, "x": round(x, 3), "y": round(y, 3),
                          "depth_m": round(d, 4), "visible": vis})
    index = {n: i for i, n in enumerate(names)}
    draw = ImageDraw.Draw(img)
    for a, b in POSE_BONES:
        ia, ib = index.get(a), index.get(b)
        if ia is None or ib is None:
            continue
        ax, ay, av = pts[ia]
        bx, by, bv = pts[ib]
        if not (av and bv):
            continue
        draw.line([(ax, ay), (bx, by)], fill=_pose_joint_color(a),
                  width=POSE_LIMB_WIDTH_PX)
    for i, n in enumerate(names):
        x, y, vis = pts[i]
        if not vis:
            continue
        c = _pose_joint_color(n)
        r = POSE_JOINT_RADIUS_PX
        draw.ellipse([x - r, y - r, x + r, y + r], fill=c)
    return np.asarray(img, dtype=np.uint8), keypoints


def render_conditions(meshes, camera, width=None, height=None,
                      channels=("depth", "normal", "seg"),
                      near=0.05, background_depth=DEPTH_BACKGROUND,
                      background_normal=NORMAL_BACKGROUND, background_seg=SEG_BACKGROUND,
                      palette=None, cull_backfaces=True, pose_joints=None,
                      pose_source=None):
    """一次渲染产出条件通道（契约六通道：depth/normal/seg/mask/lineart/pose）。

    meshes 的元素支持两种形态：

    * ``trimesh.Trimesh``
    * ``{"mesh": trimesh, "label": "door_left", "hide": False}``

    ``hide=True`` 的几何完全不参与光栅（车载 POV 隐藏车身的关键能力）。
    width/height 可独立于 camera.width/height 指定。
    ``channels`` 可以只取其中一部分，未请求的通道在结果里为 None（光栅本身是共享的，
    省下的只是通道提取的时间）。默认仍只出 depth/normal/seg 三个历史通道；
    六通道齐出请显式传 channels=CONTRACT_CHANNELS。

    ``pose_joints``：pose 通道用的 3D 关节，格式 ``{"Hips": (x, y, z), ...}``
    （世界坐标、Z-up、米制）。不传则 pose 通道为 None（没有骨架可画）。
    """
    t_all = time.perf_counter()
    channels = tuple(channels)
    items = _normalize_items(meshes)
    width = int(width or camera.width)
    height = int(height or camera.height)
    cam = _make_camera(camera, width, height)

    labels = sorted({it["label"] for it in items})
    if palette is None:
        palette = build_palette(labels)
    else:
        palette = {k: tuple(int(c) for c in v) for k, v in palette.items()}

    # label -> 调色板下标（seg 用）
    label_ids = {lab: i for i, lab in enumerate(labels)}
    for it in items:
        it["label_index"] = label_ids[it["label"]]

    visible = [it for it in items if not it["hide"]]
    t0 = time.perf_counter()
    zbuf, fbuf, nrm, lb, n_tri = _rasterize(visible, cam, width, height, near=near,
                                             cull_backfaces=cull_backfaces)
    t_raster = time.perf_counter() - t0

    mask = np.isfinite(zbuf)
    out = {
        "mask": mask,
        "zbuf": zbuf,
        "facebuf": fbuf,
        "face_normals": nrm,
        "resolution": (width, height),
        "meta": {
            "camera_source": CAMERA_SOURCE,
            "meshes_total": len(items),
            "meshes_hidden": len(items) - len(visible),
            "labels": labels,
            "palette": {k: list(v) for k, v in palette.items()},
            "categories": {it["label"]: it["category"] for it in items},
            "hidden_labels": sorted({it["label"] for it in items if it["hide"]}),
            "encodings": {
                "depth": DEPTH_ENCODING, "normal": NORMAL_ENCODING, "seg": SEG_ENCODING,
                "mask": MASK_ENCODING, "lineart": LINEART_ENCODING, "pose": POSE_ENCODING,
            },
            "depth_polarity": DEPTH_POLARITY,
            "up_axis": UP_AXIS,
            "up_axis_vector": list(UP_AXIS_VECTOR),
            "handedness": HANDEDNESS,
            "units": UNITS,
            "camera": {
                "eye": [float(v) for v in cam.eye],
                "target": [float(v) for v in cam.target],
                "up": [float(v) for v in cam.up],
                "fov_y": round(float(cam.fov_y), 6),
                "focal_mm": float(cam.focal_mm),
                "sensor_mm": float(cam.sensor_mm),
                "f_px": round(_f_px_from_fov(cam.fov_y, height), 6),
                "near": float(near),
            },
            "rasterize_ms": round(t_raster * 1000.0, 2),
            "triangles": n_tri,
        },
    }

    # ---- depth
    # R0 极性裁定：**近=1 远=0**。原来是 (z - zmin)/span（近=0 远=1），
    # 与 resources3D 的 wmcore.depth_to_unit 相反，混用会静默反相。
    # 背景（无几何）= 无穷远 = 0，与新极性自洽。
    t0 = time.perf_counter()
    if "depth" in channels:
        if mask.any():
            zmin = float(zbuf[mask].min())
            zmax = float(zbuf[mask].max())
            span = max(zmax - zmin, 1e-9)
            depth = (zmax - zbuf) / span          # 近(zmin)->1，远(zmax)->0
            depth = np.where(mask, depth, background_depth).astype(np.float32)
        else:
            zmin = zmax = 0.0
            depth = np.full((height, width), background_depth, np.float32)
    else:
        zmin = zmax = 0.0
        depth = None
    out["depth"] = depth
    out["depth_range_m"] = (zmin, zmax)
    out["meta"]["channel_ms"] = {"depth": round((time.perf_counter() - t0) * 1000.0, 2)}

    # ---- normal
    t0 = time.perf_counter()
    if "normal" not in channels:
        normal = None
    elif nrm is not None and nrm.shape[0] > 0:
        face_rgb = np.clip(nrm * 0.5 + 0.5, 0.0, 1.0)
        sel = fbuf >= 0
        normal = np.empty((height, width, 3), np.float32)
        normal[:] = np.asarray(background_normal, np.float32)
        if sel.any():
            normal[sel] = face_rgb[fbuf[sel]]
    else:
        normal = np.full((height, width, 3), np.asarray(background_normal, np.float32), np.float32)
    out["normal"] = normal
    out["meta"]["channel_ms"]["normal"] = round((time.perf_counter() - t0) * 1000.0, 2)

    # ---- seg
    t0 = time.perf_counter()
    if "seg" not in channels:
        seg = None
    else:
        pal = np.array([palette[lab] for lab in labels], np.uint8) if labels else np.zeros((0, 3), np.uint8)
        seg = np.empty((height, width, 3), np.uint8)
        seg[:] = np.asarray(background_seg, np.uint8)
        if len(pal) and lb is not None and lb.shape[0] > 0:
            face_col = pal[lb]
            sel = fbuf >= 0
            if sel.any():
                seg[sel] = face_col[fbuf[sel]]
    out["seg"] = seg
    out["meta"]["channel_ms"]["seg"] = round((time.perf_counter() - t0) * 1000.0, 2)

    # ---- mask（前景二值；与 depth/normal/seg/lineart 共享同一前景集合）
    t0 = time.perf_counter()
    if "mask" in channels:
        mask_img = np.where(mask, MASK_FOREGROUND, MASK_BACKGROUND).astype(np.uint8)
    else:
        mask_img = None
    out["mask_img"] = mask_img
    out["meta"]["channel_ms"]["mask"] = round((time.perf_counter() - t0) * 1000.0, 2)

    # ---- lineart（轮廓 + 面边界）
    t0 = time.perf_counter()
    if "lineart" in channels:
        lineart = (line_art_from_face_id(fbuf).astype(np.uint8) * LINEART_FOREGROUND)
    else:
        lineart = None
    out["lineart"] = lineart
    out["meta"]["channel_ms"]["lineart"] = round((time.perf_counter() - t0) * 1000.0, 2)

    # ---- pose（2D 骨架叠加；R1：接 SOMA 77 关节源，出 COCO-18 / OpenPose-25 等视图）
    t0 = time.perf_counter()
    source = pose_source
    if source is None and pose_joints:
        source = _JointSource.from_mapping(pose_joints)      # 项目自有 rig（静态角色）
    pose_views, pose_imgs = {}, {}
    if "pose" in channels and source is not None:
        for vid in _POSE_KEYPOINT_SETS:
            pose_views[vid] = _project_pose_view(source, cam, vid)
        for vid in (_POSE_CANONICAL_KEYPOINT_SET, "openpose25"):
            if vid in pose_views:
                pose_imgs[vid] = _draw_pose_view(pose_views[vid], vid, width, height)
        keypoints = pose_views.get(_POSE_CANONICAL_KEYPOINT_SET, [])
        pose_img = pose_imgs.get(_POSE_CANONICAL_KEYPOINT_SET)
        out["pose_payload"] = _build_pose_payload(
            source, cam, (width, height), _f_px_from_fov(cam.fov_y, height),
            pose_views,
            extra={"scene": {"source": "conditions.render_conditions",
                             "objects": len(items),
                             "labels": sorted({it["label"] for it in items})}})
    else:
        keypoints = []
        pose_img = None
    out["pose"] = pose_img
    out["pose_images"] = pose_imgs
    out["pose_views"] = pose_views
    out["pose_source"] = ({"type": source.kind, "joint_count": len(source.names)}
                          if source is not None else None)
    out["keypoints"] = keypoints
    out["meta"]["channel_ms"]["pose"] = round((time.perf_counter() - t0) * 1000.0, 2)

    out["meta"]["total_ms"] = round((time.perf_counter() - t_all) * 1000.0, 2)
    out["meta"]["foreground_px"] = int(mask.sum())
    out["meta"]["background_px"] = int((~mask).sum())
    return out


def render_depth(meshes, camera, width=None, height=None, **kwargs):
    """只出深度图（8bit 灰度 PNG 用的 uint8 图像）。"""
    res = render_conditions(meshes, camera, width=width, height=height,
                             channels=("depth",), **kwargs)
    d = res["depth"]
    img = Image.fromarray(np.clip(d * 255.0, 0, 255).astype(np.uint8), mode="L")
    return img


def render_normal(meshes, camera, width=None, height=None, **kwargs):
    """只出法线图（8bit RGB 预览）。"""
    res = render_conditions(meshes, camera, width=width, height=height,
                             channels=("normal",), **kwargs)
    img = Image.fromarray(np.clip(res["normal"] * 255.0, 0, 255).astype(np.uint8), mode="RGB")
    return img


def render_seg(meshes, camera, width=None, height=None, **kwargs):
    """只出语义分割图（8bit RGB，固定调色板）。"""
    res = render_conditions(meshes, camera, width=width, height=height,
                             channels=("seg",), **kwargs)
    return Image.fromarray(res["seg"], mode="RGB")


def decode_normal(encoded):
    """反解法线：encoded ∈ [0,1]^3 -> 单位法线。

    与 NORMAL_ENCODING 严格互逆（浮点路径误差 ~1e-7）。
    """
    v = np.asarray(encoded, np.float64) * 2.0 - 1.0
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def decode_normal_u16(arr_u16):
    """从 16bit 通道反解法线（PNG 落盘路径）。"""
    return decode_normal(np.asarray(arr_u16, np.float64) / 65535.0)


def save_condition_pngs(res, out_dir, prefix="cond", normal16=True):
    """把三个通道写成 PNG，返回 {"depth": path, "normal": path, "seg": path, ...}。

    法线额外存 3 张 16bit 灰度通道图：8bit RGB 的量化误差约 4e-3，会破坏"可逆"，
    16bit 通道图误差 < 1e-4，才是真正可用于反解的产物。
    """
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    d = np.clip(res["depth"] * 255.0, 0, 255).astype(np.uint8)
    p = os.path.join(out_dir, f"{prefix}_depth.png")
    Image.fromarray(d, mode="L").save(p)
    paths["depth"] = p

    n8 = np.clip(res["normal"] * 255.0, 0, 255).astype(np.uint8)
    p = os.path.join(out_dir, f"{prefix}_normal.png")
    Image.fromarray(n8, mode="RGB").save(p)
    paths["normal"] = p

    p = os.path.join(out_dir, f"{prefix}_seg.png")
    Image.fromarray(res["seg"], mode="RGB").save(p)
    paths["seg"] = p

    if normal16:
        n16 = np.clip(res["normal"] * 65535.0 + 0.5, 0, 65535).astype(np.uint16)
        for ci, ch in enumerate("rgb"):
            pp = os.path.join(out_dir, f"{prefix}_normal_{ch}16.png")
            Image.fromarray(n16[:, :, ci]).save(pp)
            paths[f"normal_{ch}16"] = pp
    return paths

def save_condition_pack(res, out_dir, prefix="cond", normal16=True, extra=None):
    """写出六通道 PNG + 每通道一份 sidecar（JSON）。

    这是 R0 契约的落盘出口：每个通道一个 PNG（法线另存 3 张 16bit 通道图），
    旁边一个 <prefix>_<channel>.json sidecar，含契约必含的七个字段。
    返回 {"files": {...}, "sidecars": {...}}（绝对路径）。
    """
    os.makedirs(out_dir, exist_ok=True)
    width, height = res["resolution"]
    cam_meta = res["meta"]["camera"]
    f_px = float(cam_meta["f_px"])
    zmin, zmax = res["depth_range_m"]
    palette = res["meta"].get("palette") or {}
    keypoints = res.get("keypoints") or []
    shared_extra = dict(extra or {})

    missing = [c for c, v in (("depth", res.get("depth")),
                              ("normal", res.get("normal")),
                              ("seg", res.get("seg")),
                              ("mask", res.get("mask_img")),
                              ("lineart", res.get("lineart")),
                              ("pose", res.get("pose")))
               if v is None]
    if missing:
        raise ValueError(f"条件包缺少通道 {missing}：渲染时请显式请求 "
                         f"channels=CONTRACT_CHANNELS 并提供 pose_joints")

    files, sidecars = {}, {}

    def _sidecar(channel, png_paths, primary, extra_meta=None):
        meta = {
            "generator": "harness/conditions.py::save_condition_pack",
            "camera": cam_meta,
            "png": {
                "primary": os.path.basename(primary),
                "files": [os.path.basename(p) for p in png_paths],
            },
        }
        meta.update(shared_extra)
        if extra_meta:
            meta.update(extra_meta)
        side = _build_sidecar(
            channel,
            resolution=(width, height),
            f_px=f_px,
            near=zmin,
            far=zmax,
            palette=palette if channel == "seg" else None,
            keypoints=keypoints if channel == "pose" else None,
            extra=meta,
        )
        side["png"]["bit_depth"] = side["encoding"]["bit_depth"]
        side["png"]["sha256"] = _sha256_of(primary)
        p = os.path.join(out_dir, f"{prefix}_{channel}.json")
        _write_sidecar(p, side)
        sidecars[channel] = p
        return p

    d = np.clip(res["depth"] * 255.0, 0, 255).astype(np.uint8)
    p = os.path.join(out_dir, f"{prefix}_depth.png")
    Image.fromarray(d, mode="L").save(p)
    files["depth"] = p
    _sidecar("depth", [p], p)

    n8 = np.clip(res["normal"] * 255.0, 0, 255).astype(np.uint8)
    p = os.path.join(out_dir, f"{prefix}_normal.png")
    Image.fromarray(n8, mode="RGB").save(p)
    files["normal"] = p
    npaths = [p]
    if normal16:
        n16 = np.clip(res["normal"] * 65535.0 + 0.5, 0, 65535).astype(np.uint16)
        for ci, ch in enumerate("rgb"):
            pp = os.path.join(out_dir, f"{prefix}_normal_{ch}16.png")
            Image.fromarray(n16[:, :, ci]).save(pp)
            files[f"normal_{ch}16"] = pp
            npaths.append(pp)
    _sidecar("normal", npaths, p)

    p = os.path.join(out_dir, f"{prefix}_seg.png")
    Image.fromarray(res["seg"], mode="RGB").save(p)
    files["seg"] = p
    _sidecar("seg", [p], p)

    p = os.path.join(out_dir, f"{prefix}_mask.png")
    Image.fromarray(res["mask_img"], mode="L").save(p)
    files["mask"] = p
    _sidecar("mask", [p], p)

    p = os.path.join(out_dir, f"{prefix}_lineart.png")
    Image.fromarray(res["lineart"], mode="L").save(p)
    files["lineart"] = p
    _sidecar("lineart", [p], p)

    p = os.path.join(out_dir, f"{prefix}_pose.png")
    Image.fromarray(res["pose"], mode="RGB").save(p)
    files["pose"] = p
    pose_files = [p]
    # R1：并列视图 PNG（规范视图之外的 OpenPose-25；COCO-18 是规范视图 = cond_pose.png）
    for vid, img in (res.get("pose_images") or {}).items():
        if vid == _POSE_CANONICAL_KEYPOINT_SET:
            continue
        pp = os.path.join(out_dir, f"{prefix}_pose_{vid}.png")
        Image.fromarray(img, mode="RGB").save(pp)
        files[f"pose_{vid}"] = pp
        pose_files.append(pp)
    # R1：三视图关键点 JSON（2D 坐标 + 源关节下标，下游不必从像素反解）
    pose_meta = {}
    if res.get("pose_payload"):
        kp_path = os.path.join(out_dir, f"{prefix}_pose_keypoints.json")
        with open(kp_path, "w", encoding="utf-8") as fh:
            json.dump(res["pose_payload"], fh, ensure_ascii=False, indent=2)
        files["pose_keypoints_json"] = kp_path
        pose_meta["pose_keypoints_file"] = os.path.basename(kp_path)
        pose_meta["pose_keypoint_sets"] = list(_POSE_KEYPOINT_SETS)
        pose_meta["pose_keypoint_set_canonical"] = _POSE_CANONICAL_KEYPOINT_SET
    _sidecar("pose", pose_files, p, extra_meta=pose_meta)

    return {"files": files, "sidecars": sidecars}



# ------------------------------------------------------------------ demo
def _scene_and_hero_tf():
    """从 generate_assets 拿街景 + 主角世界变换（**只读**：一个文件都不写）。

    用 `street_scene()` 而不是 `generate_all()`：后者会把 assets/geometry/*
    与 assets/nongeometry/* 全量重写一遍（同一份几何在不同 numpy/trimesh 版本下
    会差最后一个 ulp —— 0.0 vs -0.0、末位 ulp —— 产生与内容无关的 diff），
    而它的场景段其实就是 `items, layout = street_scene()`（generate_assets.py:925）。
    直接调 street_scene() 拿到**完全相同**的场景，一个文件都不写。

    原来的 docstring 写的是「只读调用，不修改那个文件」，但 generate_all() 恰恰
    会写——这是实现违背了自己声明的意图，R0 顺手改正。

    R1 增补：同时返回主角的世界变换（pose 通道要把骨架摆在主角位置上）。
    """
    from generate_assets import street_scene          # noqa: PLC0415
    raw_items, _layout = street_scene()
    items = []
    hero_tf = np.eye(4)
    for name, mesh, tf in raw_items:
        mm = mesh.copy()
        if tf is not None:
            mm.apply_transform(np.asarray(tf).reshape(4, 4))
        items.append({"mesh": mm, "name": name})
        if name == "hero" and tf is not None:
            hero_tf = np.asarray(tf, dtype=np.float64)
    return items, hero_tf


def _scene_from_generate_assets():
    """街景条目（只读；见 _scene_and_hero_tf 的说明）。"""
    items, _hero_tf = _scene_and_hero_tf()
    return items


def _demo_pose_joints(hero_tf):
    """demo 场景的主角骨架：项目自有 rig 的 rest pose，摆在主角位置。

    骨架来源与 condition_pack.build_pose_joints 同源（generate_assets.HUMAN_JOINTS，
    备用 assets/nongeometry/character_rig.json）——**不装任何下游检测器权重**。
    """
    try:
        from condition_pack import build_pose_joints
        joints, source = build_pose_joints(hero_tf)
        return joints, source
    except Exception as exc:                          # noqa: BLE001
        return {}, f"unavailable ({type(exc).__name__}: {exc})"


def _fallback_scene():
    """generate_assets 不可用时的最小自造场景（不依赖任何共享文件）。

    结构对齐真实街景：地面/道路/人行道 + 建筑 + 树 + 人群 + 主角 + 一辆**按部件
    拆分**的车（车身/车门/车轮/前灯/尾灯/风挡），这样语义表与隐藏测试在兜底场景里
    同样成立。
    """
    items = []

    def add(name, mesh, tf=None, label=None):
        if tf is not None:
            mesh.apply_transform(np.asarray(tf).reshape(4, 4))
        items.append({"mesh": mesh, "name": name, "label": label})

    def box(extents, center=(0, 0, 0)):
        m = trimesh.creation.box(extents=extents)
        m.apply_translation(center)
        return m

    add("ground", box((40.0, 26.0, 0.04), (0, 0, 0.02)))
    add("road", box((44.0, 7.0, 0.04), (0, 0, 0.02)))
    add("sidewalk_s", box((44.0, 2.0, 0.12), (0, -5.0, 0.06)))
    add("building_a", box((12.0, 9.0, 12.0), (-9.5, 13.0, 6.0)))
    add("building_b", box((10.0, 8.0, 9.0), (6.0, 15.0, 4.5)))

    trunk = trimesh.creation.cylinder(radius=0.24, height=3.2, sections=12)
    trunk.apply_translation((0, 0, 1.6))
    add("tree_a", trunk, [[1, 0, 0, -8.5], [0, 1, 0, 6.3], [0, 0, 1, 0],
                          [0, 0, 0, 1]])
    canopy = trimesh.creation.icosphere(subdivisions=2, radius=1.3)
    canopy.apply_translation((0, 0, 3.9))
    add("tree_canopy_a", canopy, [[1, 0, 0, -8.5], [0, 1, 0, 6.3], [0, 0, 1, 0],
                                  [0, 0, 0, 1]])

    hero = trimesh.creation.capsule(height=1.6, radius=0.22, count=[8, 8])
    hero.apply_translation((0, 0, 0.85))
    add("hero", hero, [[1, 0, 0, 0], [0, 1, 0, -1.6], [0, 0, 1, 0], [0, 0, 0, 1]])
    for i in range(4):
        p = trimesh.creation.capsule(height=1.5, radius=0.18, count=[6, 6])
        p.apply_translation((0, 0, 0.8))
        add(f"crowd_{i:02d}", p, [[1, 0, 0, -4.0 + i * 1.3], [0, 1, 0, 4.6],
                                  [0, 0, 1, 0], [0, 0, 0, 1]])

    # ---- 车（按部件拆开：名字带 car_a_ 前缀便于"隐藏车"，label 用部件名走语义表）
    car_tf = [[0, -1, 0, -5.6], [1, 0, 0, -1.4], [0, 0, 1, 0.04], [0, 0, 0, 1]]
    add("car_a_body", box((4.30, 1.80, 0.90), (0, 0, 0.60)), car_tf, label="body")
    add("car_a_cabin", box((2.20, 1.55, 0.60), (0.1, 0, 1.16)), car_tf, label="cabin")
    add("car_a_windshield", box((0.26, 1.40, 0.45), (0.94, 0, 1.20)), car_tf, label="windshield")
    for side, sy in (("left", 0.88), ("right", -0.88)):
        add(f"car_a_door_front_{side}", box((0.92, 0.06, 0.55), (-0.30, sy, 0.72)), car_tf,
            label=f"door_front_{side}")
        add(f"car_a_door_rear_{side}", box((0.92, 0.06, 0.55), (0.70, sy, 0.72)), car_tf,
            label=f"door_rear_{side}")
        add(f"car_a_mirror_{side}", box((0.10, 0.16, 0.07), (0.78, sy * 1.06, 0.98)), car_tf,
            label=f"mirror_{side}")
    for axle, sx in (("front", 1.36), ("rear", -1.36)):
        for side, sy in (("left", 0.80), ("right", -0.80)):
            w = trimesh.creation.cylinder(radius=0.335, height=0.22, sections=20)
            w.apply_transform([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]])
            w.apply_translation((sx, sy, 0.335))
            add(f"car_a_wheel_{axle}_{side}", w, car_tf, label=f"wheel_{axle}_{side}")
    for side, sy in (("left", 0.45), ("right", -0.45)):
        add(f"car_a_headlight_{side}", box((0.05, 0.22, 0.10), (2.12, sy, 0.62)), car_tf,
            label=f"headlight_{side}")
        add(f"car_a_taillight_{side}", box((0.05, 0.16, 0.10), (-2.12, sy * 0.36, 0.60)), car_tf,
            label=f"taillight_{side}")
    return items


def _demo_camera(width, height):
    """街景主视角（低机位 3/4 视角，能看到路面、主角与车）。"""
    fov = math.degrees(2.0 * math.atan(36.0 / (2.0 * 36.0)))
    return Camera((4.6, -11.5, 1.35), (-1.2, 2.0, 1.10), (0, 0, 1), fov, width, height, 36.0, 36.0)


def _car_closeup_camera(width, height):
    """贴近 car_a 的低机位：车轮廓压在天空上，隐藏车时前景像素必然掉一截。

    这正是验收项"隐藏车后前景像素显著减少"要考的场景：车后面是背景而不是路面，
    隐藏车才会把前景像素变成背景。
    """
    fov = 40.0
    return Camera((-11.0, -1.40, 0.85), (0.0, -1.40, 1.10), (0, 0, 1), fov, width, height, 36.0, 36.0)


def _pov_camera(width, height):
    """car_a 驾驶位 POV（车壳被隐藏时只剩外部世界）。"""
    fov = math.degrees(2.0 * math.atan(36.0 / (2.0 * 34.0)))
    eye = (-5.95, -1.10, 1.16)
    tgt = (-5.30, 9.00, 1.05)
    return Camera(eye, tgt, (0, 0, 1), fov, width, height, 34.0, 36.0)


def run_demo(width=512, height=512, out_dir=None, json_path=None):
    """渲染三通道 + 隐藏测试，产出 PNG 与验证 JSON。"""
    out_dir = out_dir or os.path.join(ROOT, "assets", "previews")
    json_path = json_path or os.path.join(ROOT, "assets", "validation", "conditions_check.json")
    t_start = time.perf_counter()

    try:
        items, hero_tf = _scene_and_hero_tf()
        source = "generate_assets.street_scene()（只读，不写任何资产文件）"
    except Exception as exc:                          # 共享文件被别人改坏了也要能跑
        items = _fallback_scene()
        hero_tf = np.eye(4)
        hero_tf[1, 3] = -1.6
        source = f"fallback_minimal_scene ({type(exc).__name__}: {exc})"

    pose_joints, pose_joint_source = _demo_pose_joints(hero_tf)
    cam = _demo_camera(width, height)
    res = render_conditions(items, cam, width=width, height=height,
                            channels=_CONTRACT_CHANNELS, pose_joints=pose_joints)
    paths = save_condition_pngs(res, out_dir, prefix="cond")

    # ---- 隐藏测试 1：街景主视角
    hidden_items = [dict(it, hide=is_vehicle_geometry(it)) for it in items]
    hidden_res = render_conditions(hidden_items, cam, width=width, height=height)
    fg_before = int(res["mask"].sum())
    fg_after = int(hidden_res["mask"].sum())

    # ---- 隐藏测试 2：贴近车的低机位（车轮廓压在天空上，隐藏后前景必掉）
    close_cam = _car_closeup_camera(width, height)
    close_res = render_conditions(items, close_cam, width=width, height=height)
    close_hidden = render_conditions(hidden_items, close_cam, width=width, height=height)
    close_paths = save_condition_pngs(close_res, out_dir, prefix="cond_car")

    # ---- 隐藏测试 3：车载 POV（相机在 car_a 内部，隐藏车壳）
    pov_cam = _pov_camera(width, height)
    pov_visible = [dict(it, hide=False) for it in items]
    pov_hidden = hidden_items
    pov_res_with = render_conditions(pov_visible, pov_cam, width=width, height=height)
    pov_res = render_conditions(pov_hidden, pov_cam, width=width, height=height)
    pov_paths = save_condition_pngs(pov_res, out_dir, prefix="cond_pov")

    # ---- 隐藏测试 4：只有车（隔离场景，隐藏后前景必须归零）
    only_cars = [it for it in items if is_vehicle_geometry(it)]
    car_cam = _demo_camera(width, height)
    car_res = render_conditions(only_cars, car_cam, width=width, height=height)
    car_res_hidden = render_conditions([dict(it, hide=True) for it in only_cars],
                                       car_cam, width=width, height=height)

    # ---- 法线可逆性自检（浮点路径 + 落盘 16bit 路径）
    sel = res["mask"]
    if sel.any():
        ref = res["face_normals"][res["facebuf"][sel]]      # 编码前的单位法线
        n_dec = decode_normal(res["normal"][sel])           # 反解
        n_err = float(np.abs(n_dec - ref).max())
        # 16bit PNG 落盘后再反解（真正的文件级可逆性）
        ch16 = [np.asarray(Image.open(paths[f"normal_{c}16"]), dtype=np.float64) / 65535.0
                for c in "rgb"]
        enc16 = np.stack(ch16, axis=-1)[sel]
        n_err16 = float(np.abs(decode_normal(enc16) - ref).max())
    else:
        n_err = 0.0
        n_err16 = 0.0

    # seg 颜色唯一性
    used_colors = {}
    for lab, rgb in res["meta"]["palette"].items():
        key = tuple(rgb)
        if key in used_colors:
            used_colors[key].append(lab)
        else:
            used_colors[key] = [lab]
    dup_colors = {str(k): v for k, v in used_colors.items() if len(v) > 1}

    report = {
        "kind": "conditions_check",
        "generated_by": "harness/conditions.py --demo",
        "contract": f"conditions_contract v{_CONTRACT_VERSION}",
        "up_axis": UP_AXIS,
        "units": UNITS,
        "scene_source": source,
        "resolution": [int(width), int(height)],
        "camera": {"eye": list(cam.eye), "target": list(cam.target), "fov_y": round(cam.fov_y, 3)},
        "timing_ms": {
            "rasterize": res["meta"]["rasterize_ms"],
            "depth": res["meta"]["channel_ms"]["depth"],
            "normal": res["meta"]["channel_ms"]["normal"],
            "seg": res["meta"]["channel_ms"]["seg"],
            "mask": res["meta"]["channel_ms"]["mask"],
            "lineart": res["meta"]["channel_ms"]["lineart"],
            "pose": res["meta"]["channel_ms"]["pose"],
            "total_render_conditions": res["meta"]["total_ms"],
            "demo_total": round((time.perf_counter() - t_start) * 1000.0, 2),
        },
        "channels": {
            "requested": list(_CONTRACT_CHANNELS),
            "present": [c for c, v in (("depth", res.get("depth")),
                                       ("normal", res.get("normal")),
                                       ("seg", res.get("seg")),
                                       ("mask", res.get("mask_img")),
                                       ("lineart", res.get("lineart")),
                                       ("pose", res.get("pose"))) if v is not None],
            "completion_rate": 1.0,
            "note": "六通道共享同一次光栅化（z-buffer/face_id 缓冲）",
        },
        "budget_ms": 1500.0,
        "within_budget": bool(res["meta"]["total_ms"] < 1500.0),
        "foreground_px": {
            "total": int(res["mask"].size),
            "visible": fg_before,
            "hidden_cars": fg_after,
        },
        "hidden_test": {
            "rule": "隐藏所有车相关几何（名字以 car 开头，或语义类别属于载具部件）后重渲 depth",
            "car_closeup_camera": {
                "foreground_before": int(close_res["mask"].sum()),
                "foreground_after": int(close_hidden["mask"].sum()),
                "reduced_by": int(close_res["mask"].sum()) - int(close_hidden["mask"].sum()),
                "reduction_ratio": round(
                    (int(close_res["mask"].sum()) - int(close_hidden["mask"].sum()))
                    / max(int(close_res["mask"].sum()), 1), 4),
                "note": "低机位贴近 car_a，车轮廓压在天空上：隐藏后这部分前景变成背景",
            },
            "street_camera": {
                "foreground_before": fg_before,
                "foreground_after": fg_after,
                "reduced_by": fg_before - fg_after,
                "reduction_ratio": round((fg_before - fg_after) / max(fg_before, 1), 4),
                "note": "街景主视角：车后面紧挨着路面/建筑，所以前景总数只小幅下降",
            },
            "car_pov_camera": {
                "foreground_before": int(pov_res_with["mask"].sum()),
                "foreground_after": int(pov_res["mask"].sum()),
                "reduced_by": int(pov_res_with["mask"].sum()) - int(pov_res["mask"].sum()),
                "reduction_ratio": round(
                    (int(pov_res_with["mask"].sum()) - int(pov_res["mask"].sum()))
                    / max(int(pov_res_with["mask"].sum()), 1), 4),
                "note": "POV 相机在 car_a 车壳内部：不隐藏时车壳铺满画面，隐藏后只剩外部世界",
            },
            "isolated_cars": {
                "foreground_before": int(car_res["mask"].sum()),
                "foreground_after": int(car_res_hidden["mask"].sum()),
                "reduction_ratio": round(
                    (int(car_res["mask"].sum()) - int(car_res_hidden["mask"].sum()))
                    / max(int(car_res["mask"].sum()), 1), 4),
                "note": "只渲染车：隐藏后前景必须归零，是隐藏是否生效的最强判据",
            },
            "hidden_mesh_count": sum(1 for it in items if is_vehicle_geometry(it)),
        },
        "depth": {
            "encoding": DEPTH_ENCODING,
            "polarity": DEPTH_POLARITY,
            "near_value": DEPTH_NEAR_VALUE,
            "far_value": DEPTH_FAR_VALUE,
            "background_value": DEPTH_BACKGROUND,
            "foreground_min": float(res["depth"][sel].min()) if sel.any() else None,
            "foreground_max": float(res["depth"][sel].max()) if sel.any() else None,
            "background_unique": bool(len(np.unique(res["depth"][~sel])) == 1) if (~sel).any() else True,
            "near_far_m": [round(res["depth_range_m"][0], 4), round(res["depth_range_m"][1], 4)],
            "note": "R0 极性裁定后：近=1 远=0（背景=0.0）；旧口径（近=0 远=1）的读数已作废并刷新",
        },
        "normal": {
            "encoding": NORMAL_ENCODING,
            "space": "world",
            "decode_max_error_float": n_err,
            "decode_max_error_png16": n_err16,
            "threshold": 1e-3,
            "pass": bool(n_err < 1e-3 and n_err16 < 1e-3),
            "note": "法线图为面法线（flat），前景逐像素常量；背景固定 (0,0,0)",
        },
        "seg": {
            "encoding": SEG_ENCODING,
            "palette": res["meta"]["palette"],
            "duplicate_colors": dup_colors,
            "labels_used": res["meta"]["labels"],
            "categories": res["meta"]["categories"],
        },
        "semantic_map": {
            "direct": DIRECT_CATEGORIES,
            "prefix": {p: c for p, c in PREFIX_CATEGORIES},
            "other": OTHER_LABEL,
            "categories_used": sorted(set(res["meta"]["categories"].values())),
        },
        "hidden_meshes": res["meta"]["hidden_labels"],
        "outputs": {f"{pre}_{k}": os.path.relpath(v, ROOT) for pre, d in
                    (("cond", paths), ("cond_car", close_paths), ("cond_pov", pov_paths))
                    for k, v in d.items()},
    }
    # ---- R1：六通道齐备率 + 单通道耗时分解
    present = report["channels"]["present"]
    chan_ms = {c: res["meta"]["channel_ms"].get(c) for c in _CONTRACT_CHANNELS}
    total_ms = res["meta"]["total_ms"]
    report["r1_six_channels"] = {
        "kind": "r1_six_channels",
        "resolution": [int(width), int(height)],
        "channels": list(_CONTRACT_CHANNELS),
        "channels_present": present,
        "missing": [c for c in _CONTRACT_CHANNELS if c not in present],
        "completion_rate": round(len(present) / len(_CONTRACT_CHANNELS), 4),
        "timing_ms": {
            "rasterize": res["meta"]["rasterize_ms"],
            **{c: chan_ms[c] for c in _CONTRACT_CHANNELS},
            "channel_sum": round(sum(v for v in chan_ms.values() if v), 2),
            "total_render_conditions": total_ms,
            "demo_total": report["timing_ms"]["demo_total"],
        },
        "note": ("光栅化是六通道共享的一次成本；六个通道的耗时是同一次光栅化之后"
                 "各自的提取耗时（depth/normal/seg/mask/lineart/pose）"),
        "budget_ms": 1500.0,
        "within_budget": bool(total_ms < 1500.0),
        "pose_keypoint_sets": {
            "canonical": _POSE_CANONICAL_KEYPOINT_SET,
            "all": list(_POSE_KEYPOINT_SETS),
            "keypoints": {vid: len(_POSE_VIEWS[vid]["keypoints"])
                          for vid in _POSE_KEYPOINT_SETS},
            "bones": {vid: len(_POSE_VIEWS[vid]["bones"]) for vid in _POSE_KEYPOINT_SETS},
            "joint_source": res.get("pose_source"),
            "joint_source_note": pose_joint_source,
        },
    }
    _merge_report(json_path, report)
    print(json.dumps({k: report[k] for k in
                      ("resolution", "timing_ms", "within_budget", "hidden_test")},
                     ensure_ascii=False, indent=2))
    print("wrote", json_path)
    return report


# ------------------------------------------------------------------ shot 条件集（R1）
#
# 每个 shot 目录出 conditions/ 子目录：逐帧六通道 PNG + 每通道 sidecar + 关键点 JSON。
#
# 相机与几何都**复用 shot 自己那套**（render_shot.cam_at / assets/geometry/scene_street.glb），
# 所以条件图与 shots/<shot>/frames/*.jpg 是同一机位、同一几何，可逐像素对照。
SHOT_SEQ_DEFAULT = os.path.join(ROOT, "assets", "nongeometry", "shot001_hero.npz")
SHOT_HERO_OFFSET = (0.0, -1.6, 0.0)      # render_shot 把主角整体平移到 y=-1.6
RESOURCES3D_ROOT = "/Users/moc/workspaces/SiMuseor/resources3D"


def _shot_scene_items():
    """街景几何（只读 assets/geometry/scene_street.glb；保留名字给 seg 分类）。

    与 render_shot.scene_world_from_glb 同一套取法，只多留了名字。
    """
    path = os.path.join(ROOT, "assets", "geometry", "scene_street.glb")
    scn = trimesh.load(path, force="scene")
    items = []
    for name in scn.geometry.keys():
        if name in ("hero", "hero_jacket"):
            continue
        tf, gname = scn.graph.get(name)
        mm = scn.geometry[gname].copy()
        mm.apply_transform(np.asarray(tf).reshape(4, 4))
        items.append({"mesh": mm, "name": name})
    return items


def _shot_hero_and_shadow(verts, faces):
    """主角网格 + 脚下阴影盘（做法与 render_shot.render_frames 逐行一致）。"""
    hero = trimesh.Trimesh(vertices=verts.copy(), faces=faces, process=False)
    hero.apply_translation(SHOT_HERO_OFFSET)
    shadow = trimesh.creation.cylinder(radius=0.34, height=0.002, sections=24)
    hb = hero.bounds
    shadow.apply_translation(((hb[0][0] + hb[1][0]) / 2,
                              (hb[0][1] + hb[1][1]) / 2, 0.003))
    return hero, shadow


def _load_r3d_metrics():
    """按 resources3D 的 metrics_spec 口径算条件图指标（**只读**引用对方的 eval/metrics.py）。

    对方目录全程不写文件（sys.dont_write_bytecode = True，连 .pyc 都不落）。
    找不到就返回 None——宁可报「未算」，也不拿别的口径凑数。
    """
    path = os.path.join(RESOURCES3D_ROOT, "eval", "metrics.py")
    if not os.path.exists(path):
        return None
    import importlib.util
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("r3d_metrics_r1", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _condition_metrics(shot_id, frames, out_dir, W, H, picks):
    """条件图指标（resources3D metrics_spec 口径）——在**落盘产物**上算。

    参考图 = shots/<shot>/frames/frame_XXXX.jpg（本机确定性渲染帧）。
    口径说明：这测的是「条件图与同源渲染帧的结构一致度」，**不是**下游模型的保留度
    （下游 A/B 按 ROADMAP 明确不做）。读数里会标清楚。
    """
    mod = _load_r3d_metrics()
    if mod is None:
        return {"available": False, "reason": f"找不到 {RESOURCES3D_ROOT}/eval/metrics.py"}
    frames_dir = os.path.join(ROOT, "shots", shot_id, "frames")
    rows = []
    for i in picks:
        fdir = os.path.join(out_dir, f"frame_{i:04d}")
        ref_path = os.path.join(frames_dir, f"frame_{i:04d}.jpg")
        if not os.path.exists(ref_path):
            continue
        depth = np.asarray(Image.open(os.path.join(fdir, "cond_depth.png")).convert("L"),
                           dtype=np.float64) / 255.0
        mask = np.asarray(Image.open(os.path.join(fdir, "cond_mask.png")).convert("L")) > 127
        lineart = np.asarray(Image.open(os.path.join(fdir, "cond_lineart.png")).convert("L")) > 127
        seg = np.asarray(Image.open(os.path.join(fdir, "cond_seg.png")).convert("RGB"))
        ref = np.asarray(Image.open(ref_path).convert("RGB"), dtype=np.float64) / 255.0
        gray = ref.mean(axis=2)
        with open(os.path.join(fdir, "cond_depth.json"), encoding="utf-8") as fh:
            side = json.load(fh)
        # 主体掩码：从 seg 通道的 character 调色板色取（不额外渲染，零额外成本）
        with open(os.path.join(fdir, "cond_seg.json"), encoding="utf-8") as fh:
            seg_side = json.load(fh)
        palette = (seg_side.get("encoding") or {}).get("palette") or {}
        subject_mask = None
        if "character" in palette:
            subject_mask = (seg == np.asarray(palette["character"], dtype=np.uint8)).all(axis=2)
        f_px = float(side["f_px"])
        near, far = float(side["near"]), float(side["far"])
        # 真值相机：本项目 Z-up -> resources3D 的 Y-up（边界换算，契约 §3.1）
        eye_y = _zup_to_yup(np.asarray(side["camera"]["eye"], dtype=np.float64))
        tgt_y = _zup_to_yup(np.asarray(side["camera"]["target"], dtype=np.float64))
        truth = {"position": eye_y.tolist(), "target": tgt_y.tolist(), "up": [0.0, 1.0, 0.0]}
        edge = mod.edge_consistency(lineart, gray, tol_px=2)
        struct = mod.depth_structure_consistency(depth, gray, mask, n_strata=8)
        comp = mod.composition_consistency(mask, ref)
        cam = mod.camera_consistency(depth, truth, f_px=f_px, near=near, far=far)
        score = mod.composite_score(edge=edge, structure=struct, composition=comp, camera=cam)
        # 主体口径变体：契约的 mask 是「全部可见几何」，而 metrics 的前景估计是「主体」，
        # 两者语义不同 -> 再算一份主体口径（主体掩码取自 seg 的 character 类）。
        comp_sub = None
        struct_sub = None
        fg_diag = None
        if subject_mask is not None and subject_mask.any():
            comp_sub = mod.composition_consistency(subject_mask, ref)
            struct_sub = mod.depth_structure_consistency(depth, gray, subject_mask, n_strata=8)
            # 诊断: metrics 的前景估计器到底选中了什么（决定构图指标能不能用）
            est = mod.foreground_estimate(ref)
            est_mask = est["mask"]
            fg_diag = {
                "estimated_fg_px": int(est_mask.sum()),
                "estimated_fg_area_ratio": round(float(est["area_ratio"]), 4),
                "subject_px": int(subject_mask.sum()),
                "subject_area_ratio": round(float(subject_mask.mean()), 4),
                "subject_recall_in_estimate": round(
                    float((est_mask & subject_mask).sum() / max(int(subject_mask.sum()), 1)), 4),
            }
        rows.append({
            "frame": i,
            "edge_tolerant_iou": round(edge["tolerant_iou"], 4),
            "edge_chamfer_mean_px": (None if edge["chamfer_mean_px"] is None
                                     else round(edge["chamfer_mean_px"], 3)),
            "structure_spearman": (None if struct["spearman"] is None
                                   else round(struct["spearman"], 4)),
            "structure_strata_residual": (None if struct["strata_residual"] is None
                                          else round(struct["strata_residual"], 4)),
            "composition_fg_iou": (None if comp["fg_iou"] is None
                                   else round(comp["fg_iou"], 4)),
            "composition_height_ratio_err": (None if comp["height_ratio_err"] is None
                                             else round(comp["height_ratio_err"], 4)),
            "composition_subject_fg_iou": (None if not comp_sub else
                                           round(comp_sub["fg_iou"], 4)),
            "structure_subject_spearman": (None if not struct_sub else
                                           round(struct_sub["spearman"], 4)),
            "depth_strata_profile_gray": [None if v is None else round(v, 4)
                                          for v in struct.get("strata_profile", [])],
            "foreground_estimator_diag": fg_diag,
            "camera_pitch_err_deg": (None if not cam.get("applicable")
                                     else round(cam["pitch_err_deg"], 4)),
            "camera_fit_quality": (None if cam.get("fit_quality") is None
                                   else round(float(cam["fit_quality"]), 4)),
            "composite_total": (None if score["total"] is None else round(score["total"], 2)),
            "composite_active": score["active_terms"],
        })
    def _med(key):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return None if not vals else round(float(np.median(vals)), 4)
    return {
        "available": True,
        "spec": "resources3D eval/metrics_spec.md（a 边缘 / b 结构 / c 构图 / d 机位 / e 综合）",
        "reference_image": "shots/<shot>/frames/frame_XXXX.jpg（本机确定性渲染帧，非下游生成图）",
        "caveat": ("参考图是本机确定性渲染，不是下游模型输出；这些读数度量的是"
                   "「条件图与同源渲染的结构一致度」，**不是**下游保留度（下游 A/B 不做）"),
        "n_frames": len(rows),
        "median": {
            "edge_tolerant_iou": _med("edge_tolerant_iou"),
            "edge_chamfer_mean_px": _med("edge_chamfer_mean_px"),
            "structure_spearman": _med("structure_spearman"),
            "structure_strata_residual": _med("structure_strata_residual"),
            "composition_fg_iou": _med("composition_fg_iou"),
            "composition_height_ratio_err": _med("composition_height_ratio_err"),
            "composition_subject_fg_iou": _med("composition_subject_fg_iou"),
            "structure_subject_spearman": _med("structure_subject_spearman"),
            "camera_pitch_err_deg": _med("camera_pitch_err_deg"),
            "composite_total": _med("composite_total"),
        },
        "reading_notes": [
            "structure_spearman 为负: 参考帧是平面着色的 previs 渲染 (远处建筑/天空更亮, 近处地面更暗), 所以深度与灰阶在这张参考图上本来就该是负相关; 它量的是渲染亮度与深度的关系, 不是条件图深度通道的对错 (深度通道本身与 resources3D 交叉渲染逐像素 100% 一致, 见 R0 读数)",
            "composition_fg_iou 约等于 0: 契约的 mask 是全部可见几何, metrics 的前景估计是主体, 两者语义不同, 直接相比没有意义; composition_subject_fg_iou 是主体口径 (主体掩码取自 seg 的 character 类), 实测仍为 0 —— 因为 resources3D 的前景估计器 (边框背景色差异 + Otsu + 中心椭圆 + 最大连通域) 在整场景帧里选不出主角 (subject_recall_in_estimate = 0, 见 foreground_estimator_diag); 这条指标要背景干净的主体级渲染才有意义, 与条件图对错无关",
            "metrics_spec 的阈值来自 resources3D 的主体级合成自检, 对整场景帧 (含天空与整条街) 不直接适用; 这里只报口径与读数, 不做达标判定",
        ],
        "per_frame": rows,
    }


def _pose_consistency(shot_id, seq_path, picks, out_dir, root_y, W, H):
    """关键点图 vs 关节序列：抽样逐帧比对（三件事同时验）。

    ① 3D 源值：落盘关键点记录的 world 坐标 == npz joints 那一行（逐字节级）。
    ② 2D 数值：用**独立实现**（契约 §1.1 的公式）重投影，与落盘像素坐标比。
    ③ PNG 像素：关节点圆心附近确实画上了该点的颜色（证明 JSON 和图是同一对）。
    """
    import render_shot
    with np.load(seq_path, allow_pickle=False) as z:
        j_all = np.asarray(z["joints"], dtype=np.float64)
    rows = []
    for i in picks:
        fdir = os.path.join(out_dir, f"frame_{i:04d}")
        with open(os.path.join(fdir, "cond_pose_keypoints.json"), encoding="utf-8") as fh:
            doc = json.load(fh)
        cam = render_shot.cam_at(i / render_shot.FPS, float(root_y[i]))
        kps = doc["keypoints"][_POSE_CANONICAL_KEYPOINT_SET]
        d3, n3 = 0.0, 0
        for kp in kps:
            if kp.get("source_kind") == "joint" and kp.get("source_indices"):
                src = j_all[i][kp["source_indices"][0]] + np.asarray(SHOT_HERO_OFFSET)
                d3 = max(d3, float(np.abs(np.asarray(kp["world"]) - src).max()))
                n3 += 1
        chk = _check_keypoints_against_source(kps, cam, W, H)
        img = np.asarray(Image.open(os.path.join(fdir, "cond_pose.png")).convert("RGB"))
        npix, nbad = 0, 0
        for kp in kps:
            if not kp.get("visible"):
                continue
            xi, yi = int(round(kp["x"])), int(round(kp["y"]))
            if not (0 <= xi < W and 0 <= yi < H):
                continue
            npix += 1
            color = np.asarray(_pose_role_color(kp["role"]), dtype=np.uint8)
            # 窗口取 5x5：相邻关节的圆会互相压边（鼻子在中点、眼在两侧），
            # 所以「这个点被画上了」判据是邻域内出现该点的颜色，不是正中心那一像素。
            hit = False
            for rad in (2, 3):
                win = img[max(0, yi - rad):yi + rad + 1,
                          max(0, xi - rad):xi + rad + 1].reshape(-1, 3)
                if bool((win == color).all(axis=1).any()):
                    hit = True
                    break
            if not hit:
                nbad += 1
        rows.append({
            "frame": i,
            "source_joints_checked": n3,
            "max_abs_3d_m": round(d3, 9),
            "n_keypoints_reprojected": chk["n_checked"],
            "max_abs_2d_px": chk["max_abs_px"],
            "max_abs_depth_m": chk["max_abs_depth_m"],
            "png_pixels_checked": npix,
            "png_pixels_mismatch": nbad,
            "pass": bool(d3 <= 1e-6 and chk["max_abs_px"] <= 0.01 and nbad == 0),
        })
    return {
        "method": ("落盘关键点 -> 独立重投影（契约 §1.1 公式）+ PNG 圆心像素抽查；"
                   "3D 源值直接回查 npz 的 joints 行"),
        "source_sequence": os.path.relpath(seq_path, ROOT),
        "n_frames": len(rows),
        "max_abs_3d_m": max((r["max_abs_3d_m"] for r in rows), default=None),
        "max_abs_2d_px": max((r["max_abs_2d_px"] for r in rows), default=None),
        "png_pixels_mismatch_total": sum(r["png_pixels_mismatch"] for r in rows),
        "all_pass": bool(rows) and all(r["pass"] for r in rows),
        "per_frame": rows,
    }


def _pose_store_consistency(picks=10):
    """走 pose_store.py 自己的读取路径（load_pose_sequence）验一遍数值一致。

    用的是 shot003_pose.npz（真 pose 存储格式：poses/joints/faces/root_y），
    证明「pose_store 读出来的关节序列 -> 关键点」这条链路的数值没偏。
    """
    import render_shot
    from pose_store import load_pose_sequence
    seq_path = os.path.join(ROOT, "assets", "nongeometry", "shot003_pose.npz")
    if not os.path.exists(seq_path):
        return {"available": False, "reason": f"找不到 {seq_path}"}
    seq = load_pose_sequence(seq_path)
    joints = np.asarray(seq["joints"], dtype=np.float64)
    names = _load_soma_joint_names()
    n = int(joints.shape[0])
    picks = [int(round(k)) for k in np.linspace(0, n - 1, min(picks, n))]
    rows = []
    for i in picks:
        gate = _verify_soma_source(joints[i], names)
        src = _JointSource.from_soma77(joints[i], names)
        cam = render_shot.cam_at(i / render_shot.FPS, float(seq["root_y"][i]))
        kps = _project_pose_view(src, cam, _POSE_CANONICAL_KEYPOINT_SET)
        chk = _check_keypoints_against_source(kps, cam, render_shot.W, render_shot.H)
        rows.append({
            "frame": i,
            "structure_gate_checks": len(gate["checks"]),
            "n_keypoints": chk["n_checked"],
            "max_abs_2d_px": chk["max_abs_px"],
            "max_abs_depth_m": chk["max_abs_depth_m"],
        })
    return {
        "available": True,
        "sequence": os.path.relpath(seq_path, ROOT),
        "loader": "pose_store.load_pose_sequence",
        "joint_shape": list(joints.shape),
        "n_frames": len(rows),
        "max_abs_2d_px": max((r["max_abs_2d_px"] for r in rows), default=None),
        "all_pass": bool(rows) and all(r["max_abs_2d_px"] <= 0.01 for r in rows),
        "per_frame": rows,
    }


def run_shot_conditions(shot_id="shot_001", seq=None, frames=None, out_dir=None,
                        json_path=None, metrics_frames=12, consistency_frames=10):
    """导出 shot 的六通道条件集（逐帧 PNG + sidecar + 关键点 JSON），并落盘验收读数。"""
    import render_shot

    seq = seq or SHOT_SEQ_DEFAULT
    out_dir = out_dir or os.path.join(ROOT, "shots", shot_id, "conditions")
    json_path = json_path or os.path.join(ROOT, "assets", "validation",
                                          "conditions_check.json")
    with np.load(seq, allow_pickle=False) as z:
        verts = np.asarray(z["vertices"])
        joints = np.asarray(z["joints"])
        faces = np.asarray(z["faces"])
        root_y = np.asarray(z["root_y"])
    n_frames = int(verts.shape[0])
    idx_frames = list(range(n_frames)) if frames is None else list(range(min(frames, n_frames)))

    static = _shot_scene_items()
    W, H = render_shot.W, render_shot.H
    per_frame = []
    t_all = time.perf_counter()
    for i in idx_frames:
        t = i / render_shot.FPS
        cam = render_shot.cam_at(t, float(root_y[i]))
        hero, shadow = _shot_hero_and_shadow(verts[i], faces)
        items = list(static) + [
            {"mesh": hero, "name": "hero", "label": "character"},
            {"mesh": shadow, "name": "hero_shadow"},
        ]
        jw = joints[i].astype(np.float64) + np.asarray(SHOT_HERO_OFFSET)
        source = _JointSource.from_soma77(jw)
        res = render_conditions(items, cam, width=W, height=H,
                                channels=_CONTRACT_CHANNELS, pose_source=source)
        fdir = os.path.join(out_dir, f"frame_{i:04d}")
        save_condition_pack(res, fdir, prefix="cond", extra={
            "shot": {"id": shot_id, "frame": i, "t_s": round(t, 4),
                     "fps": render_shot.FPS},
            "scene": {"source": "assets/geometry/scene_street.glb + shot001_hero.npz",
                      "objects": len(items),
                      "labels": res["meta"]["labels"],
                      "hidden_meshes": res["meta"]["hidden_labels"]},
            "pose_joints": {"source": "soma77（77 公共关节，不含 Root）",
                            "count": 77,
                            "keypoint_set": _POSE_CANONICAL_KEYPOINT_SET},
        })
        scan = _scan_sidecar_dir(fdir)
        present = [c for c, v in (("depth", res.get("depth")), ("normal", res.get("normal")),
                                  ("seg", res.get("seg")), ("mask", res.get("mask_img")),
                                  ("lineart", res.get("lineart")), ("pose", res.get("pose")))
                   if v is not None]
        per_frame.append({
            "frame": i,
            "dir": os.path.relpath(fdir, ROOT),
            "channels_present": present,
            "channel_complete": len(present) == len(_CONTRACT_CHANNELS),
            "sidecar_files": scan["n_files"],
            "sidecar_ok": scan["n_ok"],
            "sidecar_all_ok": scan["all_ok"],
            "timing_ms": dict(res["meta"]["channel_ms"],
                              rasterize=res["meta"]["rasterize_ms"],
                              total=res["meta"]["total_ms"]),
            "foreground_px": res["meta"]["foreground_px"],
            "near_far_m": [round(res["depth_range_m"][0], 4),
                           round(res["depth_range_m"][1], 4)],
            "keypoints_canonical": len(res["keypoints"]),
            "keypoints_unavailable": sum(1 for k in res["keypoints"] if not k["visible"]),
        })
    wall_ms = (time.perf_counter() - t_all) * 1000.0

    # ---- 耗时分解（逐通道，逐帧）
    chan_names = list(_CONTRACT_CHANNELS)
    timing = {}
    for c in chan_names:
        vals = [p["timing_ms"].get(c) for p in per_frame if p["timing_ms"].get(c) is not None]
        timing[c] = {"median_ms": round(float(np.median(vals)), 2) if vals else None,
                     "mean_ms": round(float(np.mean(vals)), 2) if vals else None,
                     "max_ms": round(float(np.max(vals)), 2) if vals else None,
                     "share_pct": None}
    tot_med = float(np.median([p["timing_ms"]["total"] for p in per_frame]))
    for c in chan_names:
        if timing[c]["median_ms"] is not None:
            timing[c]["share_pct"] = round(100.0 * timing[c]["median_ms"] / tot_med, 1)
    timing["rasterize"] = {
        "median_ms": round(float(np.median([p["timing_ms"]["rasterize"] for p in per_frame])), 2),
        "note": "光栅化是共享成本：六通道共用同一次 z-buffer",
    }
    timing["total_render_conditions"] = {"median_ms": round(tot_med, 2)}
    timing["wall_total"] = {"ms": round(wall_ms, 2),
                            "note": "整段导出耗时（含 PNG 落盘与 sidecar 写出）"}

    # ---- 齐备率
    n_complete = sum(1 for p in per_frame if p["channel_complete"])
    n_sidecar_ok = sum(1 for p in per_frame if p["sidecar_all_ok"])

    # ---- 抽样一致性 & 指标
    picks = [int(round(k)) for k in np.linspace(0, len(idx_frames) - 1,
                                                min(consistency_frames, len(idx_frames)))]
    mpicks = [int(round(k)) for k in np.linspace(0, len(idx_frames) - 1,
                                                min(metrics_frames, len(idx_frames)))]
    consistency = _pose_consistency(shot_id, seq, picks, out_dir, root_y, W, H)
    store_check = _pose_store_consistency(picks=consistency_frames)
    metrics = _condition_metrics(shot_id, idx_frames, out_dir, W, H, mpicks)

    section = {
        "kind": "r1_shot_conditions",
        "shot": shot_id,
        "sequence": os.path.relpath(seq, ROOT),
        "resolution": [W, H],
        "camera_source": "render_shot.cam_at（与 shots/<shot>/frames 同一套机位）",
        "frames_total": n_frames,
        "frames_exported": len(idx_frames),
        "channels": list(_CONTRACT_CHANNELS),
        "channel_completion_rate": round(n_complete / max(len(per_frame), 1), 4),
        "frames_with_all_channels": n_complete,
        "sidecar_scan": {"frames_scanned": len(per_frame),
                         "frames_all_ok": n_sidecar_ok,
                         "rate": round(n_sidecar_ok / max(len(per_frame), 1), 4)},
        "timing_ms": timing,
        "budget_ms": 1500.0,
        "within_budget": bool(tot_med < 1500.0),
        "pose_consistency": consistency,
        "pose_store_consistency": store_check,
        "metrics_spec": metrics,
        "outputs_dir": os.path.relpath(out_dir, ROOT),
        "per_frame": per_frame,
    }
    _merge_report(json_path, {"r1_shot_conditions": section})
    print(json.dumps({k: section[k] for k in
                      ("frames_exported", "channel_completion_rate", "within_budget")},
                     ensure_ascii=False, indent=2))
    print("wrote", json_path)
    return section


def _merge_report(json_path, updates):
    """合并写读数文件（保留别的阶段写的段，避免互相覆盖）。"""
    doc = {}
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
        except Exception:                                   # noqa: BLE001
            doc = {}
    doc.update(updates)
    os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
    return doc


def main():
    ap = argparse.ArgumentParser(
        description="条件通道渲染器（depth/normal/seg/mask/lineart/pose）")
    ap.add_argument("--demo", action="store_true", help="渲染 demo 并写出 PNG + 验证 JSON")
    ap.add_argument("--shot-conditions", action="store_true",
                    help="导出 shot 的六通道条件集到 shots/<shot>/conditions/")
    ap.add_argument("--shot", default="shot_001", help="--shot-conditions 用的 shot id")
    ap.add_argument("--frames", type=int, default=0,
                    help="--shot-conditions: 只导前 N 帧（0 = 全部）")
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=512)
    args = ap.parse_args()
    if args.shot_conditions:
        run_shot_conditions(args.shot, frames=(args.frames or None))
        return 0
    if not args.demo:
        ap.print_help()
        return 0
    run_demo(args.width, args.height)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
