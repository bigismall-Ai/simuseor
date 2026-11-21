"""下载可公开复用的 3D 资产（CC0 / CC-BY），记录来源、许可、哈希与网格统计。

原始文件写入 var/public-assets（gitignored），清单与预览写入 research 交付目录。
"""
from __future__ import annotations

import hashlib
import http.cookiejar
import json
import os
import re
import urllib.request
import zipfile

import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
DEST = os.path.join(PROJ, "var", "public-assets")
OUT = os.path.join(ROOT, "assets", "validation", "public_assets.json")

PROXY = "http://127.0.0.1:7890"
CJ = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
                                     urllib.request.HTTPCookieProcessor(CJ))
OPENER.addheaders = [("User-Agent", "Mozilla/5.0")]

records = []


def fetch(url, timeout=180, referer=None):
    headers = {"User-Agent": "Mozilla/5.0"}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with OPENER.open(req, timeout=timeout) as r:
        return r.read()


def save(url, path, referer=None):
    if os.path.exists(path) and os.path.getsize(path) > 1024:
        return None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = fetch(url, referer=referer)
    with open(path, "wb") as f:
        f.write(data)
    return data


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def mesh_stats(path):
    try:
        sc = trimesh.load(path, force="scene", process=False)
        geoms = list(sc.geometry.values()) if hasattr(sc, "geometry") else [sc]
        faces = int(sum(len(g.faces) for g in geoms))
        verts = int(sum(len(g.vertices) for g in geoms))
        bounds = sc.bounds if hasattr(sc, "bounds") else geoms[0].bounds
        size = (bounds[1] - bounds[0]).tolist()
        return {"geometries": len(geoms), "faces": faces, "vertices": verts,
                "size_m": [round(float(x), 3) for x in size]}
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


def add(name, category, source, page, license_name, license_url, files, note=""):
    main = files[0] if files else None
    rec = {"name": name, "category": category, "source": source, "page": page,
           "license": license_name, "license_url": license_url,
           "files": [os.path.relpath(f, DEST) for f in files],
           "bytes": sum(os.path.getsize(f) for f in files),
           "sha256": sha256(main) if main else None,
           "stats": mesh_stats(main) if main else None, "note": note}
    records.append(rec)
    print(f"[ok] {name}: {len(files)} files, {rec['bytes']/1024/1024:.1f} MB, {rec['stats']}")


# ---------------------------------------------------------------- Poly Haven
def polyhaven(asset_id, category, name=None):
    try:
        meta = json.loads(fetch(f"https://api.polyhaven.com/files/{asset_id}"))
        inner = meta["gltf"]["1k"]["gltf"]
        base = os.path.join(DEST, "polyhaven", asset_id)
        main = os.path.join(base, os.path.basename(inner["url"]))
        save(inner["url"], main)
        files = [main]
        for rel, info in inner.get("include", {}).items():
            p = os.path.join(base, rel)
            save(info["url"], p)
            files.append(p)
        add(name or asset_id, category, "Poly Haven", f"https://polyhaven.com/a/{asset_id}",
            "CC0 1.0", "https://polyhaven.com/license", files,
            note="1k glTF bundle（含纹理，用于白模时需剥离材质）")
    except Exception as exc:
        print(f"[fail] polyhaven {asset_id}: {exc}")


# ---------------------------------------------------------------- MakeHuman
def makehuman_shirts():
    url = "https://files2.makehumancommunity.org/asset_packs/shirts01/shirts01_cc0.zip"
    try:
        zpath = os.path.join(DEST, "makehuman", "shirts01_cc0.zip")
        save(url, zpath)
        out = os.path.join(DEST, "makehuman", "shirts01")
        with zipfile.ZipFile(zpath) as z:
            z.extractall(out)
        meshes = []
        for dp, _, ns in os.walk(out):
            for n in ns:
                if n.lower().endswith((".obj", ".mhclo", ".mhmat")):
                    meshes.append(os.path.join(dp, n))
        objs = [m for m in meshes if m.endswith(".obj")][:1]
        add("MakeHuman shirts01", "clothing", "MakeHuman Community",
            "https://static.makehumancommunity.org/assets/assetpacks/shirts01.html",
            "CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/",
            (objs or [zpath]) + [zpath], note="MHCLO 服装包（71 文件），需配合人体底座与 MPFB")
    except Exception as exc:
        print(f"[fail] makehuman: {exc}")


# ---------------------------------------------------------------- Kenney
def kenney(slug, category):
    try:
        page_url = f"https://kenney.nl/assets/{slug}"
        page = fetch(page_url, referer="https://kenney.nl/").decode("utf-8", "ignore")
        m = re.search(r"data-download-id='([0-9a-f]+)'", page)
        if not m:
            raise RuntimeError("未找到 data-download-id")
        signed = json.loads(fetch(f"https://kenney.nl/download-link/{m.group(1)}", referer=page_url))
        zpath = os.path.join(DEST, "kenney", f"{slug}.zip")
        save(signed["url"], zpath, referer=page_url)
        out = os.path.join(DEST, "kenney", slug)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(out)
        meshes = []
        for dp, _, ns in os.walk(out):
            for n in ns:
                if n.lower().endswith((".glb", ".gltf", ".obj")):
                    meshes.append(os.path.join(dp, n))
        preview = sorted(meshes)[:1]
        add(f"Kenney {slug}", category, "Kenney", page_url,
            "CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/",
            preview + [zpath], note=f"zip 内共 {len(meshes)} 个网格文件；低模、风格化")
    except Exception as exc:
        print(f"[fail] kenney {slug}: {exc}")


# ---------------------------------------------------------------- Poly Pizza
def polypizza(model_id, category):
    try:
        page = fetch(f"https://poly.pizza/m/{model_id}").decode("utf-8", "ignore")
        glb = re.search(r"https://static\.poly\.pizza/[0-9a-f-]+\.glb\.br", page)
        lic = re.search(r"(creativecommons\.org/(?:licenses/by/[\d.]+|publicdomain/zero/1\.0))", page)
        title = re.search(r'property="og:title" content="([^"]+)"', page)
        name = title.group(1) if title else model_id
        if not glb:
            raise RuntimeError("未找到 glb 链接")
        raw = fetch(glb.group(0))
        if raw[:4] != b"glTF":
            import brotli
            raw = brotli.decompress(raw)
        out = os.path.join(DEST, "polypizza", f"{model_id}.glb")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "wb") as f:
            f.write(raw)
        lic_url = "https://" + lic.group(1) if lic else ""
        lic_name = "CC0 1.0" if "publicdomain" in lic_url else "CC-BY"
        add(name, category, "Poly Pizza", f"https://poly.pizza/m/{model_id}",
            lic_name, lic_url, [out], note="页面直下 GLB；使用需保留署名（CC-BY 时）")
    except Exception as exc:
        print(f"[fail] polypizza {model_id}: {exc}")


# ---------------------------------------------------------------- Khronos
def khronos(model, category, license_name="CC-BY 4.0",
            license_url="https://creativecommons.org/licenses/by/4.0/", note=""):
    try:
        url = f"https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/{model}/glTF-Binary/{model}.glb"
        out = os.path.join(DEST, "khronos", f"{model}.glb")
        save(url, out)
        add(model, category, "Khronos glTF Sample Assets",
            f"https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/{model}",
            license_name, license_url, [out],
            note=note or "README 许可需逐件复核")
    except Exception as exc:
        print(f"[fail] khronos {model}: {exc}")


def main():
    os.makedirs(DEST, exist_ok=True)
    polyhaven("island_tree_01", "vegetation")
    polyhaven("old_military_crate", "prop")
    polyhaven("ArmChair_01", "prop")
    makehuman_shirts()
    kenney("car-kit", "vehicle")
    kenney("nature-kit", "vegetation")
    polypizza("5zUWP5UsLg-", "vehicle")
    khronos("Fox", "creature", "CC-BY 4.0",
            "https://creativecommons.org/licenses/by/4.0/",
            "© 2014 tomkranis；动画 © 2017 @AsoboStudio & @scurest")
    khronos("ToyCar", "vehicle", "CC0 1.0",
            "https://creativecommons.org/publicdomain/zero/1.0/",
            "© 2020 Guido Odendahl（模型）/ Eric Chadwick（扩展与场景）")
    summary = {"total": len(records), "bytes": sum(r["bytes"] for r in records),
               "licenses": sorted({r["license"] for r in records})}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "assets": records,
                   "root": os.path.relpath(DEST, PROJ)}, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
