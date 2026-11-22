# 契约对齐矩阵 · CONTRACT-alignment-resources3D

> **所属**：`research/tree-resources-builder` · **阶段**：R6 · 与 resources3D 的契约对齐
> **对应 ROADMAP**：`plans/ROADMAP-IMAGE-VIDEO.md` §4「R6 · 与 resources3D 的契约对齐」
> **上游契约**：`plans/CONTRACT-conditions.md`（R0，唯一权威实现 `harness/condition_contract.py`）
> **对方目录**：`/Users/moc/workspaces/SiMuseor/resources3D` —— **全程只读，零改动**
> **可执行副本**：`harness/r6_alignment_check.py`（对齐矩阵的机器校验）+ `harness/r6_condition_metrics.py`（五类指标）
> **读数**：`assets/validation/r6_alignment.json`、`assets/validation/condition_metrics.json`、`assets/validation/cross_render_compare.json`
> **硬约束继承**：`plans/PLAN.md` §0 C1–C5（禁 3D 生成式模型｜全 CPU｜LLM 仅云端 API｜白模分几何层/非几何参考层｜交付物含可回读校验的真实生成物）
> **本阶段不做**：不改 resources3D 任何文件；不物理合并两个仓库；不引入 Blender 渲染运行时；不做下游图/视频 A/B。

---

## 0. 一页读法（60 秒）

**这份文档解决什么**：两套独立推进的工程（白模路线本仓 vs `resources3D`）要在同一份契约上干活。
R0 裁定了两个冲突，本阶段把「两边实际用到的字段、编码、坐标系、命名」**逐条摆到一张表上**，
每条给出**以谁为准**、**依据**、以及**机器可校验的读数**。

**本轮结论（一句话）**：**37 项对齐全部无冲突项**（25 pass / 6 已裁定冲突 / 6 单侧不适用 / **0 fail**）；
ROADMAP §2.6.3 点名的**三个「合并前必须先裁定的冲突」**（深度极性 / 上轴 / 像素行方向）
已全部裁定并**实跑复核**；交叉渲染在**当前代码**上重跑，depth 逐像素一致率 **100.00%**。

**六个已裁定的冲突**（逐条结论见 §4）：

| # | 冲突 | 裁定 | 一句话依据 |
|---|---|---|---|
| 1 | 深度极性 | **两边都「近=1 远=0」** | resources3D 的 `depth_to_unit` 实跑：1 m → 1.0、10 m → 0.0 |
| 2 | 上轴 | **各留各的**（本项目 Z-up / 对方 Y-up），边界处换算一次 | 换算矩阵 det=+1，往返换算误差 0.0 m |
| 3 | 焦距口径 | **以 sidecar 的 `f_px` 为唯一权威** | 720×404 下两边 f_px 差 1.78 倍（404 vs 720） |
| 4 | 相机空间 z 符号 | 本项目 z 前向为正 / 对方 z 后向为正，**都输出同一套像素与深度** | 图像层探针 + 交叉渲染 100% 一致 |
| 5 | 背面剔除 | 对方永不剔除 → 跨仓库比对时本项目显式 `cull_backfaces=False` | 函数签名实查 |
| 6 | **对方 `wmcore.project_points` 的 y 未翻转** | 行号一律以 `rasterize` / `eval.metrics` 的图像口径为准；**不要用 `project_points` 定位像素行** | 同一个「相机上方」的点：它给 213.33，光栅口径是 106.67 |

**新发现（第 6 条是本轮挖出来的）**：`resources3D` 内部 `wmcore.project_points` 与 `wmcore.rasterize`
对「行号」的约定**不一致**（前者数学口径、后者图像口径）。这不是本项目的 bug，但**跨仓库做像素定位时
踩到就会静默错位**。对方目录只读，改不了，所以裁定写在本契约里。

---

## 1. 范围与交付物（逐条对 ROADMAP R6）

ROADMAP §4「R6 · 与 resources3D 的契约对齐」的原始条目：

| 项 | 内容 |
|---|---|
| **目标** | 两套工作接到同一份契约上，并完成交叉验证 |
| **范围** | ① 深度极性/上轴/像素方向的最终裁定落码；② R3D `wmcore` 的 lineart/shade 与本项目实现的等价性比对；③ R3D `metrics_spec` 的五类 CPU 指标接入本项目 `validation_report`；④ 13 行覆盖矩阵与本项目类别矩阵对齐 |
| **交付物** | 契约对齐记录（并入本文 §2.6.3 的表格更新）；`assets/validation/condition_metrics.json` |
| **验收方式** | ① 同相机同场景在两套实现下渲染的深度图逐像素一致率 ≥ 99%；② 五类指标可在本项目产物上算出并落盘；③ 覆盖矩阵对齐表无空行 |
| **依赖** | R0、R1、R3 |
| **明确不做** | **不改 resources3D 目录任何文件**；不物理合并两个仓库；不引入 Blender 作为渲染运行时 |

### 1.1 逐条落地情况

| ROADMAP 范围项 | 落地情况 | 落点 |
|---|---|---|
| ① 深度极性/上轴/像素方向的最终裁定落码 | **达成**。三项裁定在 R0 已落码；本轮把「落码是否真的成立」变成**可执行校验**：极性用对方的 `depth_to_unit` 实跑复核，上轴用换算矩阵往返验，像素方向用**图像层**（不是投影函数）光栅验证 | 本文 §4 冲突 1/2/4 + `r6_alignment.json` 的 A03/A04/A05/A06/A11/A11b/A12 |
| ② `wmcore` 的 lineart/shade 等价性比对 | **达成**。lineart：随机 face_id 缓冲上**逐像素完全相同**（97×131，0 像素差异）→ 同算法。shade：**对方有、本项目没有**，但 shade 在对方那里也只是 `rasterize` 的附带输出、**从未进入它的条件图契约**（只有 `metrics_spec` 的 GPU G4 组把它当条件输入），而本项目按 ROADMAP R1「明确不做：不做 shade 通道」 → **结论：不适用，不是冲突** | 本文 §3 B 组 + `r6_alignment.json` 的 B05/B10 |
| ③ 五类 CPU 指标接入 `validation_report` | **部分达成，有明确缺口**。五类指标已在本项目真实产物上算出并落盘 `assets/validation/condition_metrics.json`（12 帧抽样）。**没并进 `assets/validation/validation_report.json`** —— 那份由 `harness/run_pipeline.py` 生成，要并进去必须改它（R0–R5 既有脚本，本轮分工不改）。R1 遇到的是同一个坎（见 `CONTRACT-conditions.md` §12.5.3），本轮沿用同一处理：先落独立读数，报告侧接线留给报告侧那条线 | 本文 §7 + `condition_metrics.json` + §9 遗留 3 |
| ④ 13 行覆盖矩阵与本项目类别矩阵对齐 | **达成**。13 行逐行给结论与依据，**无空行**；每行的「本项目证据」都回查 `assets/manifest.json` v2 的真实 category 计数 | 本文 §5 + `r6_alignment.json` 的 F01/F02/F03 |

### 1.2 交付物清单

| 路径 | 性质 | 内容 |
|---|---|---|
| `plans/CONTRACT-alignment-resources3D.md` | **新建** | 本文档：对齐矩阵 + 六个冲突裁定 + 覆盖矩阵 + 重跑读数 |
| `harness/r6_alignment_check.py` | **新建** | 只读对齐检查脚本（37 项，实跑数值验证） |
| `harness/r6_condition_metrics.py` | **新建** | 只读五类指标脚本（resources3D `eval/metrics.py` 口径） |
| `assets/validation/r6_alignment.json` | **新建** | 对齐检查读数（逐项 pass/fail + 证据） |
| `assets/validation/condition_metrics.json` | **新建** | 五类 CPU 指标读数（ROADMAP R6 指定的交付物） |
| `assets/validation/cross_render_compare.json` | **刷新** | R0 的交叉渲染读数在**当前代码**上重跑更新（§6） |
| `assets/previews/cross_render/*.png`（5 张） | **刷新** | 既有交叉渲染比对预览图，由同一脚本重跑覆盖（深度双方图 + 差异图） |

### 1.3 与 ROADMAP 原文的一处偏差（说明，不隐藏）

ROADMAP R6 的交付物写的是「契约对齐记录（**并入本文 §2.6.3 的表格更新**）」。
本轮**不改 `plans/ROADMAP-IMAGE-VIDEO.md`**（既有文件，分工明确），因此改为**新建独立文档**
`plans/CONTRACT-alignment-resources3D.md`，并在本节声明与 §2.6.3 的关系：

> **ROADMAP §2.6.3「合并前必须先裁定的三件事」现已全部裁定并实跑复核**：
> ① 深度极性 → §4 冲突 1；② 上轴 → §4 冲突 2；③ 像素行方向/投影约定 → §4 冲突 4 + §6 交叉渲染实测。
> 原表的三条「建议裁定」已被本轮读数证实，**不再需要修改 ROADMAP 原文**。

---

## 2. 判定词表与机器校验口径

### 2.1 四种判定

| 判定 | 含义 |
|---|---|
| `pass` | 两边一致，且**本轮实跑验证过**（不是读字符串对字符串） |
| `conflict_resolved` | **曾是冲突**，本契约已裁定；当前两边实现一致，或已按裁定显式对齐 |
| `n_a` | 单侧不适用（该通道/该概念在另一边不存在）→ **无冲突** |
| `fail` | 未对齐，需要处理 |

### 2.2 「实跑验证过」是什么意思

对齐检查脚本 `harness/r6_alignment_check.py` 对每一条都做**可执行的数值验证**，证据写进读数文件：

* **不**靠读源码字符串对字符串判「一致」；
* 深度极性 → 实跑对方的 `depth_to_unit`；
* 上轴 → 实算换算矩阵的 det / 正交性 / 往返误差；
* 深度度量 → 用「距机位 10 m 的正方形」探针，验它报 10.000 m（光轴深度）还是 10.0995 m（欧氏距离）；
* lineart 算法 → 随机 face_id 缓冲上逐像素比对；
* 深度插值 → 用**解析射线-平面交点**当真值，对同一个「地面」大平面验两边的光栅深度；
* 像素方向 → 在**图像层**光栅一块「相机正上方」的面片，看命中行区间；
* 覆盖矩阵 → 解析对方 §14 的 markdown 表，逐格查空。

### 2.3 只读纪律

* `sys.dont_write_bytecode = True` 在**任何 import 之前**设上 → 对方目录**不落一个 .pyc**。
* 对方模块用 `importlib.util.spec_from_file_location` 按文件路径加载，**不进 `sys.path`**（不污染对方的模块名空间）。
* 全程**不向对方目录写任何文件**；所有产物写回本仓 `assets/validation/`。
* 实测：对方目录 `.pyc` 计数 **26 → 26**（全部为本轮之前就存在的），**新增 0、删除 0**。

---

## 3. 对齐矩阵（37 项，逐条给以谁为准与依据）

> 完整证据见 `assets/validation/r6_alignment.json` 的 `checks[]`（每条含 `evidence` 与 `note`）。

### 3.1 A 组 · 全局约定（坐标 / 单位 / 深度口径）

| # | 项 | 本项目口径 | resources3D 口径 | 以谁为准 | 冲突? | 依据（实测） |
|---|---|---|---|---|---|---|
| A01 | 单位 | 米（`UNITS="meter"`） | 米（`wmcore` docstring「单位米」） | 契约 | 否 | 双方声明一致 |
| A02 | 手系 | 右手系 | 右手系 | 契约 | 否 | 换算矩阵 det=**+1**（真旋转，不改手性） |
| A03 | 上轴 | **Z-up** | **Y-up**（`wmcore.Y_UP=True`、`Camera.up=(0,1,0)`） | **各留各的**（契约 §3 定义边界换算） | **曾是冲突** | 边界一次换算，sidecar 永远写 Z |
| A04 | 换算可逆 | `zup_to_yup` / `yup_to_zup` | — | 契约 | 否 | 64 随机点往返**误差 0.0 m**；det=+1；正交误差 0.0 |
| A05 | 深度度量 | 沿光轴（相机空间前向轴） | 沿光轴（`cam_z` 取负） | 契约 §1 | 否 | 10 m 探针：两边都报 **10.000 m**，而非角点欧氏距离 **10.0995 m** |
| A06 | 深度极性 | **近=1 远=0** | **近=1 远=0** | 契约（= 对方既有口径） | **曾是冲突** | 实跑对方 `depth_to_unit`：1 m → **1.0**、10 m → **0.0** |
| A07 | 深度背景值 | 0.0（= 无穷远，与「远=0」自洽） | 0.0（`zeros_like` 后只写前景） | 契约 | 否 | 实跑：背景像素 = **0.0** |
| A08 | 深度归一化 | 按帧前景 min/max | `near=None`→前景 min、`far=None`→前景 max | 契约 | 否 | 同一组度量深度：两边公式输出**逐位相同**（d=(hi−z)/(hi−lo)） |
| A09 | 主点 | (W/2, H/2) | (W/2, H/2) | 契约 | 否 | 实算相等 |
| A10 | 焦距口径 | 垂直 FOV：`f_px = H/(2·tan(fov_y/2))` | 水平 sensor-fit：`f_px = focal/sensor·W` | **sidecar 的 `f_px`** | **曾是冲突** | 720×404 下：ours **404.0** vs theirs **720.0**（差 **1.78 倍**） |
| A11 | 像素方向 | 行 0 在上，y 向上为正 | 行 0 在上，y 向上为正 | 契约 §1.1 | 否 | **图像层**验证：相机上方面片的光栅命中行 **< 主点行**（两边都成立） |
| A11b | 对方工具函数的 y 翻转 | —— | `wmcore.project_points` **未翻转**；`rasterize`/`eval.metrics` **翻转** | **rasterize / metrics 的图像口径** | **是（本轮新发现）** | 同一「相机上方」点：`project_points` 给 **213.33**（主点之下），光栅口径应为 **106.67**（主点之上） |
| A12 | 相机空间 z 符号 | z **前向为正** | z **后向为正**（深度取负） | 各按自己的；**投影与深度结果一致** | 内部差异 | A11 图像层探针 + 交叉渲染 depth 100% 一致 |

### 3.2 B 组 · 通道编码

| # | 项 | 本项目口径 | resources3D 口径 | 以谁为准 | 冲突? | 依据（实测） |
|---|---|---|---|---|---|---|
| B01 | 通道闭集 | 6 个：depth/normal/seg/mask/lineart/pose | 4 个：depth/mask/lineart/shade | 契约 §2 | 否（覆盖面差异） | 共有 3；ours-only 3；theirs-only 1 |
| B02 | depth 位深 | 8bit 灰度 | 8bit 灰度（`save_png_gray`） | 契约 | 否 | 量化误差同量级（1/255≈3.9e-3） |
| B03 | mask 二值性 | {0,255}，无 AA/羽化/膨胀 | bool + `save_png_mask` → {0,255} | 契约 §2.4 | 否 | 实测本项目 `cond_mask.png` 全部像素取值 = **[0, 255]** |
| B04 | 前景定义 | z-buffer 命中的任何可见几何 | z-buffer 命中即前景 | 契约 §2.4 | 否 | 语义一致（隐藏几何只有本项目有这个概念） |
| B05 | lineart 算法 | `face_id_boundary_v1` | `wmcore.line_art_from_face_id` | 契约 §2.5 | 否 | 随机 face_id（97×131，seed 20261122）上**逐像素完全相同，0 像素差异** |
| B06 | lineart 线宽 | 1 px，无 AA | 1px 膨胀，无 AA | 契约 §2.5 | 否 | 两侧实现同构 |
| B07 | normal | 世界空间面法线 / **16bit 可逆** / 背景 (0,0,0) | **不产该通道** | **本项目** | n/a | 对方 `rasterize` 无 normal 输出 |
| B08 | seg | 固定调色板 `tree_resources_builder_fixed_v1`（**35 类**，两两不同色） | **不产该通道** | **本项目** | n/a | 无 label 的几何统一归 `other` |
| B09 | pose | 三视图闭集（coco18 / openpose25 / human_rig_21），规范视图 coco18 | **不产该通道** | **本项目** | n/a | 对方无对应实现 |
| B10 | **shade** | **契约闭集里没有**（ROADMAP R1「明确不做」） | `rasterize` 的附带输出（朗伯 0.25+0.75·\|n·L\|） | **契约闭集** | **n/a（不是冲突）** | shade 在对方那里**也从未进入条件图契约**（只有 `metrics_spec` 的 GPU G4 组把它当条件输入）→ R6 范围②的 shade 等价性结论 = **不适用** |
| B11 | 对方缺失通道 | normal/seg/pose | 均无 | 本项目 | n/a | 缺的是覆盖面，不是语义 |

### 3.3 C 组 · sidecar / 随图元数据

| # | 项 | 本项目口径 | resources3D 口径 | 以谁为准 | 冲突? | 依据（实测） |
|---|---|---|---|---|---|---|
| C01 | sidecar 七字段 | `resolution/f_px/near/far/encoding/up_axis/mask_semantics` | 无 sidecar 概念 | 契约 §4.1 | 否 | 扫描 `assets/conditions/r0_pack`：**7 文件 → 6 sidecar 全齐**（`all_ok=true`），第 7 个是关键点 JSON（非 sidecar，按 `kind` 跳过） |
| C02 | 对方要求的随图三样 | sidecar 七字段**已全覆盖** | `metrics_spec` §1.2 要求：①画幅+`f_px` ②`near/far` ③通道语义+主体投影口径 | 契约 | 否 | 逐文件回查：**0 个文件缺 `f_px`/`near`/`far`/`mask_semantics`** |
| C03 | sidecar 的 up_axis | 永远写 `"Z"` | Y-up 只出现在边界换算的现场 | 契约 §3.3 | 否 | 实测所有 sidecar 的 `up_axis` 取值集合 = **{"Z"}** |

### 3.4 D 组 · 光栅语义

| # | 项 | 本项目口径 | resources3D 口径 | 以谁为准 | 冲突? | 依据（实测） |
|---|---|---|---|---|---|---|
| D01 | 深度插值 | 透视校正 `d = 1/(w0/z0+w1/z1+w2/z2)` | 透视校正（2026-11-19 已修） | 契约 §1.1 | 否 | **对解析真值**：ours 最大误差 **1.65e-3 m**（float32）/ theirs **4.17e-12 m**（float64）；屏幕线性失效模式的量级是 **RMS 14.27 m** |
| D02 | 近平面裁剪 | 跨近平面的三角形裁成 1~2 个三角形 | Sutherland–Hodgman 裁成凸多边形后扇形三角化 | 各自实现，口径等价 | 否 | 前景像素里**无一个非有限深度**（两边各 0 个） |
| D03 | 背面剔除 | 可选，缺省 `True` | **永不剔除** | 跨仓库比对时**显式对齐** | 口径差异 | 函数签名实查：对方 `rasterize` 无 cull 开关；比对脚本显式置 `cull_backfaces=False` |
| D04 | 光栅精度 | float32 | float64 | 不裁定，由**容差**吸收 | 口径差异 | 残差最大归一化 **5.66e-6** / 最大度量 **0.209 mm**；主容差 1e-4 比 8bit PNG 量化细 25 倍 |

### 3.5 E 组 · 指标

| # | 项 | 本项目口径 | resources3D 口径 | 以谁为准 | 冲突? | 依据（实测） |
|---|---|---|---|---|---|---|
| E01 | 五类 CPU 指标 | **直接调用**对方 `eval/metrics.py`（不另抄一份） | a 边缘 / b 结构 / c 构图 / d 机位 / e 综合 | 对方 `eval/metrics.py` | 否 | 五类函数**全部存在**（`all_present` 全 true） |
| E02 | b′ 单目深度 | 未接入 | 接口位已留，实现抛明确异常、不静默降级 | 对方接口位 | n/a | 零 GPU / 零权重下载，**两边一样空着** |
| E03 | 本项目的调用点 | `harness/conditions.py::_condition_metrics` | 被调用方 | 本项目 | 否 | 源码里**逐个确认了五个调用点** |

### 3.6 F 组 · 覆盖矩阵与命名

| # | 项 | 本项目口径 | resources3D 口径 | 以谁为准 | 冲突? | 依据（实测） |
|---|---|---|---|---|---|---|
| F01 | 对方 13 行矩阵 | —— | `research/04-soma-x-taxonomy.md` §14 | 对方 | 否 | 解析出 **13 行**，**每格非空**（0 个空格） |
| F02 | 对齐表无空行 | 13/13 行有结论 + 有依据 | 13/13 行有结论 + 有依据 | 本文 §5 | 否 | `covered 8 / partial 5 / none 0`，**空行 0** |
| F03 | 类别命名 | manifest v2 的 `category`（小写下划线） | 只存在于研究文档的矩阵里，**无台账** | **本项目 manifest v2** | 否 | 本项目 19 个 category 全部映射到 13 行之一 |

---

## 4. 六个冲突点的明确结论

### 冲突 1 · 深度极性 —— 以本契约为准，两边统一为「近=1 远=0」

* **冲突是什么**：R0 之前本项目是「近=0 / 远=1」，`resources3D` 的 `wmcore.depth_to_unit` 是「近=1 / 远=0」—— **相反**，混用会**静默反相**且不报错。
* **裁定**：以 `plans/CONTRACT-conditions.md` §2.1 为准（= 对方的口径）。**不改对方任何文件**，本项目改过来即可。
* **依据**：`r6_alignment.json` 的 **A06** —— 实跑对方 `depth_to_unit`：深度 1 m 的像素 → **1.0**，深度 10 m 的像素 → **0.0**。本项目常量 `DEPTH_POLARITY="near_1_far_0"` / `DEPTH_NEAR_VALUE=1.0` / `DEPTH_FAR_VALUE=0.0`。
* **为什么这个方向是对的**：ControlNet 生态的深度图普遍是「近=白」，且对方的评估协议（`eval/out/t0_metrics.csv` 的 IoU 口径）本就按近=1 定的；改到与两者一致后，跨仓库可以直接比较，不用每次显式翻转。

### 冲突 2 · 上轴 —— 各留各的，边界处换算一次

* **冲突是什么**：本项目 Z-up（`scene_layout.json` 的 `up_axis:"Z"`），对方 Y-up（`wmcore.Y_UP=True`）。
* **裁定**：**两边各自保留内部上轴**（改对方成本高、且本轮明确不改对方文件）；跨边界用 `R = (x, z, −y)` 换算一次（det=+1 的真旋转）；**sidecar 的 `up_axis` 永远写 `"Z"`**，Y-up 只出现在边界换算的现场。
* **依据**：`r6_alignment.json` 的 **A03/A04** —— 换算矩阵 det=**+1.0**、正交误差 **0.0**、64 个随机点往返换算最大误差 **0.0 m**；**C03** —— 所有 sidecar 的 `up_axis` 取值集合 = **{"Z"}**。
* **为什么安全**：R 是真旋转 → 相机空间坐标逐项相同 → 投影像素与深度**只取决于 `f_px`**，与上轴无关。

### 冲突 3 · 焦距口径 —— 以 sidecar 的 `f_px` 为唯一权威

* **冲突是什么**：本项目按**垂直 FOV** 算 `f_px`，对方按**水平 sensor-fit** 算；同一个 (focal 36 mm, sensor 36 mm) 在非方形画幅下两边 `f_px` **不同**。
* **裁定**：**以 sidecar 的 `f_px` 为准**；`focal_mm` / `sensor_mm` 只作参考，不许下游自己重算。跨到对方时用 `focal_mm = f_px · sensor_width_mm / W` 反推。
* **依据**：`r6_alignment.json` 的 **A10** —— 720×404 画幅下，本项目（垂直 FOV）算出 **404.0**，对方（水平 sensor-fit）算出 **720.0**，**差 1.78 倍**；同一 `f_px` 反推回去两边都精确回到原值（ours 319.99999999999994 / theirs 320.0）。
* **注**：512×512 是正方形画幅，两种口径恰好相等 —— **所以正方形下测不出这个坑**，这也是当初要专门探它的原因。

### 冲突 4 · 像素行方向 / 投影约定 —— 以「行 0 在上」为准，且已用实测定案

* **冲突是什么**：ROADMAP §2.6.3 第 3 条点名「需做一次同相机同场景交叉渲染比对，以实测定案，不能凭读文档判断」。
* **裁定**：行 0 在上、y 向上为正（`row = H/2 − (y/z)·f_px`）。相机空间 z 符号两边相反（本项目前向为正 / 对方后向为正），但**都输出同一套像素与同一套光轴深度**。
* **依据（三重）**：
  1. **A11（图像层）**：一块位于「相机正上方 1 m、正前方 5 m」的面片，光栅后命中行区间 **ours [82, 126] / theirs [85, 127]**，主点行 **160** —— 两边都整段落在主点**之上**（差 1~3 行来自两侧 `f_px` 略不同：ours 277.1 / theirs 266.7）。
  2. **A12**：内部符号差异不影响输出（由上面两条 + 交叉渲染共同证明）。
  3. **§6 交叉渲染**：当前代码重跑，depth 逐像素一致率 **100.00%**。

### 冲突 5 · 背面剔除 —— 跨仓库比对时必须显式对齐

* **冲突是什么**：本项目 `render_conditions` 有 `cull_backfaces` 开关（缺省 `True`），对方 `rasterize` **永不剔除**。
* **裁定**：闭合物体上两者结果相同，但**开放面片上会不同** → 跨仓库比对时**显式**置 `cull_backfaces=False` 对齐对方。
* **依据**：`r6_alignment.json` 的 **D03** —— 函数签名实查确认对方无 cull 开关；`harness/cross_render_compare.py` 里已显式传 `cull_backfaces=False`。

### 冲突 6（本轮新发现）· 对方 `wmcore.project_points` 的 y 未翻转 —— 以 `rasterize` / `eval.metrics` 的图像口径为准

* **冲突是什么**：`resources3D` 内部对「行号」有两套约定：
  * `wmcore.rasterize`：`py = H − (f_px·y/z + cy)` → **图像口径**（行 0 在上）；
  * `wmcore.project_points`：`py = f_px·y/z + cy` → **数学口径**（**没翻转**）；
  * `eval/metrics.py` 的 `ray_basis` / `ray_design_matrix`：`u_y = −(row − cy)/f` → **图像口径**，与 `rasterize` 一致。
* **裁定**：**行号一律以 `rasterize` / `eval.metrics` 的图像口径为准**；跨仓库做像素定位时**不要用 `wmcore.project_points`**。
* **依据**：`r6_alignment.json` 的 **A11b** —— 同一个「相机正上方」的点：`project_points` 给行 **213.33**（落在主点行 160 **之下**，即"看起来在下方"），而光栅口径应是 `320 − 213.33 =` **106.67**（落在主点**之上**，即"看起来在上方"）。**符号完全相反**。
* **为什么必须钉死**：这正是「静默出错」那一类 —— 数字读起来完全合法，但上下颠倒。受影响的对方调用点：`research/harness/scene_pack.py:212`、`research/harness/tests/test_harness.py`（对方目录只读，改不了，所以把裁定写在本契约）。
* **对本项目的影响**：**无**。本项目的 `geomlib.Camera.project` 与渲染器同口径；R1 的关键点一致性测试（≤6.7e-04 px）也证明内部自洽。

---

## 5. 13 行覆盖矩阵对齐表（无空行）

**对方来源**：`resources3D/research/04-soma-x-taxonomy.md` §14「13 类资产表达层级 · 总矩阵」
（= 12 类资产 + 第 13 行横切的「验证闭环」；与 `research/05-synthesis.md` §1.2 同口径）。

**本项目来源**：`assets/manifest.json` v2 的 `assets[].category`（19 个 category，100 条资产）。
脚本对每一行都**回查 manifest 的真实计数** —— 映射里写的 category 在 manifest 里不存在，该行即判空。

| # | resources3D 类别 | 本项目对应 | 状态 | 本项目证据（manifest v2 实数） | 结论与依据 |
|---|---|---|---|---|---|
| 1 | 人物 | 人物 | **covered** | `character` **17**、`rig` **1** | SOMA-X 骨架 + 身份变体（R4 ⑤）；seg 里有 `character` 调色板类 |
| 2 | 服装 | 服装 | **partial** | `clothing` **2** | 贴合服装壳已入台账，但只有 2 件，**未成族** |
| 3 | 道具 | 道具 | **covered** | `prop` **23** | R4 ① CC0 零件库，带 LOD 与许可台账 |
| 4 | 载具 | 载具 | **covered** | `vehicle` **10**、`part_library` **1** | R4 ③ 四种同拓扑车身 + 语义零件库 + 动力学预设 |
| 5 | 建筑 | 建筑 | **partial** | `building` **1** | 建筑体块在街景与场景块里，但**独立台账条目只有 1 件**，未成族 |
| 6 | 大型场景 | 大型场景 | **covered** | `scene` **4**、`layout` **3** | R4 ④ 三种街区 + 分块 LOD + 公共件混排 + 布局表 |
| 7 | 生物/动物 | 生物/动物 | **partial** | `creature` **2** | 台账有 2 件生物资产；**未做骨架与比例体块工作流** |
| 8 | 植被与自然元素 | 植被与自然元素 | **covered** | `vegetation` **5**、`tree` **18** | R4 ② 六树种配方 + 三档 LOD + 实例化表 |
| 9 | 人群系统 | 人群系统 | **partial** | `crowd` **2** | 人群实例与共享底座已有；**实例化表未做 LOD 链与共享 Action** |
| 10 | 动作与表演数据 | 动作与表演数据 | **covered** | `motion` **1**、`rig` **1** | R0–R2 的关节序列（npz）+ 关键点闭集 + 运镜时序都是数据层产物 |
| 11 | 摄像机与空间参考 | 摄像机与空间参考 | **covered** | `camera` **1**、`shot` **1** | R2 镜头库 + `camera_intrinsics.json` + 镜头包目录；sidecar 带 `f_px` |
| 12 | 特效/破坏占位 | 特效/破坏占位 | **partial** | `fx` **2** | 有 FX 占位资产；**没有事件表 + 轨迹曲线这套数据载体** |
| 13 | 验证闭环（横切） | 验证闭环（横切） | **covered** | `convention` **1**、`recipe` **5** | R3 manifest v2 四项校验（id/fingerprint/license/validation）+ 本轮 R6 的机器校验读数 |

**汇总**：`covered` **8** / `partial` **5** / `none` **0** —— **空行 0**（ROADMAP R6 验收③ ✅）。

**命名口径（与 F03 对应）**：对方的 13 类是**研究分类**，本项目的 `category` 是**台账分类**——
两者语义对齐但**不是同一套命名空间**，所以跨仓库**不按名字直接对齐，按本表的行号对齐**。
本项目是权威（对方没有资产台账）。

**顺带印证了 ROADMAP §2.6.2 的第 4 条**（「13 行覆盖矩阵与本项目的 12/14 类覆盖矩阵可直接对齐，不必各自维护」）——
本表就是那个「可直接对齐」的实例，且**每行都有真实台账数字兜底**。

---

## 6. 交叉渲染比对（在当前代码上重跑，读数已更新）

**为什么必须重跑**：契约（R1 扩到六通道、契约版本升到 1.1.0）与资产（R4 补全了道具/植被/载具/场景/人物）都变了，
R0 那次的读数**不能沿用**。

* **脚本**：`harness/cross_render_compare.py`（R0 既有，本轮**未改**）
* **读数**：`assets/validation/cross_render_compare.json`（本轮**已刷新**）
* **同相机同场景怎么保证**：街景 22 个物体合并成**单一** (V, F)（**21 384 顶点 / 40 474 面**，两侧同一份）；
  用**同一个 `f_px = 512.0`** 定义，两边各自反推自己口径（ours 垂直 FOV 53.130102°；theirs 水平 sensor-fit 36/36）；
  实测两侧 `computed_f_px` 都 = **512.0**；坐标边界换算 `R=(x,z,−y)`；本项目侧 `cull_backfaces=False` 对齐对方。

### 6.1 新旧读数对照（**不是沿用旧值**）

| 指标 | R0 旧值（文档记录） | **R6 本轮重跑** | 判据 | 结论 |
|---|---|---|---|---|
| **depth 逐像素一致率（主指标，容差 1e-4 归一化）** | 100.00% | **100.00%** | ≥ 99% | ✅ |
| depth 一致率 @ 容差 1e-5 | 100.00% | **100.00%** | 参考 | — |
| depth 一致率 @ 容差 1e-6（最严档） | 97.74% | **97.7364%** | 参考 | — |
| depth 一致率 @ 容差 1e-3 | — | **100.00%** | 参考 | — |
| **mask 逐像素一致率** | 100.00% | **100.00%** | 前景集合完全相同 | ✅ |
| **lineart 逐像素一致率** | 99.993% | **99.99313%** | 参考 | — |
| lineart 差异像素 | 18 / 262 144 | **18 / 262 144** | 参考 | float32/float64 边界舍入 |
| depth 最大绝对差（归一化） | 5.66e-6 | **5.6619e-6** | 参考 | 浮点舍入 |
| depth 最大绝对差（度量，米） | 0.209 mm | **0.20932 mm** | 参考 | 浮点舍入 |
| depth 平均绝对差（度量，米） | 2.78 µm | **2.7849 µm** | 参考 | 浮点舍入 |
| 前景像素数（ours-only / r3d-only） | 0 / 0 | **0 / 0** | — | 前景集合逐像素相同 |
| 契约版本 | 1.0.0 | **1.1.0** | — | R1 扩到六通道 |
| 光栅耗时（ours / theirs / 总计） | — | **107.34 / 1086.73 / 1340.75 ms** | 参考 | 纯 CPU |

**结论**：主指标 **100.00% ≥ 99%**，ROADMAP R6 验收① **达成**。
本轮重跑与 R0 记录**逐项吻合**（差异只在小数末位）—— 这说明契约与资产虽已变，**光栅口径没被改坏**。

### 6.2 附带的第三个深度一致性证据（D01）

除逐像素比对外，本轮还把「透视校正插值」这件事**对着解析真值**验了一遍：
同一个「地面」大平面，用**解析射线-平面交点**当真值 ——

* 本项目（float32）：最大误差 **1.65e-3 m**，平均 **5.53e-5 m**
* resources3D（float64）：最大误差 **4.17e-12 m**，平均 **1.93e-13 m**

对比失效模式：屏幕线性插值在同一个探针上的量级是 **RMS 14.27 m**（对方 `metrics_spec` §7 实测）。
→ 两边都是透视校正，**不是**屏幕线性。

---

## 7. 五类 CPU 指标读数（resources3D `metrics_spec` 口径）

* **脚本**：`harness/r6_condition_metrics.py`（本轮新建）
* **读数**：`assets/validation/condition_metrics.json`（ROADMAP R6 指定的交付物）
* **口径来源**：直接调用对方 `eval/metrics.py`（**只读引用，不另抄一份**，避免口径漂移）
* **样本**：`shots/shot_001` 的 **12 帧等间隔抽样**（覆盖起幅/中段/收幅，不只取开头）

| 指标 | 本轮读数（中位） | R1 读数（中位） | 怎么读 |
|---|---|---|---|
| **a** 边缘一致（带容差 IoU / Chamfer） | **0.4446** / **5.5125 px** | 0.4363 / 5.787 px | 线稿 vs 参考帧边缘，容差 2 px |
| **b** 结构一致（Spearman / 分层残差） | **−0.4075** / **0.0346** | −0.4109 / 0.0359 | 负号来自参考帧是平面着色（远处更亮） |
| b 主体口径 Spearman | **+0.3325** | +0.3422 | 限定到主体掩码（过「弱保留 ≥0.25」线） |
| **c** 构图一致（前景 IoU / 高度占比偏差） | **0.0003** / **0.8329** | 0.0003 | 契约 mask 是「全部可见几何」，metrics 的前景估计是「主体」 |
| c 主体口径前景 IoU | **0.0000** | 0.0 | 估计器在整场景帧里选不出主角（`subject_recall_in_estimate = 0`） |
| **d** 机位一致（俯仰误差） | **0.1167°** | 0.118° | 判据 ≤2° 合格 ✅（依赖本契约的坐标系与深度口径） |
| **e** 综合评分 | **35.99** | 35.77 | 四分项等权 |

**诚实边界（三条，不藏）**：

1. 参考图是**本机确定性渲染帧**，**不是下游模型输出** → 这组读数量的是「条件图与同源渲染的**结构一致度**」，
   **不是**「下游保留度」。下游 A/B 按 ROADMAP 明确不做。
2. `metrics_spec` 的阈值来自对方**主体级合成自检**，对整场景帧（含天空与整条街）**不直接适用**
   → 这里**只报口径与读数，不做达标判定**。
3. `structure_spearman` 为负、构图 IoU 接近 0，都是**参考图/语义口径**造成的，不是条件图的对错
   —— 深度通道本身的对错由 §6 的交叉渲染 100% 一致保证。

---

## 8. 机器校验入口

### 8.1 对齐检查（37 项）

```bash
cd research/tree-resources-builder
/Users/moc/workspaces/SiMuseor/resources3D/venvs/df/bin/python harness/r6_alignment_check.py
# 读数 -> assets/validation/r6_alignment.json
```

| 项 | 值 |
|---|---|
| 对齐项总数 | **37** |
| `pass` | **25** |
| `conflict_resolved` | **6** |
| `n_a` | **6** |
| **`fail`** | **0** |
| 覆盖矩阵行数 | **13**（空行 **0**） |
| 耗时 | ~0.03 s（纯 CPU） |
| 退出码 | 0（存在 `fail` 时返回 2） |

读数文件 `assets/validation/r6_alignment.json` 的结构：
`summary` / `checks[]`（每条含 `id / group / item / question / authority / verdict / ours / theirs / evidence / note`）/
`coverage_matrix_13`（13 行 + 每行的 manifest 实数）/ `disagreements`（全部 `conflict_resolved` 与 `fail` 条目）/
`sources`（对方三份关键文件的 sha256 + 本仓契约模块的 sha256）。

### 8.2 五类指标

```bash
/Users/moc/workspaces/SiMuseor/resources3D/venvs/df/bin/python harness/r6_condition_metrics.py
# 读数 -> assets/validation/condition_metrics.json
```

### 8.3 交叉渲染（重跑）

```bash
/Users/moc/workspaces/SiMuseor/resources3D/venvs/df/bin/python harness/cross_render_compare.py
# 读数 -> assets/validation/cross_render_compare.json（已刷新）
```

**三个脚本都必须用带 `trimesh` 的解释器**：本机唯一可用的是对方 venv 里的
`resources3D/venvs/df/bin/python`（Python 3.11.16 / numpy 1.26.4 / trimesh 5.2.1 / scipy 1.17.1 / Pillow 13.0.0）。
**只用它读对方的文件，不写对方的目录。**

---

## 9. 本阶段遗留与没做到的（说清楚，不藏）

1. **五类指标没并进 `assets/validation/validation_report.json`**。
   那份由 `harness/run_pipeline.py` 生成，要并进去必须改它 —— 那是 R0–R5 既有脚本，本轮分工明确不改。
   本轮沿用 R1 的同一处理（见 `CONTRACT-conditions.md` §12.5.3）：指标落**独立读数** `condition_metrics.json`，
   **不手改一个下次 pipeline 就会覆盖的生成物**。要并进去，需要报告侧那条线在 `run_pipeline.py` 里加一段读它。
2. **ROADMAP R6 的交付物写的是「并入本文 §2.6.3 的表格更新」**，本轮**没改 ROADMAP 原文**，
   改为新建本文并在 §1.3 声明关系（§2.6.3 的三条建议裁定已全部被读数证实，**不再需要改原文**）。
3. **shade 通道没有等价性比对可做** —— 不是漏做，是**不适用**：shade 在对方那里也只是 `rasterize` 的附带输出、
   从未进入条件图契约；而本项目按 ROADMAP R1「明确不做」没有该通道。要真比对，得先有下游口径。
4. **对方的 `wmcore.project_points` 行号口径不一致，本轮**无法修**（对方目录只读）**，
   只能把裁定写进契约并在使用侧避开。** 影响面已查清：对方两处调用点（`scene_pack.py:212`、其自带测试）。
5. **`b′` 单目深度指标两边都空着** —— 零 GPU、零权重下载是硬约束，本轮**不接**。
6. **覆盖矩阵里 5 行是 `partial`**（服装/建筑/生物/人群/特效）—— 缺的都写在 §5 的「结论与依据」列里，
   本轮**只对齐、不补资产**（补资产是 R4 的活）。
7. **没有做下游图/视频模型 A/B 验证**（ROADMAP R6「明确不做」）。所有指标读数的参考图都是**本机渲染帧**，
   量的是「条件图 ↔ 同源渲染」的结构一致度。
8. **没有引入 Blender 渲染运行时、没有下载任何模型权重、没有用 3D 生成式模型**（PLAN.md C1–C5）。
   全程纯 CPU（`resources3D/venvs/df/bin/python`，本机 venv，零安装）。
9. **未提交、未推送、未建 PR、未切分支**；只新增本轮自己的 **5 个文件**
   （2 个脚本 + 2 个读数 + 1 份新文档），刷新 **1 个读数文件 + 5 张比对预览图**
   （均为既有的未跟踪产物，由 R0 既有脚本重跑覆盖）。**R0–R5 的既有脚本与产物一个都没改**。
   **对方目录零改动**：`resources3D` 全部 **1465** 条文件清单（path\|size\|mtime）**逐行一致**、
   `.pyc` 计数 **26 → 26**（新增 0、删除 0）、六份关键源文件 sha256 不变。

---

## 10. 关联文件

| 文件 | 关系 |
|---|---|
| `plans/CONTRACT-conditions.md` | **上游契约**（R0）。本文是它的「跨仓库对齐」专章，不替代它 |
| `plans/ROADMAP-IMAGE-VIDEO.md` §2.6.3 / §4 R6 | 本轮对应的路线条目（**只读引用，未改**） |
| `harness/condition_contract.py` | R0 契约的可执行副本（**只读引用，未改**） |
| `harness/conditions.py` | R0/R1 通道实现（**只读引用，未改**） |
| `harness/cross_render_compare.py` | R0 既有交叉渲染脚本（**只读引用，未改**；本轮只是**重跑**） |
| `harness/r6_alignment_check.py` | **本轮新建**：只读对齐检查 |
| `harness/r6_condition_metrics.py` | **本轮新建**：只读五类指标 |
| `assets/validation/r6_alignment.json` | **本轮新建**：对齐读数 |
| `assets/validation/condition_metrics.json` | **本轮新建**：五类指标读数 |
| `assets/validation/cross_render_compare.json` | **本轮刷新**：交叉渲染读数 |
| `resources3D/research/harness/wmcore.py` | 对方参考实现（**只读**） |
| `resources3D/eval/metrics.py` | 对方指标实现（**只读**） |
| `resources3D/eval/metrics_spec.md` | 对方指标协议（**只读**） |
| `resources3D/research/04-soma-x-taxonomy.md` §14 | 对方 13 行覆盖矩阵（**只读**） |

**变更记录**

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-11-22 | 1.0.0 | R6 首版：37 项对齐矩阵（25 pass / 6 conflict_resolved / 6 n_a / 0 fail）、六个冲突裁定、13 行覆盖矩阵对齐、交叉渲染当前代码重跑、五类指标落盘 |
