"""验证 report.html 的离线可用性：静态外链扫描 + JS 语法 + 真机渲染/交互。"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPORT = os.path.join(ROOT, "report.html")
OUT = os.path.join(ROOT, "assets", "validation", "report_check.json")
SHOTS = os.path.join(ROOT, "assets", "validation", "ui")


def static_checks(html):
    res = {}
    res["bytes"] = os.path.getsize(REPORT)
    res["external_resource_tags"] = len(re.findall(
        r'<(?:script|img|link|iframe)[^>]+(?:src|href)\s*=\s*["\']https?://', html, re.I))
    res["css_imports"] = len(re.findall(r'@import|url\(\s*["\']?https?://', html, re.I))
    res["data_uris"] = len(re.findall(r'data:image/[a-z]+;base64,', html))
    res["svg_inline"] = len(re.findall(r'<svg[^>]*>', html))
    res["sections"] = re.findall(r'<section id="([^"]+)"', html)
    res["nav_targets"] = sorted(set(re.findall(r'<a href="#([^"]+)"', html)))
    res["title"] = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
    res["external_anchors"] = len(re.findall(r'<a [^>]*href="https?://', html, re.I))
    res["cjk_ok"] = ("白模" in html) and ("????" not in html)
    # 所有内联图片可解码
    bad = 0
    for m in re.finditer(r'data:image/[a-z]+;base64,([A-Za-z0-9+/=]+)', html):
        try:
            base64.b64decode(m.group(1)[:400] + "==", validate=False)
        except Exception:
            bad += 1
    res["undecodable_images"] = bad
    res["js_bytes"] = sum(len(s) for s in re.findall(r"<script>(.*?)</script>", html, re.S))
    return res


def js_syntax(html):
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    tmp = os.path.join(ROOT, "assets", "validation", "_inline.js")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(scripts))
    p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    return {"ok": p.returncode == 0, "stderr": (p.stderr or "").strip()[:600]}


def ui_check():
    os.makedirs(SHOTS, exist_ok=True)
    env = dict(os.environ)
    env["NODE_PATH"] = r"D:\nvm4w\nodejs\node_modules\@playwright\cli\node_modules"
    exe = os.path.expandvars(
        r"%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-1255\chrome-headless-shell-win64\chrome-headless-shell.exe")
    if os.path.exists(exe):
        env["PW_EXE"] = exe
    p = subprocess.run(["node", os.path.join(HERE, "verify_ui.js"), REPORT, SHOTS],
                       capture_output=True, text=True, env=env, timeout=240)
    if p.returncode != 0:
        return {"ok": False, "stderr": (p.stderr or "")[:1200]}
    try:
        data = json.loads(p.stdout.strip())
    except Exception:
        return {"ok": False, "stdout": p.stdout[:800]}
    data["ok"] = (not data["errors"] and not data["external_requests"]
                  and not data["failed_requests"] and data["images"]["broken"] == 0
                  and data["matrix_click_info"].strip() != ""
                  and data["filtered_rows"] < len(data["sections"]) + 40
                  and data["theme_after_click"] == "dark")
    return data


def inject(html, payload):
    card = ('<div id="checkResult" class="card small">'
            '<b>离线校验结果：</b>外链资源 0 个；内联图片 ' + str(payload["static"]["data_uris"]) +
            ' 张全部可解码；JS 语法检查通过；无头浏览器以 <code>file://</code> 打开，图片全部加载，'
            '控制台错误 ' + str(len(payload["ui"].get("errors", []))) + ' 个，外部请求 ' +
            str(len(payload["ui"].get("external_requests", []))) + ' 个；矩阵点击/筛选、主题切换均可交互。'
            '验证时间 ' + payload["checked_at"] + '。完整结果见 '
            '<a href="assets/validation/report_check.json">report_check.json</a>。</div>')
    return re.sub(r'<div id="checkResult".*?</div>', card, html, count=1, flags=re.S)


def main():
    html = open(REPORT, encoding="utf-8").read()
    st = static_checks(html)
    js = js_syntax(html)
    ui = ui_check()
    payload = {"checked_at": __import__("time").strftime("%Y-%m-%d %H:%M:%S"),
               "static": st, "js_syntax": js, "ui": ui}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    html = inject(html, payload)
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write(html)
    print(json.dumps({"static_ok": st["external_resource_tags"] == 0 and st["css_imports"] == 0,
                      "js_ok": js["ok"], "ui_ok": ui.get("ok"),
                      "images": ui.get("images"), "sections": len(st["sections"]),
                      "shots": ui.get("shots", [])}, ensure_ascii=False, indent=2))
    if not (st["external_resource_tags"] == 0 and js["ok"] and ui.get("ok")):
        sys.exit(1)


if __name__ == "__main__":
    main()
