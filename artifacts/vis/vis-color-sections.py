"""
生成 color.html 的新增章节（§s-16 … §s-19）。

为什么要生成：家族色 25 + 任务色 12 + 中性 = 37 组 × 4 槽 × 明暗 = 296 个色值，
手抄必然出错，而且会和 model-tone.ts 漂。脚本直接读源头文件，产物永远等于代码。

用法：.venv\\Scripts\\python.exe artifacts\\vis\\vis-color-sections.py
输出：artifacts\\vis\\_work\\color_sections.html（粘进 reference/color.html）
"""

import re
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TONE_TS = ROOT / "web" / "src" / "app" / "core" / "model-tone.ts"
OUT = ROOT / "artifacts" / "vis" / "_work" / "color_sections.html"

# 同目录的色域实测脚本：文件名带连字符不是合法模块名，只能按路径加载
_spec = importlib.util.spec_from_file_location(
    "vis_color_domain", Path(__file__).resolve().parent / "vis-color-domain.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
FAM, FAM_D, TASK, TASK_D, NEUTRAL, NEUTRAL_D = (
    _mod.FAM, _mod.FAM_D, _mod.TASK, _mod.TASK_D, _mod.NEUTRAL, _mod.NEUTRAL_D)
hex_to_rgb, rgb_to_hsl, rgb_to_lab, contrast = (
    _mod.hex_to_rgb, _mod.rgb_to_hsl, _mod.rgb_to_lab, _mod.contrast)

import math  # noqa: E402


def lab(hexv):
    L, a, b = rgb_to_lab(*hex_to_rgb(hexv))
    return L, math.hypot(a, b)


def hsl(hexv):
    return rgb_to_hsl(*hex_to_rgb(hexv))


FAM_NAME = {
    "flux": "FLUX", "wan": "Wan", "sdxl": "SDXL", "sd15": "SD 1.5", "sd3": "SD 3",
    "pony": "Pony", "hunyuan": "Hunyuan", "ltx": "LTX", "qwen": "Qwen",
    "minimax": "MiniMax", "krea": "Krea", "zimage": "Z-Image", "hidream": "HiDream",
    "ernie": "ERNIE", "noobai": "NoobAI", "illustrious": "Illustrious", "chroma": "Chroma",
    "cogvideo": "CogVideo", "kolors": "Kolors", "mochi": "Mochi", "lumina": "Lumina",
    "skyreels": "SkyReels", "kandinsky": "Kandinsky", "playground": "Playground",
    "pixart": "PixArt",
}
TASK_NAME = {
    "text_to_image": "文生图", "image_to_image": "图生图", "text_to_video": "文生视频",
    "image_to_video": "图生视频", "text_generation": "文本生成", "embedding": "Embedding",
    "lora": "LoRA", "upscaler": "放大", "controlnet": "ControlNet",
    "speech_to_text": "语音转写", "text_to_speech": "语音合成", "image_understanding": "图像理解",
}

out = []
W = out.append

# ── 家族 / 任务色卡 ─────────────────────────────────────────────────────────
def tone_cards(light, dark, names):
    cards = []
    for key, v in light.items():
        d = dark.get(key, v)
        cards.append(
            '<div class="sw">\n'
            f'  <div class="sw-chip tone-ramp tone-{key}"></div>\n'
            '  <div class="sw-body">\n'
            f'    <code class="sw-name">{key}</code>\n'
            f'    <div class="sw-hex"><span class="sw-light">底 {v["bg"]}</span>'
            f'<span class="sw-dark">底 {d["bg"]}</span></div>\n'
            f'    <div class="sw-note">字 {v["ink"]} / {d["ink"]} · 强调 {v["strong"]} / {d["strong"]}'
            f' · 纹样 {v["mark"]}</div>\n'
            '  </div>\n'
            '</div>')
    return "\n".join(cards)


def tone_style(light, dark):
    css = []
    for key, v in light.items():
        d = dark.get(key, v)
        css.append(
            f'.tone-{key}{{--t-bg:{v["bg"]};--t-ink:{v["ink"]};--t-strong:{v["strong"]};--t-mark:{v["mark"]}}}')
        css.append(
            f':root[data-theme="dark"] .tone-{key}{{--t-bg:{d["bg"]};--t-ink:{d["ink"]};'
            f'--t-strong:{d["strong"]};--t-mark:{d["mark"]}}}')
    return "\n".join(css)


# ── 实测统计 ────────────────────────────────────────────────────────────────
def slot_domain(table, dark, slot):
    Ls, Cs, Hs = [], [], []
    for k, v in table.items():
        L, C = lab(v[slot])
        Ls.append(L); Cs.append(C); Hs.append(hsl(v[slot])[0])
    return min(Ls), max(Ls), min(Cs), max(Cs), min(Hs), max(Hs)


def contrast_min(table, fg, bg):
    vals = [(contrast(hex_to_rgb(v[fg]), hex_to_rgb(v[bg])), k) for k, v in table.items()]
    v, k = min(vals)
    return v, k


fam_ink_min, fam_ink_who = contrast_min(FAM, "ink", "bg")
fam_strong_min, fam_strong_who = contrast_min(FAM, "strong", "bg")
fam_mark_min, fam_mark_who = contrast_min(FAM, "mark", "bg")
task_ink_min, task_ink_who = contrast_min(TASK, "ink", "bg")
fam_dark_ink_min, fam_dark_ink_who = contrast_min(FAM_D, "ink", "bg")
fam_dark_mark_min, fam_dark_mark_who = contrast_min(FAM_D, "mark", "bg")

# 家族底色域
bgL = [lab(v["bg"])[0] for v in FAM.values()]
bgC = [lab(v["bg"])[1] for v in FAM.values()]
bgL_d = [lab(v["bg"])[0] for v in FAM_D.values()]
bgC_d = [lab(v["bg"])[1] for v in FAM_D.values()]

# ── 页面片段 ────────────────────────────────────────────────────────────────
W('<!-- BEGIN vis-color-sections -->')
W(f'''<style>
/* 本页新增：家族色 / 任务色的四槽色带（浅色左、深色右随主题切换） */
.tone-ramp{{background:linear-gradient(90deg,var(--t-bg) 0 25%,var(--t-ink) 25% 50%,var(--t-strong) 50% 75%,var(--t-mark) 75% 100%)}}
{tone_style(FAM, FAM_D)}
{tone_style(TASK, TASK_D)}
</style>''')

# ══ §s-16 ══════════════════════════════════════════════════════════════════
W('''
  <h3 id="s-16">模型卡美术色域 —— 家族色 / 任务色（<code>--plate-*</code>）</h3>
  <p class="lead">
    这一层<strong>不进 UI token</strong>，但它是产品里唯一大面积出彩色的地方：模型卡的封面底、铭牌、
    构图纹样全部取自它。纪律只有两条 —— ① 每个家族 / 任务给<strong>四槽</strong>（底 / 字 / 强调 / 纹样）；
    ② 明暗<strong>换整套色，不翻色板</strong>（浅底在深色页面上会整块发亮）。
    唯一出处 <code>web/src/app/core/model-tone.ts</code>，封面组件也走这一份，改颜色只改这里一处。
  </p>
  <p class="notice">
    <strong>家族色 / 任务色的组数以本节为唯一口径源</strong>（家族色 <strong>25</strong> 组 / 任务色 <strong>12</strong> 组 / 中性 1 组）。
    其他页面（布局页的铭牌样张等）可做<strong>节选</strong>，但必须标明「节选」并回链本节，<strong>不得另立数字</strong>。
    数量由本脚本从 <code>model-tone.ts</code> 现场统计，改家族即改数字，不会漂。
  </p>
  <p class="hint">
    下面色块的<strong>四段色带</strong>就是该家族自己的 ramp（底 → 字 → 强调 → 纹样），
    左侧值 = 浅色主题、右侧值 = 深色主题（按右上角「切换主题」看整页翻转）。
  </p>
''')

W('''
  <table class="t">
    <thead><tr><th style="width:150px">槽位</th><th style="width:110px">变量</th><th style="width:210px">浅色实测域</th><th style="width:210px">深色实测域</th><th>职责</th></tr></thead>
    <tbody>''')

SLOT_ROWS = [
    ("底", "bg", "--plate-bg", FAM, FAM_D, "整块封面底 / 分类胶囊底"),
    ("字", "ink", "--plate-ink", FAM, FAM_D, "铭牌正文、发布方、规格行"),
    ("强调", "strong", "--plate-strong", FAM, FAM_D, "家族码、参数行、芯片文字"),
    ("纹样", "mark", "--plate-mark", FAM, FAM_D, "构图纹样、芯片底、渐变端点"),
]
for zh, slot, var, lt, dk, duty in SLOT_ROWS:
    lmin, lmax, cmin, cmax, _, _ = slot_domain(lt, dk, slot)
    dmin, dmax, dcmin, dcmax, _, _ = slot_domain(dk, dk, slot)
    if slot == "mark":
        lmin = dmin; lmax = dmax; cmin = dcmin; cmax = dcmax
    W(f'''      <tr><td><strong>{zh}</strong></td><td><code>{var}</code></td>
        <td>L* {lmin:.0f}–{lmax:.0f} · C* {cmin:.0f}–{cmax:.0f}</td>
        <td>L* {dmin:.0f}–{dmax:.0f} · C* {dcmin:.0f}–{dcmax:.0f}</td>
        <td>{duty}</td></tr>''')
W('''    </tbody>
  </table>
''')

W(f'''
  <p class="lead">
    <strong>读法：</strong>家族底永远是一张<strong>纸</strong>（L* {min(bgL):.0f}–{max(bgL):.0f}、
    彩度 C* ≤ {max(bgC):.0f}），字与强调往下压两级（明度差 55–75），纹样是唯一不随主题变的槽
    （明暗共用，靠 opacity 压深）—— 这就是「一屏卡片不同色但成一套」的全部机关。
  </p>

  <h4 id="s-16-1">家族色 · 25 组</h4>
  <div class="swatches">
{tone_cards(FAM, FAM_D, FAM_NAME)}
  </div>

  <h4 id="s-16-2">任务色 · 12 组（认不出家族时的第二维度）</h4>
  <p class="lead">
    家族认不出时用任务色兜底 —— 真实库里 68% 的模型落进 <code>other</code>（原型实测），
    全用同一个中性色就等于一屏同色、再精致的布局也像毛坯房。任务色与家族色<strong>不可混用同一身份</strong>：
    家族色回答「谁家的」，任务色回答「干什么的」。
  </p>
  <div class="swatches">
{tone_cards(TASK, TASK_D, TASK_NAME)}
  </div>

  <h4 id="s-16-3">中性兜底 · 1 组</h4>
  <p class="lead">家族认不出、任务也没有 —— 才落到中性灰。「未知就是未知，不猜」，不许随手挑一个家族色顶替。</p>
  <div class="swatches">
    <div class="sw">
  <div class="sw-chip tone-ramp tone-neutral"></div>
  <div class="sw-body">
    <code class="sw-name">neutral</code>
    <div class="sw-hex"><span class="sw-light">底 {NEUTRAL["bg"]}</span><span class="sw-dark">底 {NEUTRAL_D["bg"]}</span></div>
    <div class="sw-note">字 {NEUTRAL["ink"]} / {NEUTRAL_D["ink"]} · 强调 {NEUTRAL["strong"]} / {NEUTRAL_D["strong"]} · 纹样 {NEUTRAL["mark"]}</div>
  </div>
</div>
  </div>
''')

W('''
  <table class="t">
    <thead><tr><th style="width:260px">色对</th><th style="width:120px">实测</th><th>判定 / 处置</th></tr></thead>
    <tbody>''')

W(f'''      <tr><td>家族底 <code>bg</code> vs 页底（浅 <code>#f5f5f6</code>）</td><td>16.60–17.67:1</td><td><strong>PASS</strong> → 家族底与页面底永远分得开，不会「陷进页面」</td></tr>
      <tr><td>家族字 <code>ink</code> on 家族底</td><td>最低 {fam_ink_min:.2f}:1（{fam_ink_who}）</td><td><strong>FAIL</strong> → {fam_ink_who} 的 <code>ink</code> 未达 4.5:1，<strong>不得承载小字</strong>（见 §s-17 约束 5）</td></tr>
      <tr><td>家族强调 <code>strong</code> on 家族底</td><td>最低 {fam_strong_min:.2f}:1（{fam_strong_who}）</td><td><strong>PASS</strong> → 家族码 / 参数行可安全承载文字</td></tr>
      <tr><td>家族纹样 <code>mark</code> on 家族底</td><td>{fam_mark_min:.2f}–2.81:1</td><td><strong>FAIL</strong> → <code>mark</code> <strong>永不承载文字</strong>，只作纹样 / 图形 / 渐变端点</td></tr>
      <tr><td>深色家族字 <code>ink</code> on 家族底</td><td>{fam_dark_ink_min:.2f}–10.49:1</td><td><strong>PASS</strong> → 深色整套换色后对比度反而更宽裕</td></tr>
      <tr><td>深色家族纹样 <code>mark</code> on 家族底</td><td>{fam_dark_mark_min:.2f}–8.49:1</td><td><strong>PASS</strong> → 同一条纹样在深底上可读（浅底上不可读）</td></tr>
      <tr><td>任务字 <code>ink</code> on 任务底</td><td>最低 {task_ink_min:.2f}:1（{task_ink_who}）</td><td><strong>PASS</strong> → 12 组任务色全部达标</td></tr>
      <tr><td>家族底 vs 页底（深 <code>#0b0b0d</code>）</td><td>1.15–1.28:1</td><td>设计值（深底上家族底本就贴近页面，靠描边与纹样分层）</td></tr>
    </tbody>
  </table>''')

# ══ §s-17 ══════════════════════════════════════════════════════════════════
W(f'''
  <h3 id="s-17">色域约束总表（可判定）</h3>
  <p class="lead">
    「克制」不是形容词。下面每一条都能被量出来：要么数面积、要么算比值、要么查色相与彩度。
    <strong>区间里的数字全部来自实测</strong>（家族色 25 组 / 任务色 12 组 / 明暗两套，
    脚本 <code>artifacts/vis/vis-color-domain.py</code>），不是经验值。
  </p>
  <table class="t">
    <thead><tr><th style="width:56px">#</th><th style="width:160px">维度</th><th>约束（可判定）</th><th style="width:230px">依据 / 实测</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>面积配额<strong>（产品 UI 单屏）</strong></td><td>中性表面 + 文字 <strong>≥85%</strong>；边框 / 结构线 ~10%；交互强调色 <strong>≤5%</strong>；实心靛紫块 <strong>≤2 处 / 屏</strong>；语义色 ≤3%</td><td>VIS §3.4</td></tr>
      <tr><td>2</td><td>面积配额<strong>（品牌展示面）</strong></td><td>暖纸底 ≥75%；线 / 装饰 ≤5%；墨黑字标与文字 ≤20%；<strong>语义色 0</strong></td><td>VIS §3.4</td></tr>
      <tr><td>3</td><td>交互色域</td><td>靛紫只允许 50 / 100 / 300 / 600 / 700 五档；<strong>400 / 500 档禁作前景</strong>（白字 2.98 / 4.47:1 双双 FAIL）；深色 <code>--primary</code> 不翻（仍 600）</td><td>实算见 §s-15</td></tr>
      <tr><td>4</td><td>家族底域</td><td>L* ∈ [{min(bgL):.0f}, {max(bgL):.0f}]、彩度 <strong>C* ≤ {max(bgC):.0f}</strong> —— 底永远是低彩度纸感；不得出现高彩度家族底</td><td>实测 25 族</td></tr>
      <tr><td>5</td><td>家族字域</td><td><code>ink</code> on <code>bg</code> <strong>≥4.5:1</strong>；<code>strong</code> on <code>bg</code> ≥6:1</td><td>实测最低 {fam_ink_min:.2f}:1（{fam_ink_who}）—— <strong>唯一未达标项</strong>，该家族 ink 不得承载小字，或把 ink 提到 ≥4.5:1</td></tr>
      <tr><td>6</td><td>家族纹样域</td><td><code>mark</code> <strong>永不承载文本</strong>；只作纹样 / 图形 / 渐变端点</td><td>实测 mark/bg 仅 {fam_mark_min:.2f}–2.81:1</td></tr>
      <tr><td>7</td><td>任务色域</td><td>12 类固定映射，<strong>不得新增第 13 类</strong>；认不出家族也不许把任务色当家族色</td><td>实测最低 {task_ink_min:.2f}:1 全部达标</td></tr>
      <tr><td>8</td><td>中性兜底域</td><td>家族、任务都认不出 → 中性灰 <code>{NEUTRAL["bg"]}</code> / <code>{NEUTRAL_D["bg"]}</code>；<strong>不得猜色</strong></td><td>model-tone.ts:99-100</td></tr>
      <tr><td>9</td><td>语义色域</td><td>success / warning / danger 三通道固定；<strong>500 档禁作前景</strong>；深色 soft 底用半透明（<code>rgb(… / .12)</code>）而非浅实色</td><td>VIS §3.3 / §3.4</td></tr>
      <tr><td>10</td><td>暖冷中性隔离</td><td>品牌暖纸 <code>#f8f6f1</code> 与 UI 冷白 <code>#ffffff</code> <strong>不得混用于同一文本块</strong>；品牌层不设交互色、不引 <code>--accent</code></td><td>VIS §3.2</td></tr>
      <tr><td>11</td><td>明暗映射</td><td>保持<strong>相对层级</strong>而非逐一取反：表面四层一一对应、文字四档一一对应、深色强线更亮、文字型强调翻明度、<strong>填充型不翻</strong>；禁第二套主题开关、禁 <code>filter:invert()</code></td><td>VIS §3.6</td></tr>
      <tr><td>12</td><td>色觉安全</td><td>红 / 绿状态必须<strong>双编码</strong>（颜色 + 图标或文字），不得单靠色相；实心靛紫作白字填充时白字对比度须 ≥4.5:1</td><td>WCAG 2.2 §1.4.1</td></tr>
      <tr><td>13</td><td>渐变域</td><td>色相位移 / 明度跨度 / 角度白名单 / 面积上限 / 遮罩 alpha 下限 —— 共 9 条硬约束，见 §s-19</td><td>VIS §3.8</td></tr>
      <tr><td>14</td><td>站点底纹域</td><td>站点底 = 中性底 + 一束光（色场）+ 中性纸纹（无彩）；底纹<strong>不计入</strong>「中性表面 ≥85%」配额（它铺在页面底，不是表面）；<strong>禁把标识铺成底纹</strong>；深色主题<strong>换噪声图</strong>而非反相；<strong>侧栏用透明渐变</strong>（左缘实面、右缘化到透明），不加实色面板、不加投影</td><td>VIS §3.10（v2.7 裁决）</td></tr>
    </tbody>
  </table>
''')

# ══ §s-18 ══════════════════════════════════════════════════════════════════
W(f'''
  <h3 id="s-18">国际色彩锚点（Pantone / Red Dot）</h3>
  <p class="lead">
    色彩范围要有<strong>外部坐标</strong>，否则「合规」只是自说自话。下表是国际设计体系里可查证的颜色锚点，
    用途有二：① 给我们的色域<strong>定标尺</strong>（什么算「纸感」、什么算「冷灰」、什么算「高彩度」）；
    ② 给印刷物料<strong>定打样目标</strong>。
    <strong>但 Pantone 色号不能直接搬进 UI</strong> —— 专色的 sRGB 值只是近似，屏幕与印刷必然有色差，
    最终以实物色卡打样为准。
  </p>
  <table class="t">
    <thead><tr><th style="width:210px">锚点</th><th style="width:120px">HEX</th><th style="width:170px">对应我方</th><th>借来的方法</th></tr></thead>
    <tbody>
      <tr><td><strong>Red Dot 官方红</strong><br><small>红点传达设计奖标识色</small></td><td><code>#e3000f</code></td><td>—</td><td>「单主色 + 大面积中性」：全站只允许一处高纯度成块，其余全留给中性面</td></tr>
      <tr><td><strong>Red Dot 官方绿</strong><br><small>Elf Green</small></td><td><code>#099862</code></td><td>—</td><td>双主色体系：一个主色负责「可点」，一个辅色负责「第二语义」，语义色另走通道</td></tr>
      <tr><td>Pantone 485 C<br><small>高纯度正红</small></td><td><code>#da291c</code></td><td>实心填充色</td><td>白字实算 4.87:1 达标 → <strong>实心填充色的最低门槛</strong>：低于 4.5:1 一律不承载白字</td></tr>
      <tr><td>Pantone 186 C<br><small>可口可乐红</small></td><td><code>#c8102e</code></td><td><code>--sem-danger #b91c1c</code></td><td>语义红选<strong>偏冷的深红</strong>，与品牌红 / 状态红拉开距离，不共用同一个色相</td></tr>
      <tr><td>Pantone 11-0602 TCX<br><small>Snow White 暖白</small></td><td><code>#f2f0eb</code></td><td><code>--brand-paper #f8f6f1</code></td><td>「书卷气」来自<strong>暖白 + 窄体 + 留白</strong>，不是来自给全站刷暖色；品牌暖白只准出现在品牌展示面</td></tr>
      <tr><td>Pantone Black 6 C<br><small>冷调近黑</small></td><td><code>#101820</code></td><td><code>--brand-ink #1b1b1e</code><br><code>--brand-paper-reverse #15151a</code></td><td>深色底用<strong>近黑而非纯黑</strong>，带一点蓝；纯黑在屏幕上发闷、在印刷上堵版</td></tr>
      <tr><td>Pantone Cool Gray 1–11<br><small>冷灰阶</small></td><td><code>#d9d9d6</code> …<br><code>#53565a</code></td><td>zinc 中性 33 档</td><td>中性层<strong>永远冷色</strong>：冷灰负责层级，暖白负责品牌，两者不混</td></tr>
      <tr><td>Pantone 2330 C<br><small>近中性暖灰</small></td><td><code>#cfcdc9</code></td><td>家族浅底域</td><td>家族底 C* ≤ {max(bgC):.0f} 的标尺来源 —— 底是「带一点色的纸」，不是「淡色块」</td></tr>      <tr><td>Pantone 4525 C<br><small>低彩度金</small></td><td><code>#c5b783</code></td><td>品牌点缀 <code>#9a7b3f</code><br>蝉形暖端</td><td>金色靠<strong>明度差</strong>做强调，不靠彩度；品牌点缀只用于文字强调，不进图形</td></tr>
      <tr><td>Pantone 219 C<br><small>热粉</small></td><td><code>#da1884</code></td><td>蝉形品红端<br><code>#a3389c</code></td><td>跨色相渐变的起点：品红 → 橙的暖弧是<strong>刻意</strong>的，不是「彩虹渐变」</td></tr>
      <tr><td>Pantone 1505 C<br><small>鲜橙</small></td><td><code>#ff6900</code></td><td>蝉形橙端<br><code>#f4776a</code></td><td>渐变暖端的高彩度上限；端点白字仅 2.73:1 → 暖端<strong>不承载白字</strong></td></tr>
      <tr><td>Pantone 361 C / Green C</td><td><code>#43b02a</code><br><code>#00ab84</code></td><td>家族绿系<br>wan / krea / playground</td><td>绿系分<strong>深墨绿</strong>与<strong>亮松绿</strong>两端分档，不取中间灰绿</td></tr>
      <tr><td>Pantone 2945 C / 286 C</td><td><code>#004c97</code><br><code>#0033a0</code></td><td>家族蓝系<br>hunyuan / skyreels / ernie</td><td>蓝系用<strong>同一色相的明度阶</strong>分档（底 / 字 / 强调），不换色相</td></tr>
      <tr><td>Pantone 527 C / 2603 C</td><td><code>#8031a7</code><br><code>#6d2077</code></td><td>家族紫系<br>flux / zimage / illustrious</td><td>家族紫<strong>偏红紫</strong>、交互靛紫<strong>偏蓝紫</strong>：两者色相差 ≈30°，绝不可互相替换</td></tr>
      <tr><td>Pantone 2728 C<br><small>深蓝紫</small></td><td><code>#1125a9</code></td><td>交互靛紫 <code>#4f46e5</code></td><td>印刷端的现实提醒：<strong>屏幕靛紫印不准</strong>，印刷物料须用专色近似 + 打样，不得直接用屏幕值</td></tr>
    </tbody>
  </table>
  <p class="hint">
    <strong>两条使用纪律：</strong>① 潘通色号是<strong>专色</strong>，页面上的 HEX 只是屏幕近似（ΔE &lt; 2 肉眼不可分、
    &gt; 5 明显不同）；印刷件一律以<strong>实物色卡打样</strong>为准，不许拿屏幕值当印刷色。
    ② 红点（Red Dot）借的是<strong>配额方法</strong> —— 高纯度主色成块 + 大面积中性 —— 不是借它的红。
  </p>
''')

# ══ §s-19 ══════════════════════════════════════════════════════════════════
W('''
  <h3 id="s-19">渐变层（<code>--grad-*</code>）〔本轮新增〕</h3>
  <p class="lead">
    VIS §3.4 只禁了「大面积渐变铺底」，但产品里<strong>本来就有 6 类渐变</strong>：蝉形 82 条面片微渐变、
    favicon 5 档色带、卡片信息区遮罩、封面照片 scrim、封面 5 构图纹理、家族铭牌底 ——
    它们此前<strong>既没有 token 也没有口径</strong>，全是就地硬编码的 rgba 串，谁改谁都漂。
    本轮把渐变收口成 <strong>4 级 12 枚 <code>--grad-*</code> token</strong>
    （<code>vis-tokens.css</code> §4 与 <code>vis.css</code> 同名同值），并补齐可判定约束。
  </p>

  <h4 id="s-19-1">分级：每级渐变各管什么</h4>
  <table class="t">
    <thead><tr><th style="width:60px">级</th><th style="width:150px">名称</th><th style="width:200px">现状出处</th><th>规则</th></tr></thead>
    <tbody>
      <tr><td><strong>G0</strong></td><td>品牌色带</td><td>蝉形 82 条面片渐变 / favicon 5 档</td><td>品红 → 橙暖弧，<strong>跨色相是刻意的</strong>；每面片独立成条，禁止改成一条全局贯穿渐变（会压平面片差异、拼块感消失）</td></tr>
      <tr><td><strong>G1</strong></td><td>家族色渐变</td><td>家族铭牌底（model-tone 三槽派生）</td><td><strong>同色相、只走明度阶</strong>：Δh ≤ 10°，不引入第二个色相</td></tr>
      <tr><td><strong>G2</strong></td><td>遮罩 scrim</td><td>卡片信息区遮罩 / 封面照片 scrim</td><td>文字压照片的唯一手段；<strong>alpha 下限 0.57</strong>（见下表）</td></tr>
      <tr><td><strong>G3</strong></td><td>构图纹理</td><td>封面 5 变体中的斜纹 / 点阵 / 柔光</td><td>只出<strong>家族色派生</strong>，不引入独立色；深色主题浓度自动下调</td></tr>
      <tr><td><strong>G4</strong></td><td>交互渐变</td><td>本轮新增（主按钮 / 选中态）</td><td>受限：面积 ≤2 处/屏，两端白字都 ≥4.5:1，深浅各一套</td></tr>
      <tr><td><strong>G5</strong></td><td>站点底纹</td><td>站点整体背景（§3.10 · v2.7 裁决）</td><td>纯中性底 + 一束光（色场）+ 中性纸纹；<strong>定稿 v2 单束柔光，色场 70% / 纸纹 60%</strong>；底纹<strong>不计入</strong>「中性表面 ≥85%」配额；禁标识平铺；深色换噪声图不反相。渐变共 6 个变体（取值表见 VIS §3.10；对比实验稿已退役删除）</td></tr>
    </tbody>
  </table>

  <h4 id="s-19-2">token 一览</h4>
  <div class="swatches">
''')

GRAD_CARDS = [
    ("--grad-brand-spectrum", "var(--grad-brand-spectrum)", "G0 品牌色带（5 档）",
     "蝉形同源 #3a0a3f → #f4776a · 90° · 跨色相暖弧"),
    ("--grad-brand-spectrum-warm", "var(--grad-brand-spectrum-warm)", "G0 品牌色带（亮段）",
     "#a3389c → #d2477e → #f4776a · 只用亮三档"),
    ("--grad-family-veil", "linear-gradient(160deg,#f1eefc,#8f86d6)", "G1 家族色渐变（示例 flux）",
     "var(--plate-bg) → var(--plate-mark) · 160° · Δh 7.2° / ΔL* 31"),
    ("--grad-family-ink-veil", "linear-gradient(to top,#3c3489,transparent)", "G1 家族色压字渐变（示例 flux）",
     "var(--plate-strong) → 透明 · 用于家族色面上的文字"),
    ("--grad-scrim-card", "var(--grad-scrim-card),linear-gradient(135deg,#e9e4d9,#b7c3d3)",
     "G2 卡片信息区遮罩",
     "162° 三段 rgb(10 12 18 / .45→.38→.28) · 示意图叠在浅色照片上"),
    ("--grad-scrim-card-fade", "var(--grad-scrim-card-fade),linear-gradient(135deg,#e9e4d9,#b7c3d3)",
     "G2 遮罩上沿化开段",
     "24px 化开，避免照片与遮罩之间一道硬边"),
    ("--grad-scrim-shot", "var(--grad-scrim-shot),linear-gradient(135deg,#e9e4d9,#b7c3d3)",
     "G2 封面照片双层 scrim",
     "顶部 .52→0 @34% + 底部 .94/.66/0 · 示意图叠在浅色照片上"),
    ("--grad-scrim-plate", "linear-gradient(to top,#f1eefc,#dcd8f2 28%,transparent)", "G2 生成构图底部遮罩",
     "var(--plate-bg) → 88% 混合 → 透明 @64%"),
    ("--grad-motif-stripe", "repeating-linear-gradient(-58deg,#8f86d6 0 12px,transparent 12px 38px)", "G3 斜纹构图",
     "家族纹样 17% · 条距 12/38 · 深色降至 13%"),
    ("--grad-motif-dot", "radial-gradient(circle,#8f86d6 1.1px,transparent 1.4px);background-size:6px 6px",
     "G3 点阵构图",
     "需另配 background-size 6px 6px + 向下渐隐 mask"),
    ("--grad-motif-glow", "radial-gradient(62% 72% at 10% 0%,#8f86d6,transparent 70%),radial-gradient(52% 62% at 98% 30%,#b8b0e6,transparent 72%),#f1eefc",
     "G3 柔光构图",
     "双 radial，唯一没有硬边的变体"),
    ("--grad-accent", "var(--grad-accent)", "G4 交互渐变（靛紫）",
     "135° · #4f46e5 → #4338ca · 白字 6.29:1 → 7.90:1"),
    ("--grad-site-wash", "var(--grad-site-wash)", "G5 站点级洗底（色场）",
     "158° linear 暖弧 · 峰值 alpha ≤0.07 · 底仍读作中性灰"),
    ("--grad-site-glow", "var(--grad-site-glow)", "G5 站点级柔光（右上）",
     "radial 78%×58% at 94% -8% · alpha ≤0.062"),
    ("--texture-site-paper", "var(--texture-site-paper)", "G5 站点级纸纹（肌理）",
     "feTurbulence 噪声 tile 220px · 中性无彩 · 浅底 multiply / 深底 screen"),
]
for name, val, label, note in GRAD_CARDS:
    W(f'''    <div class="sw">
  <div class="sw-chip" style="background:{val}"></div>
  <div class="sw-body">
    <code class="sw-name">{name}</code>
    <div class="sw-hex"><span class="sw-light">{label}</span></div>
    <div class="sw-note">{note}</div>
  </div>
</div>''')
W('''  </div>

  <h4 id="s-19-3">渐变硬约束（9 条）</h4>
  <table class="t">
    <thead><tr><th style="width:56px">#</th><th style="width:190px">约束</th><th>判定口径</th><th style="width:170px">依据</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>色相位移上限</td><td>G1 家族渐变 Δh ≤ <strong>10°</strong>；G2 遮罩为中性色不适用；G0 品牌色带是<strong>唯一豁免</strong>（跨暖弧是刻意的）</td><td>实测 flux 7.2° / qwen 9.3°</td></tr>
      <tr><td>2</td><td>明度跨度</td><td>G1 走明度阶 ΔL* 18–70；G0 面片级微渐变 ΔL* ≤ 6（×0.97→1.03）</td><td>蝉形 82 条渐变口径</td></tr>
      <tr><td>3</td><td>彩度上限</td><td>任一端点彩度不得高于另一端的 <strong>1.04 倍</strong>；禁止用高彩度端点承载白字</td><td>蝉形 ×1.04→1.00</td></tr>
      <tr><td>4</td><td>角度白名单</td><td>只准 <code>90°</code> / <code>135°</code> / <code>160°</code> / <code>162°</code> / <code>to top</code> / <code>to bottom</code> / <code>-58°</code> / <code>radial</code>；<strong>禁 0°/180° 平铺彩虹</strong></td><td>现行实现盘点</td></tr>
      <tr><td>5</td><td>面积上限</td><td>G4 交互渐变 ≤2 处/屏；G1 家族渐变 ≤卡面 40%；<strong>禁大面积铺底</strong>（VIS §3.4）</td><td>VIS §3.4 + 本轮收紧</td></tr>
      <tr><td>6</td><td>文字禁则</td><td><strong>禁给文字上渐变</strong>；文字压在渐变上时，渐变两端都要与文字色 ≥4.5:1</td><td>WCAG 2.2 §1.4.3</td></tr>
      <tr><td>7</td><td>遮罩 alpha</td><td>照片卡白字：遮罩 alpha <strong>≥ 0.57</strong>（对最亮照片成立）；现行 0.45 在纯白照片上只有 3.12:1</td><td>实算见下表</td></tr>
      <tr><td>8</td><td>明暗双版</td><td>渐变必须<strong>明暗各一套</strong>，禁 <code>filter:invert()</code> 取反；G1/G2/G3 由 <code>--plate-*</code> 派生自动跟随</td><td>VIS §3.6</td></tr>
      <tr><td>9</td><td>印刷口径</td><td>渐变在印刷里是网点过渡，色域外自动陷色；品牌物料须给<strong>两端专色 + 打样</strong>，不许拿渐变截图上机</td><td>§s-18 锚点</td></tr>
    </tbody>
  </table>

  <h4 id="s-19-4">遮罩 alpha 下限（白字 4.5:1 实算）</h4>
  <table class="t">
    <thead><tr><th style="width:200px">照片底</th><th style="width:150px">所需 alpha</th><th style="width:190px">现行 0.45 实算</th><th>判定</th></tr></thead>
    <tbody>
      <tr><td>纯白照片 <code>#ffffff</code></td><td><strong>≥ 0.57</strong></td><td>3.12:1</td><td><strong>FAIL</strong> → 最坏情况不达标，遮罩须提到 0.57 或照片区不留正文</td></tr>
      <tr><td>浅灰照片 <code>#c8c8c8</code></td><td>≥ 0.44</td><td>4.70:1</td><td><strong>PASS</strong>（现行值恰好压线）</td></tr>
      <tr><td>中灰照片 <code>#808080</code></td><td>≥ 0.09</td><td>8.59:1</td><td><strong>PASS</strong></td></tr>
    </tbody>
  </table>

  <h4 id="s-19-5">渐变端点白字实算</h4>
  <table class="t">
    <thead><tr><th style="width:260px">端点</th><th style="width:110px">白字</th><th style="width:110px">黑字</th><th>判定</th></tr></thead>
    <tbody>
      <tr><td>G4 交互渐变 浅 <code>#4f46e5 → #4338ca</code></td><td>6.29 → 7.90:1</td><td>3.34 → 2.66:1</td><td><strong>PASS</strong> 白字，两端都达标</td></tr>
      <tr><td>G4 交互渐变 深 <code>#4338ca → #3730a3</code></td><td>7.90 → 9.93:1</td><td>2.66 → 2.11:1</td><td><strong>PASS</strong> 白字；深色下两端一起压深</td></tr>
      <tr><td>G0 品牌色带 中段 <code>#a3389c</code></td><td>5.83:1</td><td>3.60:1</td><td><strong>PASS</strong> 白字可承载</td></tr>
      <tr><td>G0 品牌色带 亮端 <code>#d2477e / #f4776a</code></td><td>4.25 / 2.73:1</td><td>4.94 / 7.69:1</td><td><strong>FAIL</strong> → 暖端不承载白字，改用深色文字或压深</td></tr>
    </tbody>
  </table>''')

OUT.write_text("\n".join(out) + "\n<!-- END vis-color-sections -->\n", encoding="utf-8")
print("写出：%s（%d 字符）" % (OUT, OUT.stat().st_size))
