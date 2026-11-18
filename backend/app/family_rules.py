"""家族识别规则 —— **自动生成，勿手改**。

由 scripts/gen-family-rules.mjs 从 web/src/app/core/cover.ts 的 FAMILIES 抽取。
前端那份是唯一权威；改家族识别请改 cover.ts，然后重新生成：

    node scripts/gen-family-rules.mjs

校验（提交前 / CI）：

    node tests/family-table-sync.mjs

**顺序敏感**：具体家族必须排在通用家族前面 —— 匹配按顺序取第一个命中。
前端正则都带 i 标志，后端统一用 re.I 匹配，两边行为一致。
"""

from __future__ import annotations

FAMILY_RULES: tuple[tuple[str, str], ...] = (
    ('sd3', r'sd[\s._-]?3(?:[._]?5)?|stable[\s._-]?diffusion[\s._-]?3'),
    ('sd15', r'sd[\s._-]?v?1[._]?5|stable[\s._-]?diffusion[\s._-]?v?1'),
    ('illustrious', r'illustrious'),
    ('noobai', r'noob[\s._-]?ai'),
    ('sdxl', r'sdxl|sd[\s._-]?xl|stable[\s._-]?diffusion[\s._-]?xl'),
    ('pony', r'pony'),
    ('krea', r'krea'),
    ('zimage', r'z[\s._-]?image'),
    ('hidream', r'hidream'),
    ('ernie', r'ernie|文心'),
    ('chroma', r'chroma'),
    ('hunyuan', r'hunyuan|\bhyv\b|混元'),
    ('ltx', r'\bltx[\s.-]?v?\b'),
    ('wan', r'\bwan[\s._-]?2|\bwan\b|wan2|万相'),
    ('flux', r'flux'),
    ('qwen', r'qwen|通义千问|千问'),
    ('minimax', r'minimax|\bmmx\b'),
    ('cogvideo', r'cogvideo'),
    ('kolors', r'kolors|可图'),
    ('mochi', r'mochi'),
    ('lumina', r'lumina'),
    ('skyreels', r'skyreels'),
    ('kandinsky', r'kandinsky'),
    ('playground', r'playground'),
    ('pixart', r'pixart'),
)
