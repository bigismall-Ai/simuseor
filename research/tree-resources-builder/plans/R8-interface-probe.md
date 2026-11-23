# R8 · 白模接口探针（R8.0 / R8.1）

> 所属：`research/tree-resources-builder` · 本轮新增，**不改 R0–R7 的脚本与既有产物**。
> 约束继承 `plans/PLAN.md` §0：纯 CPU｜禁 3D 生成式模型｜LLM 仅云端 API｜白模分几何/非几何层。
> 下游现状：**本地模型尚未接入**；本阶段只把「白模视频 → prompt → 本地模型请求 → 自检」这条接口做成可运行的闭环。

---

## 0. 一句话

R8.0/R8.1 产出的是**给本地模型吃的输入包**，不是成片：

> 中性灰白模 MP4 + 从几何量出的 prompt + 参考绑定 + 叙事时间线 + 机器可读的 request / 评分表 + 31 项自检。

三个镜头已经跑通：`shot_dolly_in`、`shot_orbit`、`shot_follow`，每个 5 秒 / 24fps / 720×404 / 120 帧，**93/93 检查通过**。

---

## 1. 本轮拍板与边界

| 项 | 决定 | 理由 |
|---|---|---|
| 下游模型 | 先不接；后期以本地模型为主 | 接口先稳定，模型可替换 |
| 白模颜色 | **全灰**（中性灰材质，无 seg 调色板） | 避免视频模型把替身颜色渗进成片 |
| 优先级 | 先做 R8.0 接口探针 | 先证明接口可跑，再谈 LLM 镜头规划 |
| 落点 | `research/tree-resources-builder` | 复用 R0 契约、R1 条件图、R2 镜头包 |

**明确不做**：不接云端视频模型、不下载模型权重、不做下游画质 A/B、不改 `shot_spec.json` / `conditions/` / `camera/`、不做完整导演台。

---

## 2. 三个镜头的结果

| 镜头 | 运镜 | 景别（占画高估算） | 白模视频 | 首帧结算比 | 检查 |
|---|---|---|---|---|---|
| `shot_dolly_in` | 推镜 | 中景（0.550） | 120f / 5s / 24fps / 720×404 / H.264 | 0.756 | 31/31 |
| `shot_orbit` | 环绕镜 | 中景（0.535） | 同上 | 0.920 | 31/31 |
| `shot_follow` | 跟镜 | 中近景（0.638） | 同上 | 0.768 | 31/31 |

- 白模视频体积约 263–299 KB/条。
- 首帧结算比 = `f0→f1 帧差 ÷ f1→f2 帧差`；越接近 1 越正常，< 2 视为结算正常。
- `foreground_min` 0.610–0.684：前景（含地面）始终存在；另有 `subject_min` 0.012–0.026，证明主体（seg character）始终在画。
- `refs_status`：3 个镜头均为 `ready`（`@白模1` + `@图片1` + `@图片2` 全部就绪）。参考图：`assets/refs/r8/character_ref_v1.jpg`、`scene_ref_v1.jpg`。

---

## 3. 产物结构（每个镜头包内新增）

```text
shots/<shot_id>/
├── clay/
│   ├── frame_0000.jpg … frame_0119.jpg   # 中性灰白模帧（单通道 JPEG）
│   ├── clay.mp4                          # H.264，本地模型首选
│   ├── clay.avi                          # MJPEG 兜底（无 ffmpeg 时）
│   ├── contact_sheet.jpg                 # 8 帧联系表
│   └── index.json                        # 帧数/前景比/主体比/首帧结算/材质口径
├── narrative.json                        # 角色/场景/风格 + 时间线动作（可改）
├── prompt/
│   ├── prompt.md                         # 参考绑定版：事实表 + refs + 可粘贴 prompt
│   ├── prompt.json                       # 机读：measured + narrative + refs + 两个版本
│   ├── prompt_textonly.md                # 不依赖参考图：白模 + 纯文字
│   └── prompt_textonly.json
├── refs/
│   ├── bindings.json                     # @图片1 / @图片2 的绑定状态
│   ├── refs.json                         # 继承/排除 + 绑定状态
│   └── images/                           # --bind 复制进来的参考图（自包含）
└── probe/
    ├── request.json                      # 给本地模型适配器的请求
    ├── score_sheet.json                  # 1–5 分评分表（人/VLM）
    └── result.mock.json                  # 仅验证接口的 mock 结果
```

全局读数：`assets/validation/r8_probe.json`（三镜头汇总 + 每项检查）。

---

## 4. 契约

### 4.1 prompt（`prompt/prompt.json`）

```json
{
  "kind": "r8_prompt",
  "schema": "r8-prompt/1",
  "shot_id": "shot_orbit",
  "move": { "type": "orbit", "label_zh": "环绕镜", "easing": "linear" },
  "duration_s": 5.0,
  "fps": 24,
  "resolution": [720, 404],
  "measured": {
    "lens_mm": { "start": 40.0, "end": 40.0, "min": 40.0, "max": 40.0, "mean": 40.0 },
    "distance_m": { "start": 4.2426, "end": 4.2426, "min": 4.2426, "max": 4.2426, "mean": 4.2426 },
    "camera_height_m": { "start": 1.5, "end": 1.5, "min": 1.5, "max": 1.5, "mean": 1.5 },
    "pitch_down_deg": { "start": 8.1301, "end": 8.1301, "min": 8.1301, "max": 8.1301, "mean": 8.1301 },
    "subject_height_ratio_mean": 0.5353,
    "subject_height_ratio_range": [0.523, 0.544],
    "shot_size": "中景",
    "centering_offset": 0.0534,
    "subject_in_frame_ratio": 1.0,
    "orbit_radius_m": 4.2,
    "orbit_angular_rate_deg_s": 14.12,
    "subject_motion": {
      "speed_mps": { "start": 0.471, "end": 1.155, "min": 0.0451, "max": 1.2371, "mean": 0.635 },
      "path_length_m": 3.148,
      "net_displacement_m": 2.162
    }
  },
  "refs": [ ... ],
  "prompt": "【参考声明】…",
  "negative": [ ... ],
  "source": { "shot_spec": "shot_spec.json", "intrinsics": "camera/intrinsics.json",
              "validation": "validation_report.json", "clay": "clay/clay.mp4" },
  "status": "ready"
}
```

**硬规则**：`measured` 的每个数字都来自 `camera/intrinsics.json` 或 `validation_report.json`，不手写；改白模后重跑 `r8_probe.py`。

R8.1 追加字段：`narrative`（角色/场景/风格/时间线）、`refs_status`（`ready` / `partial` / `blocked`）、`prompt_text_only`、`variants`。`prompt_textonly.json/md` 不依赖 `@图片`，只吃白模 + 文字，适合本地模型先跑通运镜。

### 4.2 refs（`refs/refs.json`）

| token | 文件 | 继承 | 不继承 | 当前状态 |
|---|---|---|---|---|
| `@白模1` | `clay/clay.mp4` | 运镜、景别、主体走位、遮挡关系、时间节奏 | 材质、颜色、身份 | ready |
| `@图片1` | 待绑定 | 身份、服装、长相 | 机位、构图 | unbound |
| `@图片2` | 待绑定 | 材质、光线、色调、氛围 | 机位、走位 | unbound |

`@白模1` 同时给出别名 `@视频1` / `@Clay Render 1`，按下游模型语法选用。

绑定状态在 `refs/bindings.json`；`--bind "@图片1=path/char.png"` 会把图复制进 `refs/images/` 并更新 `refs_status`，`--unbind` 撤销。当前三个镜头均为 `ready`：`@图片1` = 成年男性角色图，`@图片2` = 日间城市街道图；参考图在 `assets/refs/r8/`。

参考图建议：

- `@图片1`：角色正面/半身/全身，背景干净，PNG/JPEG，长边 ≥ 1024；
- `@图片2`：16:9 场景/风格图，能看清材质、光线、色调，长边 ≥ 1280；
- 两张都绑定后 `refs_status=ready`；只绑一张是 `partial`；都不绑仍可用 `prompt_textonly.md`。

### 4.3 request（`probe/request.json`）

```json
{
  "kind": "r8_probe_request",
  "schema": "r8-probe/1",
  "shot_id": "shot_orbit",
  "move_type": "orbit",
  "inputs": {
    "clay_video": "clay/clay.mp4",
    "clay_video_fallback": "clay/clay.avi",
    "clay_contact_sheet": "clay/contact_sheet.jpg",
    "prompt_md": "prompt/prompt.md",
    "prompt_json": "prompt/prompt.json",
    "refs": "refs/refs.json"
  },
  "expected": {
    "duration_s": 5.0, "fps": 24, "resolution": [720, 404], "frames": 120,
    "move_type": "orbit", "shot_size": "中景",
    "subject_height_ratio_mean": 0.5353,
    "checks": ["运镜路径与起幅/落幅一致", "主体在画、景别与占画高一致",
               "切点/时长/节奏一致", "无颜色泄漏、无轨迹线/坐标轴"]
  },
  "output_contract": {
    "video": "probe/generated.mp4",
    "metadata": "probe/result.json",
    "required_fields": ["kind", "schema", "shot_id", "model", "run_id", "seed",
                        "video", "duration_s", "fps", "resolution", "status"],
    "status_values": ["ok", "failed", "mock"]
  },
  "status": "ready"
}
```

### 4.4 result（本地模型适配器写 `probe/result.json`）

```json
{
  "kind": "r8_probe_result",
  "schema": "r8-result/1",
  "shot_id": "shot_orbit",
  "model": "wan2.2-local",
  "run_id": "20261123-1530-orbit-01",
  "seed": 1234,
  "video": "probe/generated.mp4",
  "duration_s": 5.0,
  "fps": 24,
  "resolution": [720, 404],
  "status": "ok",
  "prompt_sha256": "…",
  "notes": ""
}
```

`r8_probe.py --check` 会检查：字段齐全、`status ∈ {ok, failed}`、`status=ok` 时视频存在。

### 4.5 评分表（`probe/score_sheet.json`）

六项 1–5 分：`camera_path` / `blocking` / `framing` / `timing` / `identity_material` / `artifacts`。

**不要用总分替代单项**；运镜或走位不过关时，先看 `camera_path` / `blocking`。

---

## 5. 机器自检（31 项/镜头）

| 组 | 检查 |
|---|---|
| 镜头包 | `SHOT_SPEC` |
| 白模 | `CLAY_INDEX` / `CLAY_VIDEO` / `CLAY_FRAMES` / `CLAY_COUNT` / `CLAY_FOREGROUND` / `CLAY_SUBJECT` / `CLAY_FIRST_FRAME` / `CLAY_GRAY` |
| 视频 | `CLAY_DURATION` / `CLAY_FPS` / `CLAY_RESOLUTION` |
| prompt | 7 个文件存在（含 `narrative.json` / `refs/bindings.json`）+ `PROMPT_STATUS` / `PROMPT_FACTS` / `PROMPT_MOVE` |
| R8.1 | `NARRATIVE` / `TEXTONLY_FILES` / `TEXTONLY_CONTENT` / `TEXTONLY_FACTS` / `REFS_STATUS` |
| request | `REQUEST_STATUS` / `REQUEST_CONTRACT` |
| 接口 | `MOCK_RESULT`；`result.json` 存在时追加 `RESULT_FIELDS` / `RESULT_STATUS` / `RESULT_VIDEO`，不存在时记 `RESULT_OPTIONAL` 通过 |

**R8.0/R8.1 读数：3 镜头 × 31 项 = 93/93 通过。**

---

## 6. 本地模型接入（下一阶段）

适配器只做四件事，**不得修改 `clay/` 与 `prompt/`**：

1. 读 `probe/request.json`；
2. 用 `inputs.clay_video` + `inputs.prompt_md`（或 `prompt_textonly_md`）+ `inputs.refs` 调用本地模型；
3. 写 `probe/generated.mp4`；
4. 写 `probe/result.json`（字段见 §4.4）。

```bash
# 本地模型适配器的约定入口（示例，未实现）
python harness/r8_adapters/<model>.py --request shots/shot_orbit/probe/request.json
```

对本地模型的要求：

- 能吃 MP4（H.264）或 AVI（MJPEG）；
- 能接受 5 秒 / 24fps / 720×404 的参考视频；
- 能接受文本 prompt；
- 可选吃参考图（`@图片1` / `@图片2`）。

**当前没有绑定任何具体本地模型**；先用 `--mock` 验证接口，接入后 `--check` 会自动检查 `result.json`。

---

## 7. 已知限制（说清楚，不藏）

1. **参考图 v1 已绑定，但不是最终美术**：角色/场景是用户提供的第一版；场景图的停放车辆明显多于白模，若它过度影响遮挡/走位，换一张更空的街景或降低参考权重。
2. **叙事是默认动作**：`narrative.json` 已按运镜类型填了通用动作，但不是创作级；改 `narrative.json` 或 `--action`。
3. **主体高度有两个口径**：`subject_height_mean` 来自 seg character 可见像素，比 validation 的 3D 包围盒低约 0.06–0.08；prompt 仍以 validation 的权威值为准，seg 只用于“主体是否还在画里”。
4. **没有下游质量**：mock 只证明接口，不证明本地模型会听白模；真实 A/B 要等模型接入。
5. **只有 5 秒单镜头**：没有多镜头、转场、连续性。
6. **白模是粗代理**：车/人的比例和轮廓够控制，但不是成品级；这是白模定位，不是缺陷。
7. **没有运动模糊/运动向量**：视频模型只能从帧间变化推断速度。
8. **分辨率不是标准 16:9**：720×404 是现有镜头包的产物口径；接本地模型前可加 1280×720 档。
9. **只量第一个 actor**：`subject_motion` 取 `actors[0]` 的轨迹；多主体/对手戏需要扩成 per-subject 事实。

---

## 8. 下一步

| 阶段 | 内容 | 验收 |
|---|---|---|
| **R8.1** ✅ | 叙事时间线、参考图 v1、text-only 版本 | `narrative.json` 无 `[待填]`；`@图片1/@图片2` 已绑定；`refs_status=ready`；`prompt_textonly.md` 不依赖 `@图片` |
| **R8.2** | 接一个本地模型适配器 | `probe/result.json` 齐全；`--check` 过；至少 3 个 seed |
| **R8.3** | 评分与帧级复核 | 六项评分落盘；抽帧检查朝向/景别/切点/首帧/地面洞 |
| **R8.4** | 15–30 秒多镜头 | sequence spec + 连续性检查 |

---

## 9. 命令

```bash
cd research/tree-resources-builder

# 全流程（clay + prompt + mock + check + 报告）
python harness/r8_probe.py --all

# 只重生白模视频
python harness/r8_probe.py --render --shots shot_dolly_in,shot_orbit,shot_follow

# 只重生 prompt / request / score
python harness/r8_probe.py --prompt --shots shot_orbit

# R8.1：绑定参考图（复制进 refs/images/，可用 --unbind 撤销）
python harness/r8_prompt.py shot_orbit --bind "@图片1=path/character.png"
python harness/r8_prompt.py shot_orbit --bind "@图片2=path/scene.png"

# 改叙事动作 / 角色 / 场景 / 风格
python harness/r8_prompt.py shot_orbit --action "主体沿街道行走，镜头绕主体转圈"
python harness/r8_prompt.py shot_orbit --subject "一个穿深色外套的成年人" --scene "雨夜街道"

# 只自检（快，不渲染）
python harness/r8_probe.py --check

# 单镜头
python harness/r8_probe.py --all --shots shot_orbit
```

自检报告：`assets/validation/r8_probe.json`。

---

## 10. 文件清单

| 文件 | 作用 |
|---|---|
| `harness/r8_clay.py` | normal + mask → 中性灰帧；联系表；MP4/AVI；首帧结算/前景/主体检查 |
| `harness/r8_prompt.py` | 量事实；narrative；refs 绑定；prompt + text-only；request；score；mock |
| `harness/r8_probe.py` | 编排 + 31 项自检 + `assets/validation/r8_probe.json` |
| `plans/R8-interface-probe.md` | 本文件 |
| `assets/validation/r8_probe.json` | 三镜头汇总读数 |
| `shots/<shot>/clay|prompt|refs|probe/` | 每镜头新增产物 |

> 现有 `shot_spec.json`、`conditions/`、`camera/`、`validation_report.json` 未改动；R8 只新增子目录与全局读数。
