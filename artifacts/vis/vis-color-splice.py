"""把生成的章节片段拼进 reference/color.html。

幂等：片段带 BEGIN/END 标记，重复运行时替换标记之间的内容，
不重复插入，也不动标记以外的正文（页面导语的改写因此不受影响）。
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "artifacts" / "vis" / "reference" / "color.html"
FRAG = ROOT / "artifacts" / "vis" / "_work" / "color_sections.html"
BEGIN = "<!-- BEGIN vis-color-sections -->"
END = "<!-- END vis-color-sections -->"

html = TARGET.read_text(encoding="utf-8")
frag = FRAG.read_text(encoding="utf-8").strip()

if BEGIN in html and END in html:
    head, rest = html.split(BEGIN, 1)
    _, tail = rest.split(END, 1)
    html = head + frag + tail
    TARGET.write_text(html, encoding="utf-8")
    print("已替换标记区间：%s（%d 字符）" % (TARGET, len(html)))
elif 'id="s-16"' in html:
    # 旧版：没有标记的初版片段。片段一直铺到 </section> 前，按起点精确切掉再插入。
    legacy = "<style>\n/* 本页新增：家族色 / 任务色的四槽色带"
    tail_marker = "</section>\n    </div>"
    i = html.index(legacy)
    j = html.index(tail_marker, i)
    html = html[:i] + frag + "\n" + html[j:]
    TARGET.write_text(html, encoding="utf-8")
    print("已替换旧片段：%s（%d 字符）" % (TARGET, len(html)))
else:
    anchor = "</section>\n    </div>"
    if anchor not in html:
        raise SystemExit("锚点未找到：%r" % anchor)
    html = html.replace(anchor, frag + "\n" + anchor, 1)
    TARGET.write_text(html, encoding="utf-8")
    print("已写入 %s（%d 字符）" % (TARGET, len(html)))
