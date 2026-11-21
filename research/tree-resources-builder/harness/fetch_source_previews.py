"""抓取社区来源的官方预览图（仅用于调研对照，不随资产再分发）。"""
from __future__ import annotations

import json
import os
import subprocess

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PREV = os.path.join(ROOT, "assets", "previews")
OUT = os.path.join(ROOT, "assets", "validation", "source_previews.json")
PROXY = "http://127.0.0.1:7890"

ITEMS = [
    ("src_quaternius", "Quaternius · 动物包", "CC0",
     "https://quaternius.com/packs/ultimateanimatedanimals.html",
     "https://quaternius.com/assets/images/fullres/ultimateanimatedanimal.jpg"),
    ("src_kaykit", "KayKit · Adventurers", "CC0",
     "https://kaylousberg.itch.io/kaykit-adventurers",
     "https://img.itch.zone/aW1nLzIzODA4Mjg4LnBuZw==/original/WI%2FL4z.png"),
    ("src_gso", "Google Scanned Objects · 扫描件", "CC-BY 4.0",
     "https://app.gazebosim.org/GoogleResearch/fuel/collections/Scanned%20Objects",
     "https://fuel.gazebosim.org/1.0/GoogleResearch/models/Weisshai_Great_White_Shark/tip/files/thumbnails/0.jpg"),
    ("src_objaverse", "Objaverse · 80 万+ 模型", "ODC-By / 逐件许可",
     "https://objaverse.allenai.org/",
     "https://objaverse.allenai.org/objaverse-xl/objaverse-xl.jpg"),
    ("src_sketchfab", "Sketchfab · CC0 过滤示例", "CC0（该模型）",
     "https://sketchfab.com/3d-models/baseball-cap-classic-34560b058ddf496aba53fe4d666c1441",
     "https://media.sketchfab.com/thumbnails/4c57687b657445e1b46c83b35e494ad4/1024.jpg"),
    ("src_renderpeople", "Renderpeople · 免费样例", "自有免费商用许可",
     "https://renderpeople.com/free-3d-people",
     "https://renderpeople.com/wp-content/uploads/rp_images/rp_site_images/renderpeople_free_3d_people_2025.jpg"),
]

out = {}
for key, label, lic, page, img in ITEMS:
    try:
        env = dict(os.environ, HTTPS_PROXY=PROXY, HTTP_PROXY=PROXY)
        raw = os.path.join(PREV, f"{key}_raw")
        cmd = ["curl.exe", "-sL", "--max-time", "90"]
        if key == "src_renderpeople":
            cmd += ["-e", page]
        cmd += [img, "-o", raw]
        subprocess.run(cmd, capture_output=True, env=env)
        if not os.path.exists(raw) or os.path.getsize(raw) < 2048:
            raise RuntimeError(f"download failed ({os.path.getsize(raw) if os.path.exists(raw) else 0} bytes)")
        im = Image.open(raw).convert("RGB")
        if im.width > 960:
            im = im.resize((960, int(im.height * 960 / im.width)), Image.LANCZOS)
        dst = os.path.join(PREV, f"{key}.jpg")
        im.save(dst, "JPEG", quality=84, optimize=True, progressive=True)
        os.remove(raw)
        out[key] = {"label": label, "license": lic, "page": page, "image_source": img,
                    "path": os.path.relpath(dst, ROOT)}
        print("[ok]", key, im.size)
    except Exception as exc:
        print("[fail]", key, exc)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("saved", OUT, len(out))
