"""CPU-only geometry helpers: primitives, lofting, L-system, software rasterizer.

所有几何均在 CPU 上确定性生成，不依赖 GPU / 3D 生成式模型。
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass, field

import numpy as np
import trimesh
from PIL import Image, ImageDraw


# ---------------------------------------------------------------- 基础变换
def T(x: float, y: float, z: float) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def S(sx: float, sy: float, sz: float) -> np.ndarray:
    m = np.eye(4)
    m[0, 0], m[1, 1], m[2, 2] = sx, sy, sz
    return m


def R_axis(axis: str, deg: float) -> np.ndarray:
    m = np.eye(4)
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == "x":
        m[1:3, 1:3] = [[c, -s], [s, c]]
    elif axis == "y":
        m[[0, 0, 2, 2], [0, 2, 0, 2]] = [c, s, -s, c]
    else:
        m[0:2, 0:2] = [[c, -s], [s, c]]
    return m


def place(mesh: trimesh.Trimesh, matrix: np.ndarray) -> trimesh.Trimesh:
    out = mesh.copy()
    out.apply_transform(matrix)
    return out


# ---------------------------------------------------------------- 图元
def box(extents, center=(0, 0, 0), matrix=None) -> trimesh.Trimesh:
    m = trimesh.creation.box(extents=extents)
    if matrix is not None:
        m = place(m, matrix)
    return place(m, T(*center))


def sphere(radius=1.0, center=(0, 0, 0), subdiv=2, scale=(1, 1, 1)) -> trimesh.Trimesh:
    m = trimesh.creation.icosphere(subdivisions=subdiv, radius=radius)
    m = place(m, S(*scale))
    return place(m, T(*center))


def cylinder(radius=1.0, height=1.0, center=(0, 0, 0), sections=20) -> trimesh.Trimesh:
    m = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    return place(m, T(*center))


def disc(radius=1.0, z=0.0, sections=32) -> trimesh.Trimesh:
    ang = np.linspace(0, 2 * np.pi, sections, endpoint=False)
    verts = np.column_stack([np.cos(ang) * radius, np.sin(ang) * radius, np.full(sections, z)])
    faces = [[0, i + 1, i + 2] for i in range(sections - 2)]
    return trimesh.Trimesh(vertices=verts, faces=np.array(faces), process=True)


def loft(rings, cap=True, close=True) -> trimesh.Trimesh:
    """把若干闭合截面环依次连成网格。ring: (N,3)，需同点数且同向。"""
    rings = [np.asarray(r, dtype=float) for r in rings]
    n = len(rings[0])
    verts = np.vstack(rings)
    faces = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        for j in range(n if close else n - 1):
            j2 = (j + 1) % n
            faces.append([a + j, a + j2, b + j2])
            faces.append([a + j, b + j2, b + j])
    if cap:
        c0 = rings[0].mean(axis=0)
        c1 = rings[-1].mean(axis=0)
        i0 = len(verts)
        verts = np.vstack([verts, c0, c1])
        last = (len(rings) - 1) * n
        for j in range(n):
            j2 = (j + 1) % n
            faces.append([i0, j2, j])              # 底部
            faces.append([i0 + 1, last + j, last + j2])  # 顶部
    mesh = trimesh.Trimesh(vertices=verts, faces=np.array(faces, dtype=np.int64), process=True)
    if mesh.volume < 0:
        mesh.invert()
    return mesh


def segment(p0, p1, r0, r1=None, sections=12, cap=True) -> trimesh.Trimesh:
    """两点之间的截锥体（肢体/枝干）。"""
    p0 = np.asarray(p0, float)
    p1 = np.asarray(p1, float)
    r1 = r0 if r1 is None else r1
    d = p1 - p0
    ln = float(np.linalg.norm(d))
    if ln < 1e-6:
        return sphere(r0, center=p0, subdiv=1)
    z = d / ln
    rot = np.asarray(trimesh.geometry.align_vectors([0.0, 0.0, 1.0], z))[:3, :3]
    ang = np.linspace(0, 2 * np.pi, sections, endpoint=False)
    rings = []
    for t, r in ((0.0, r0), (1.0, r1)):
        local = np.column_stack([np.cos(ang) * r, np.sin(ang) * r, np.full(sections, t * ln)])
        rings.append(local @ rot.T + p0)
    return loft(rings, cap=cap)


def ellipse_ring(rx, ry, z, sections=24, n_exp=2.0, y=0.0):
    """超椭圆截面，用于躯干/车身/船体。"""
    t = np.linspace(0, 2 * np.pi, sections, endpoint=False)
    cy, sy = np.cos(t), np.sin(t)
    x = rx * np.sign(cy) * np.abs(cy) ** (2.0 / n_exp)
    yy = ry * np.sign(sy) * np.abs(sy) ** (2.0 / n_exp)
    zz = np.full_like(t, float(z))
    return np.column_stack([x, y + yy, zz])


def merge(meshes) -> trimesh.Trimesh:
    meshes = [m for m in meshes if m is not None and len(m.faces)]
    return trimesh.util.concatenate(meshes)


def union(meshes) -> trimesh.Trimesh:
    try:
        out = trimesh.boolean.union(meshes, engine="manifold")
        return out
    except Exception:
        return merge(meshes)


# ---------------------------------------------------------------- 渲染
@dataclass
class Camera:
    eye: tuple
    target: tuple
    up: tuple = (0, 0, 1)
    fov_y: float = 35.0
    width: int = 1000
    height: int = 680
    focal_mm: float = 50.0
    sensor_mm: float = 36.0

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
        """世界坐标 -> 像素坐标 + 相机空间深度。"""
        cam = self.view(pts)
        z = np.maximum(cam[..., 2], 1e-4)
        f = 1.0 / math.tan(math.radians(self.fov_y) * 0.5)
        aspect = self.width / self.height
        ndc_x = cam[..., 0] / z * f / aspect
        ndc_y = cam[..., 1] / z * f
        px = (ndc_x * 0.5 + 0.5) * self.width
        py = (1.0 - (ndc_y * 0.5 + 0.5)) * self.height
        return np.stack([px, py], axis=-1), cam[..., 2]

    def fov_from_focal(self):
        return math.degrees(2 * math.atan(self.sensor_mm * 0.5 / self.focal_mm))


def _shade(normals, base):
    light1 = np.array([0.45, -0.65, 0.62])
    light1 /= np.linalg.norm(light1)
    light2 = np.array([-0.55, -0.35, 0.2])
    light2 /= np.linalg.norm(light2)
    lam = np.clip(normals @ light1, 0, 1) * 0.72 + np.clip(normals @ light2, 0, 1) * 0.18
    shade = 0.30 + 0.70 * lam
    return np.clip(np.asarray(base)[None, :] * shade[:, None], 0, 1)


def render(meshes, camera: Camera, bg=(0.945, 0.949, 0.956), wire=True,
           ground=None, lines=None, ss=1) -> Image.Image:
    """软件光栅：z-buffer + 平面着色 + 可选线框/地面网格/3D 线。

    meshes: [(trimesh.Trimesh, (r,g,b))] 或 [trimesh.Trimesh]
    lines:  [(p0, p1, (r,g,b), width)]
    """
    W, H = camera.width * ss, camera.height * ss
    cam = Camera(camera.eye, camera.target, camera.up, camera.fov_y, W, H,
                 camera.focal_mm, camera.sensor_mm)
    color = np.zeros((H, W, 3), np.float32)
    color[:] = np.asarray(bg, np.float32) * 255.0
    zbuf = np.full((H, W), np.inf, np.float32)

    # 地面：一片大平面 + 网格线（直接以 mesh 形式加入）
    items = []
    for m in meshes:
        if isinstance(m, tuple):
            items.append((m[0], m[1]))
        else:
            items.append((m, (0.82, 0.82, 0.84)))
    if ground is not None:
        gz, gsize, gcolor = ground
        n = 24
        xs = np.linspace(-gsize, gsize, n + 1)
        verts = np.array([[x, y, gz] for y in xs for x in xs])
        faces = []
        for iy in range(n):
            for ix in range(n):
                a = iy * (n + 1) + ix
                faces.append([a, a + 1, a + n + 2])
                faces.append([a, a + n + 2, a + n + 1])
        g = trimesh.Trimesh(vertices=verts, faces=np.array(faces), process=False)
        items.insert(0, (g, gcolor))

    for mesh, base in items:
        v = np.asarray(mesh.vertices, float)
        f = np.asarray(mesh.faces, int)
        if not len(f):
            continue
        pv, depth = cam.project(v)
        tri = pv[f]              # (F,3,2)
        tz = depth[f]            # (F,3)
        ok = np.all(tz > 0.05, axis=1)
        ok &= (tri[:, :, 0].max(1) >= 0) & (tri[:, :, 0].min(1) < W)
        ok &= (tri[:, :, 1].max(1) >= 0) & (tri[:, :, 1].min(1) < H)
        if not ok.any():
            continue
        normals = mesh.face_normals
        cols = _shade(normals, base) * 255.0
        idx = np.nonzero(ok)[0]
        for fi in idx:
            p = tri[fi]
            z = tz[fi]
            xmin = max(int(math.floor(p[:, 0].min())), 0)
            xmax = min(int(math.ceil(p[:, 0].max())), W - 1)
            ymin = max(int(math.floor(p[:, 1].min())), 0)
            ymax = min(int(math.ceil(p[:, 1].max())), H - 1)
            if xmax < xmin or ymax < ymin:
                continue
            xs = np.arange(xmin, xmax + 1) + 0.5
            ys = np.arange(ymin, ymax + 1) + 0.5
            X, Y = np.meshgrid(xs, ys)
            x0, y0 = p[0]
            x1, y1 = p[1]
            x2, y2 = p[2]
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(den) < 1e-9:
                continue
            w0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den
            w1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den
            w2 = 1.0 - w0 - w1
            inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
            if not inside.any():
                continue
            zz = w0 * z[0] + w1 * z[1] + w2 * z[2]
            sub = zbuf[ymin:ymax + 1, xmin:xmax + 1]
            win = inside & (zz < sub)
            if not win.any():
                continue
            sub[win] = zz[win]
            color[ymin:ymax + 1, xmin:xmax + 1][win] = cols[fi]

    img = Image.fromarray(np.clip(color, 0, 255).astype(np.uint8))
    if wire:
        dr = ImageDraw.Draw(img, "RGBA")
        for mesh, base in items:
            if len(mesh.faces) > 9000:
                continue
            v = np.asarray(mesh.vertices, float)
            f = np.asarray(mesh.faces, int)
            pv, depth = cam.project(v)
            seen = set()
            for tri in f:
                for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                    key = (min(a, b), max(a, b))
                    if key in seen:
                        continue
                    seen.add(key)
                    if depth[a] <= 0.05 or depth[b] <= 0.05:
                        continue
                    mx = int(np.clip((pv[a][0] + pv[b][0]) * 0.5, 0, W - 1))
                    my = int(np.clip((pv[a][1] + pv[b][1]) * 0.5, 0, H - 1))
                    if (depth[a] + depth[b]) * 0.5 > zbuf[my, mx] + 0.06:
                        continue
                    dr.line([tuple(pv[a]), tuple(pv[b])], fill=(72, 76, 84, 46), width=max(1, ss // 2))
    if lines:
        dr = ImageDraw.Draw(img, "RGBA")
        for item in lines:
            p0, p1, col = item[0], item[1], item[2]
            wdt = item[3] if len(item) > 3 else 2
            c = list(col)
            if max(c) <= 1.0:
                c = [int(v * 255) for v in c]
            fill = tuple(int(v) for v in c) + (235,)
            # 深度感知：采样后只绘制位于可见表面的线段（避免网格线穿透物体）
            n = 40
            pts = np.linspace(np.asarray(p0, float), np.asarray(p1, float), n)
            pv, dep = cam.project(pts)
            for k in range(n - 1):
                x, y = pv[k]
                if 0 <= x < W and 0 <= y < H:
                    if dep[k] > zbuf[int(y), int(x)] + 0.08:
                        continue
                dr.line([tuple(pv[k]), tuple(pv[k + 1])], fill=fill,
                        width=max(1, int(wdt * ss)))
    if ss > 1:
        img = img.resize((camera.width, camera.height), Image.LANCZOS)
    return img


def camera_fit(points, direction=(1.0, -1.35, 0.65), fov_y=35.0, margin=1.28,
               width=1000, height=680) -> Camera:
    """根据点集自动构图（透视）。"""
    pts = np.asarray(points, float)
    lo, hi = pts.min(0), pts.max(0)
    center = (lo + hi) * 0.5
    radius = float(np.linalg.norm(hi - lo) * 0.5) + 1e-6
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    dist = radius / math.tan(math.radians(fov_y) * 0.5) * margin
    eye = center + d * dist
    cam = Camera(tuple(eye), tuple(center), (0, 0, 1), fov_y, width, height)
    return cam


def save(img: Image.Image, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


# ---------------------------------------------------------------- 导出
def export_glb(mesh, path, name="asset"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mesh.export(path, file_type="glb")


def export_stl(mesh, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mesh.export(path, file_type="stl")


def export_obj(mesh, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mesh.export(path, file_type="obj")


def scene_glb(items, path, name="scene"):
    """items: [(name, mesh, transform4)]，导出为带节点层级的 GLB。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene = trimesh.Scene()
    for nm, mesh, tf in items:
        scene.add_geometry(mesh, node_name=nm, geom_name=nm, transform=tf)
    scene.export(path, file_type="glb")
