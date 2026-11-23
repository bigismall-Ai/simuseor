# R8 参考图 brief（给生成 agent）

> 用途：给 `research/tree-resources-builder` 的 R8 白模接口探针提供两张**最终观感**参考图。
> 两张图分别绑定到 prompt 的 `@图片1`（角色身份）与 `@图片2`（场景/材质/光线），
> **白模视频 `@白模1` 负责运镜/走位/节奏**，参考图只负责“长什么样”。
>
> 目录：`research/tree-resources-builder/assets/refs/r8/`

---

## 0. 先记住三条

1. **一张图只放一个主体**：角色图不要拼多视图/多人物；场景图不要有主角。
2. **参考图不要抢镜头**：角色图用中性背景；场景图用平视、16:9、无强前景遮挡。
3. **图文必须一致**：图的角色/服装/天气/时间，要和 `narrative.json` 的文字一致；不一致就改文字或重生成。

当前默认文字（见各镜头 `narrative.json`）：

- 角色：`一个成年人`
- 场景：`城市街道，两侧有建筑、行道树和停放车辆，路面有标线，远处有人群`
- 风格：`写实电影感，自然光`

如果生成的是“穿红色外套的年轻女性 / 雨夜街道”，就把 `narrative.json` 的 `subject` / `scene` / `style` 改成一致，别让图和文字打架。

---

## 1. 角色图（`@图片1`）

| 项 | 要求 |
|---|---|
| 用途 | 身份、脸、发型、服装、体型 |
| 不继承 | 机位、构图、走位、背景环境 |
| 人物 | **单人**，成年人；全身；手和脚完整入画 |
| 姿势 | 放松站立 / A-pose / 3/4 侧身；不要走路、不要大动作 |
| 表情 | 中性、闭嘴、看镜头；眼睛睁开 |
| 服装 | 目标服装；避免全白/全灰（会和白模混）；避免强反光/透明材质 |
| 背景 | **无缝中性浅灰**（约 `#c8c8c8`–`#d0d0d0`）；不要街道/房间/风景 |
| 光线 | 柔和主光 + 补光；不要彩色光、强轮廓光、硬阴影 |
| 镜头 | 50–85mm 等效，平视；全身留 5–10% 边距；不要广角畸变 |
| 比例 | 2:3 或 3:4（如 1024×1536 / 1200×1600） |
| 格式 | PNG 或高质量 JPEG（q≥95），sRGB，长边 ≥ 1280 |
| 数量 | 3 个候选，选 1 张；**不要拼图/多视图/contact sheet** |

**角色 prompt 模板（英文，按需替换方括号）：**

```text
Photoreal cinematic full-body character reference of [a 30-year-old adult,
short dark hair, dark jacket, dark trousers, simple shoes], standing in a
relaxed A-pose, facing three-quarter to camera, arms slightly away from the
body, feet fully visible, neutral expression, looking at camera, soft even
daylight, neutral light-gray seamless background, 50mm lens, eye level,
full body with margin, no props, no other people, no text, no logos,
no watermark, no motion blur, no dramatic shadows, sRGB, high detail, 2:3.
```

**角色 negative：**

```text
text, letters, watermark, logo, signature, border, frame, collage, contact sheet,
multiple views, multiple people, crowd, street background, room background,
walking pose, action pose, motion blur, cropped feet, cropped hands, extra fingers,
deformed hands, extra limbs, harsh flash, colored gel lighting, heavy vignette,
cartoon, anime, 3D render, clay render, plastic skin, oversaturated, low resolution
```

---

## 2. 场景图（`@图片2`）

| 项 | 要求 |
|---|---|
| 用途 | 材质、光线、色调、氛围、时间/天气 |
| 不继承 | 机位、主体走位、遮挡关系 |
| 内容 | 空街景 establishing shot；**没有主角**；前景无人；远处可极虚化路人（最好没有） |
| 布局 | 与白模大致同一类街道：道路、两侧建筑、行道树、路边停放车辆、路面标线 |
| 镜头 | 平视约 1.6m，35mm 等效，16:9；道路向画面中/右延伸；不要鱼眼/超广角/荷兰角 |
| 前景 | 不要大树/车/柱子挡住画面中心；不要强透视前景 |
| 光线 | 自然日光、软阴影、中性暖调、低饱和；不要霓虹/青橙/重滤镜 |
| 文字 | 不要可读文字/品牌/招牌；招牌只能虚化或抽象 |
| 动态 | 不要运动模糊、不要行驶中的车；停放车辆可以 |
| 比例 | 16:9（1920×1080 或 2560×1440） |
| 格式 | PNG 或高质量 JPEG（q≥95），sRGB，长边 ≥ 1280 |
| 数量 | 2 个候选（如阴天/午后），选 1 张；布局保持一致 |

**场景 prompt 模板：**

```text
Photoreal cinematic establishing shot of a quiet city street, natural daylight,
buildings on both sides, street trees along the sidewalks, parked cars at the curb,
clean road markings, empty foreground, no main subject, no people in the foreground,
eye-level camera at 1.6m, 35mm lens, 16:9, soft shadows, neutral warm grade,
muted realistic palette, subtle filmic texture, no text, no logos, no watermark,
no moving cars, no extreme perspective, no fisheye, no dutch angle, sRGB,
high detail, 1920x1080.
```

**场景 negative：**

```text
text, letters, watermark, logo, signature, border, frame, main subject, portrait,
close-up, foreground people, crowd, moving cars, motion blur, extreme wide angle,
fisheye, dutch angle, neon color cast, teal and orange, heavy vignette, harsh flash,
cartoon, anime, 3D render, clay render, oversaturated, low resolution, illegible signage
```

---

## 3. 两张图必须共享的风格

- 都是 **photoreal cinematic**，不是 3D/clay/cartoon。
- 同一套色彩：自然日光、中性暖调、低饱和、软对比。
- 角色图的皮肤/布料要真实；场景图的墙面/路面/树叶要真实。
- 不要一张写实、一张插画；模型会把风格打架带进成片。

建议两张图用**同一段 style block** 生成：

```text
photoreal cinematic still, natural daylight, soft shadows, neutral warm grade,
muted realistic palette, high detail, sRGB, no text, no logos, no watermark
```

---

## 4. 交付物

放到：

```text
research/tree-resources-builder/assets/refs/r8/
├── character_ref_v1.png
├── character_ref_v1.json
├── scene_ref_v1.png
└── scene_ref_v1.json
```

`*.json` 元数据（可选但强烈建议，便于复现）：

```json
{
  "kind": "r8_reference",
  "schema": "r8-reference/1",
  "slot": "@图片1",
  "role": "character_identity",
  "file": "character_ref_v1.png",
  "prompt": "…",
  "negative": "…",
  "model": "…",
  "seed": 123,
  "resolution": [1024, 1536],
  "style": "photoreal cinematic, natural daylight",
  "notes": "front 3/4, full body, neutral gray background"
}
```

场景图把 `slot` 改为 `@图片2`，`role` 改为 `scene_style`，分辨率改为 `[1920, 1080]`。

---

## 5. 验收清单

- [ ] 角色图：单人、全身、手脚完整、正面/3/4、A-pose、中性表情
- [ ] 角色图：中性浅灰背景，无街道/房间/道具/文字
- [ ] 角色图：服装与 `narrative.json` 的 `subject` 一致
- [ ] 场景图：16:9、平视、空街、无主角、无前景人、无行驶车辆
- [ ] 场景图：道路/建筑/树/停放车与白模大致同类，不要完全不同的空间
- [ ] 两张图：同一写实风格/色彩，无文字/水印/logo/边框/拼图
- [ ] 两张图：长边 ≥ 1280，sRGB，PNG/JPEG q≥95
- [ ] 每张至少 2–3 个候选，附 prompt/seed/model

---

## 6. 生成后怎么绑

把路径发回，或在仓库里直接运行：

```bash
cd research/tree-resources-builder

python harness/r8_prompt.py shot_dolly_in \
  --bind "@图片1=assets/refs/r8/character_ref_v1.png" \
  --bind "@图片2=assets/refs/r8/scene_ref_v1.png"

python harness/r8_prompt.py shot_orbit  --bind "@图片1=..." --bind "@图片2=..."
python harness/r8_prompt.py shot_follow --bind "@图片1=..." --bind "@图片2=..."

python harness/r8_probe.py --check
```

绑定后 `refs_status` 会从 `partial` 变成 `ready`；`--unbind "@图片1"` 可撤销。
