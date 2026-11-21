"""条件通道渲染器自测（pytest 兼容；也可直接 ``python test_conditions.py`` 运行）。

覆盖验收项：
1. depth 前景归一化 ∈ [0,1]、背景取值统一
2. normal RGB 可逆（浮点路径 + 16bit PNG 落盘路径），误差 < 1e-3
3. seg 不同 label 颜色互不相同、同一 label 连通区域颜色一致
4. 隐藏 mesh（车）后前景像素显著减少
5. 512x512 三通道单帧渲染 < 1.5s（纯 CPU）
6. 语义约定：直接名 / 前缀 / 无 label -> other

测试用**自造最小场景**，不依赖 generate_assets.py（那个文件正被别的子代理改动），
只有性能项会尽量用真实街景。
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
from collections import deque

import numpy as np
import trimesh
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import conditions as C  # noqa: E402

RESULTS = {}


def _report(fn):
    """把测试返回的 info 收进 RESULTS，并让函数返回 None（pytest 不会警告）。"""
    def wrapper(*a, **kw):
        RESULTS[fn.__name__] = fn(*a, **kw)
        return None
    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    return wrapper


# ------------------------------------------------------------------ 工具
def _box(extents, center=(0, 0, 0)):
    m = trimesh.creation.box(extents=extents)
    m.apply_translation(center)
    return m


def _cam(eye=(6, -7, 3), target=(0, 0, 0.6), fov=40.0, w=256, h=256):
    return C.Camera(eye, target, (0, 0, 1), fov, w, h, 36.0, 36.0)


def _mini_scene():
    """自造最小场景：一辆车（按部件拆）+ 地面 + 建筑 + 树 + 人。"""
    items = [
        {"mesh": _box((40.0, 40.0, 0.04), (0, 0, 0.02)), "name": "ground"},
        {"mesh": _box((12.0, 9.0, 10.0), (-9.5, 13.0, 5.0)), "name": "building_a"},
        {"mesh": _box((0.5, 0.5, 4.0), (13.0, 6.3, 2.0)), "name": "tree_a"},
        {"mesh": _box((0.4, 0.4, 1.7), (0.0, -1.6, 0.85)), "name": "hero"},
        {"mesh": _box((0.4, 0.4, 1.6), (1.4, 4.6, 0.8)), "name": "crowd_00"},
        {"mesh": _box((4.3, 1.8, 0.9), (-5.6, -1.4, 0.5)), "name": "car_a", "label": "body"},
        {"mesh": _box((2.2, 1.55, 0.6), (-5.5, -1.4, 1.15)), "name": "car_a_cabin", "label": "cabin"},
        {"mesh": _box((0.26, 1.4, 0.45), (-4.35, -1.4, 1.2)), "name": "car_a_windshield",
         "label": "windshield"},
        {"mesh": _box((0.92, 0.06, 0.55), (-5.9, -0.56, 0.72)), "name": "car_a_door_front_left",
         "label": "door_front_left"},
        {"mesh": _box((0.92, 0.06, 0.55), (-4.9, -0.56, 0.72)), "name": "car_a_door_rear_left",
         "label": "door_rear_left"},
        {"mesh": _box((0.05, 0.22, 0.1), (-3.40, -0.95, 0.62)), "name": "car_a_headlight_left",
         "label": "headlight_left"},
        {"mesh": _box((0.05, 0.16, 0.1), (-7.80, -1.30, 0.6)), "name": "car_a_taillight_left",
         "label": "taillight_left"},
        {"mesh": trimesh.creation.cylinder(radius=0.335, height=0.22, sections=20),
         "name": "car_a_wheel_front_left", "label": "wheel_front_left"},
    ]
    # 车轮挪到位（cyl 竖直，转成横置）
    items[-1]["mesh"].apply_transform([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]])
    items[-1]["mesh"].apply_translation((-4.24, -0.6, 0.335))
    return items


def _connected_components(mask):
    """连通域计数（不依赖 scipy）。"""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            q = deque([(sy, sx)])
            seen[sy, sx] = True
            n = 0
            while q:
                y, x = q.popleft()
                n += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            comps.append(n)
    return comps


# ------------------------------------------------------------------ 1. depth
@_report
def test_depth_range_and_background():
    """前景像素归一化后 ∈ [0,1]；背景取值统一（单一值）。"""
    res = C.render_conditions(_mini_scene(), _cam(), width=256, height=256)
    d = res["depth"]
    mask = res["mask"]
    assert d.shape == (256, 256)
    assert mask.any(), "场景应有前景"
    fg = d[mask]
    assert fg.min() >= 0.0 and fg.max() <= 1.0, f"前景 depth 越界: {fg.min()}, {fg.max()}"
    bg = d[~mask]
    if bg.size:
        assert np.unique(bg).size == 1, f"背景取值不统一: {np.unique(bg)[:5]}"
        assert bg[0] == C.DEPTH_BACKGROUND, "背景值与约定的 background_depth 不一致"
    # 深度单调性：近处比远处小
    z = res["zbuf"]
    assert np.all(z[mask] >= res["depth_range_m"][0] - 1e-6)
    return {"fg_min": float(fg.min()), "fg_max": float(fg.max()),
            "bg": float(bg[0]) if bg.size else None,
            "near_far_m": [round(res["depth_range_m"][0], 3), round(res["depth_range_m"][1], 3)]}


# ------------------------------------------------------------------ 2. normal
@_report
def test_normal_roundtrip_float():
    """法线 RGB 反解回法线，误差 < 1e-3（浮点路径）。"""
    res = C.render_conditions(_mini_scene(), _cam(), width=256, height=256)
    sel = res["mask"]
    ref = res["face_normals"][res["facebuf"][sel]]
    dec = C.decode_normal(res["normal"][sel])
    err = float(np.abs(dec - ref).max())
    assert err < 1e-3, f"法线反解误差过大: {err}"
    # 单位长度
    assert np.abs(np.linalg.norm(dec, axis=-1) - 1.0).max() < 1e-6
    return {"max_error": err}


@_report
def test_normal_roundtrip_png16():
    """16bit PNG 落盘后再反解，误差仍 < 1e-3（文件级可逆性）。"""
    tmp = tempfile.mkdtemp(prefix="cond_test_")
    try:
        res = C.render_conditions(_mini_scene(), _cam(), width=256, height=256)
        paths = C.save_condition_pngs(res, tmp, prefix="t")
        sel = res["mask"]
        ref = res["face_normals"][res["facebuf"][sel]]
        ch = [np.asarray(Image.open(paths[f"normal_{c}16"]), dtype=np.float64) / 65535.0
              for c in "rgb"]
        dec = C.decode_normal(np.stack(ch, axis=-1)[sel])
        err = float(np.abs(dec - ref).max())
        assert err < 1e-3, f"16bit PNG 反解误差过大: {err}"
        # 8bit 预览 PNG 的量化误差（只做记录，不做断言：8bit 达不到 1e-3）
        p8 = np.asarray(Image.open(paths["normal"]), dtype=np.float64) / 255.0
        err8 = float(np.abs(C.decode_normal(p8[sel]) - ref).max())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"png16_max_error": err, "png8_max_error": round(err8, 6)}


# ------------------------------------------------------------------ 3. seg
@_report
def test_seg_label_colors_unique():
    """不同 label 的像素颜色互不相同；同一 label 的像素颜色一致。"""
    res = C.render_conditions(_mini_scene(), _cam(), width=256, height=256)
    seg = res["seg"]
    palette = res["meta"]["palette"]
    visible = 0
    for lab, rgb in palette.items():
        m = np.all(seg == np.asarray(rgb, np.uint8), axis=-1)
        if not m.any():
            continue                                  # 该 label 被别的几何挡住，不参与校验
        visible += 1
        assert np.unique(seg[m].reshape(-1, 3), axis=0).shape[0] == 1, f"label {lab} 颜色不一致"
    assert visible >= 5, f"画面里可见的 label 太少: {visible}"
    # 不同 label 之间颜色不能重复
    cols = {}
    for lab, rgb in palette.items():
        key = tuple(rgb)
        assert key not in cols, f"label {lab} 与 {cols.get(key)} 颜色重复"
        cols[key] = lab
    return {"labels_in_palette": len(palette), "labels_visible": visible}


@_report
def test_seg_connected_regions_consistent():
    """同一 label 的多个连通区域颜色一致。"""
    scene = [
        {"mesh": _box((1.0, 1.0, 1.0), (-3.0, 0, 0.5)), "label": "body"},
        {"mesh": _box((1.0, 1.0, 1.0), (3.0, 0, 0.5)), "label": "body"},
        {"mesh": _box((1.0, 1.0, 1.0), (0.0, 0, 0.5)), "label": "wheel"},
    ]
    res = C.render_conditions(scene, _cam(), width=256, height=256)
    seg = res["seg"]
    pal = res["meta"]["palette"]
    body = np.all(seg == np.asarray(pal["body"], np.uint8), axis=-1)
    comps = _connected_components(body)
    assert len(comps) >= 2, f"测试场景应有两块分离的同 label 区域，实际 {len(comps)}"
    colors = {tuple(c) for c in seg[body].reshape(-1, 3)}
    assert len(colors) == 1, "同一 label 的连通区域颜色不一致"
    return {"components": len(comps), "sizes": sorted(comps, reverse=True)[:4]}


# ------------------------------------------------------------------ 4. 隐藏
@_report
def test_hide_reduces_foreground():
    """隐藏车（hide=True）后前景像素显著减少。

    关键：车后面必须是**背景**而不是路面/建筑，否则隐藏车只是把前景换成前景，
    前景总数根本不会变，测不出隐藏是否生效。这里让相机与车之间没有其它几何。
    """
    scene = [
        {"mesh": _box((6.0, 6.0, 0.04), (0.0, 0.0, 0.02)), "name": "ground"},
        {"mesh": _box((4.3, 1.8, 0.9), (-5.6, -1.4, 0.5)), "name": "car_a", "label": "body"},
        {"mesh": _box((2.2, 1.55, 0.6), (-5.5, -1.4, 1.15)), "name": "car_a_cabin", "label": "cabin"},
        {"mesh": _box((0.05, 0.22, 0.1), (-3.40, -0.95, 0.62)), "name": "car_a_headlight_left",
         "label": "headlight_left"},
    ]
    cam = C.Camera((-11.0, -1.40, 0.60), (0.0, -1.40, 0.95), (0, 0, 1), 40.0, 256, 256, 36.0, 36.0)
    res = C.render_conditions(scene, cam, width=256, height=256)
    hidden = [dict(it, hide=C.is_vehicle_geometry(it)) for it in scene]
    n_hidden = sum(1 for it in hidden if it["hide"])
    assert n_hidden > 0, "没有识别出车相关几何"
    res_h = C.render_conditions(hidden, cam, width=256, height=256)
    before = int(res["mask"].sum())
    after = int(res_h["mask"].sum())
    assert after < before * 0.6, f"隐藏后前景没有明显减少: {before} -> {after}"
    # 隔离场景：只渲染车 -> 隐藏后前景必须归零
    only_car = [it for it in scene if C.is_vehicle_geometry(it)]
    car_only = C.render_conditions(only_car, cam, width=256, height=256)
    car_hidden = C.render_conditions([dict(it, hide=True) for it in only_car], cam,
                                      width=256, height=256)
    assert int(car_hidden["mask"].sum()) == 0, "隐藏后仍有前景像素"
    # 被隐藏的 label 不应出现在渲染结果里
    for lab in res_h["meta"]["hidden_labels"]:
        rgb = res_h["meta"]["palette"][lab]
        m = np.all(res_h["seg"] == np.asarray(rgb, np.uint8), axis=-1)
        assert not m.any(), f"被隐藏的 label {lab} 仍出现在分割图里"
    return {"before": before, "after": after,
            "reduction_ratio": round((before - after) / max(before, 1), 4),
            "hidden_meshes": n_hidden,
            "isolated_before": int(car_only["mask"].sum()),
            "isolated_after": int(car_hidden["mask"].sum())}


@_report
def test_hide_is_not_noop():
    """反证：hide=False 与 hide=True 必须给出不同的前景（排除"空转"）。"""
    scene = _mini_scene()
    cam = _cam()
    vis = C.render_conditions(scene, cam, width=128, height=128)
    hid = C.render_conditions([dict(it, hide=True) for it in scene], cam, width=128, height=128)
    assert int(hid["mask"].sum()) == 0
    assert int(vis["mask"].sum()) > 0
    return {"visible": int(vis["mask"].sum()), "all_hidden": int(hid["mask"].sum())}


# ------------------------------------------------------------------ 5. 性能
@_report
def test_perf_512():
    """512x512 三通道单帧渲染 < 1.5s（纯 CPU）。"""
    try:
        items = C._scene_from_generate_assets()
        source = "generate_assets.generate_all()"
    except Exception as exc:
        items = C._fallback_scene()
        source = f"fallback_minimal_scene ({type(exc).__name__})"
    cam = C._demo_camera(512, 512)
    best = None
    for _ in range(3):
        t = time.perf_counter()
        res = C.render_conditions(items, cam, width=512, height=512)
        dt = (time.perf_counter() - t) * 1000.0
        best = dt if best is None else min(best, dt)
    assert best < 1500.0, f"512x512 渲染超时: {best:.1f}ms"
    # 单通道便捷函数也要在预算内
    t = time.perf_counter()
    C.render_depth(items, cam, width=512, height=512)
    dt_depth = (time.perf_counter() - t) * 1000.0
    return {"source": source, "best_ms": round(best, 1),
            "raster_ms": res["meta"]["rasterize_ms"],
            "triangles": res["meta"]["triangles"], "render_depth_ms": round(dt_depth, 1)}


# ------------------------------------------------------------------ 6. 语义
@_report
def test_semantic_mapping():
    """直接名 / 前缀 / 无 label 三条路径都按约定归类。"""
    assert C.resolve_category("body") == "body"
    assert C.resolve_category("door_left") == "door"
    assert C.resolve_category("door_right") == "door"
    assert C.resolve_category("wheel_front_left") == "wheel"
    assert C.resolve_category("headlight") == "headlight"
    assert C.resolve_category("taillight") == "taillight"
    assert C.resolve_category("windshield") == "windshield"
    assert C.resolve_category("building_a") == "building"
    assert C.resolve_category("building_office") == "building"
    assert C.resolve_category("tree_a") == "tree"
    assert C.resolve_category("tree_canopy_a") == "foliage"
    assert C.resolve_category("crowd_07") == "crowd"
    assert C.resolve_category("car_a") == "vehicle"
    assert C.resolve_category("hero") == "character"
    assert C.resolve_category("something_unknown_xyz") == "other"
    # 无 label 的几何 -> other
    res = C.render_conditions([_box((1, 1, 1))], _cam(), width=64, height=64)
    assert res["meta"]["labels"] == ["other"], res["meta"]["labels"]
    assert res["meta"]["categories"]["other"] == "other"
    return {"categories": sorted(set(C.DIRECT_CATEGORIES.values()))}


@_report
def test_palette_fixed_and_unique():
    """固定调色板：颜色两两不同、同一 label 每次得到同一颜色。"""
    cols = list(C.CATEGORY_COLORS.values())
    assert len(set(cols)) == len(cols), "固定调色板里有重复颜色"
    p1 = C.build_palette(["body", "door_left", "zzz_unknown"])
    p2 = C.build_palette(["zzz_unknown", "body", "door_left"])
    assert p1 == p2, "调色板不是与顺序无关的确定性结果"
    assert len(set(p1.values())) == len(p1), "调色板里有重复颜色"
    return {"palette_size": len(p1)}


@_report
def test_resolution_independent():
    """分辨率可独立于 camera.width/height 指定。"""
    cam = _cam(w=800, h=600)
    res = C.render_conditions(_mini_scene(), cam, width=128, height=256)
    assert res["depth"].shape == (256, 128), res["depth"].shape
    assert res["normal"].shape == (256, 128, 3)
    assert res["seg"].shape == (256, 128, 3)
    return {"shape": list(res["depth"].shape)}


@_report
def test_convenience_functions():
    """render_depth / render_normal / render_seg 三个便捷函数。"""
    scene = _mini_scene()
    cam = _cam()
    d = C.render_depth(scene, cam, width=128, height=128)
    n = C.render_normal(scene, cam, width=128, height=128)
    s = C.render_seg(scene, cam, width=128, height=128)
    assert d.mode == "L" and d.size == (128, 128)
    assert n.mode == "RGB" and n.size == (128, 128)
    assert s.mode == "RGB" and s.size == (128, 128)
    return {"depth_mode": d.mode, "normal_mode": n.mode, "seg_mode": s.mode}


@_report
def test_near_plane_clipping():
    """跨近平面的三角形要被裁剪，而不是变成铺满画面的假三角形。"""
    scene = [{"mesh": _box((60.0, 60.0, 0.04), (0, 0, 0.02)), "name": "ground"}]
    cam = C.Camera((0.0, -1.0, 0.4), (0.0, 20.0, 0.4), (0, 0, 1), 50.0, 128, 128, 36.0, 36.0)
    res = C.render_conditions(scene, cam, width=128, height=128)
    # 地面在相机下方，天空方向必须留出背景
    assert (~res["mask"]).any(), "地面之上应有背景"
    assert res["zbuf"][res["mask"]].min() > 0.0, "近平面附近不应出现 0 深度"
    top_bg = res["mask"][0:16].sum()
    assert top_bg < 128 * 16, "画面上半部分被假三角形铺满（近平面裁剪失效）"
    return {"background_px": int((~res["mask"]).sum()), "top_bg_px": int(top_bg)}


@_report
def test_depth_monotonic_with_distance():
    """同一帧里：近的物体 depth 更小（约定 0=最近，1=最远）。

    注意 depth 是**按帧**归一化的，所以只能在同一帧内比较远近，不能跨帧比较。
    """
    scene = [
        {"mesh": _box((1.2, 1.2, 1.2), (-2.2, -1.0, 0.6)), "label": "near"},
        {"mesh": _box((1.2, 1.2, 1.2), (2.6, 6.0, 0.6)), "label": "far"},
    ]
    cam = C.Camera((0.0, -8.0, 1.2), (0.0, 1.0, 0.9), (0, 0, 1), 45.0, 128, 128, 36.0, 36.0)
    res = C.render_conditions(scene, cam, width=128, height=128)
    seg = res["seg"]
    pal = res["meta"]["palette"]
    d = res["depth"]
    m_near = np.all(seg == np.asarray(pal["near"], np.uint8), axis=-1)
    m_far = np.all(seg == np.asarray(pal["far"], np.uint8), axis=-1)
    assert m_near.any() and m_far.any(), "两个物体都要在画面里"
    d_near = float(np.median(d[m_near]))
    d_far = float(np.median(d[m_far]))
    assert d_near < d_far, f"近处 depth 应更小: {d_near} vs {d_far}"
    # 深度对距离单调（用 z-buffer 直接核对）
    z = res["zbuf"]
    assert float(z[m_near].mean()) < float(z[m_far].mean())
    return {"near": round(d_near, 4), "far": round(d_far, 4)}


# ------------------------------------------------------------------ runner
def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = []
    for fn in tests:
        t = time.perf_counter()
        try:
            fn()
            print(f"[PASS] {fn.__name__} ({time.perf_counter() - t:.2f}s) {RESULTS.get(fn.__name__)}")
        except Exception as exc:                # noqa: BLE001
            failed.append(fn.__name__)
            print(f"[FAIL] {fn.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - len(failed)}/{len(tests)} passed")
    if failed:
        print("failed:", ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
