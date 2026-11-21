# Tree Resources Builder — 调研与架构设计计划表

> 目标：在「纯 CPU、无 3D 生成式模型、LLM 仅云端 API」约束下，调研可产出真人 AI 电影白模参考资产的技术范式，
> 提出候选架构，并以离线可视化报告交付（含**真实生成物**）。
>
> 本文档为活文档：状态、证据与结论均已回填；「执行记录」按时间追加。

## 0. 约束与边界（不可妥协）

| 编号 | 约束 | 对调研的直接影响 |
|---|---|---|
| C1 | 禁止 3D 生成式模型（扩散 / SDS / 原生 3D 生成器） | 排除 TRELLIS、Hunyuan3D、Tripo、Rodin、DreamGaussian 等；也排除「点云→CAD」的专用生成模型（如 CAD-Recode 的模型推理部分） |
| C2 | 禁止 GPU，本地全 CPU | 每条路线区分「CPU 可执行」与「仅 GPU」；本机所有生成/渲染/校验均为 CPU |
| C3 | LLM 仅云端 API | LLM 只生成代码/参数/结构；本地只做确定性执行与验证 |
| C4 | 白模分两层：几何白模 + 非几何参考 | 输出物区分 mesh 与 运动/相机/特效数据，分别定义验证方式 |
| C5 | 交付物必须含生成物 | 已交付 GLB/OBJ/STL/BVH/JSON/USDA + 预览图，并回读校验 |

本机资源基线（实测，2026-11-19）：

- Python 3.13.12（项目 `.venv`），系统另有 Python 3.9.25
- 已装 `numpy 2.5.4`、`trimesh 5.2.1`、`manifold3d 3.5.5`、`usd-core 26.11`、`Pillow`、`networkx`
- 未安装 Blender / OpenSCAD / FreeCAD（bpy 仅支持 Python 3.11，本机 3.13 不可装）
- Node.js 24 可用；Playwright（chromium-headless-shell 1255）用于报告离线渲染校验
- 网络：本机代理 `127.0.0.1:7890`；pip 需显式 `-i https://pypi.org/simple`

## 1. 阶段计划（最终状态）

| 阶段 | 内容 | 状态 | 证据 / 产物 |
|---|---|---|---|
| P0 | 建立目录、计划表、约束表 | ✅ 完成 | 本文件 |
| P1 | 调研 nvidia/SOMA-X：能力、输入输出、上下游、CPU 可行性、许可 | ✅ 完成 | `research/somax.md`（含本机三后端实测与五类引用资产许可矩阵） |
| P2 | 范式 A–F 候选方案检索与筛选 | ✅ 完成 | `research/paradigms.md`（含来源清单） |
| P3 | 搭建 CPU 确定性生成 harness，产出 12 类资产样本 | ✅ 完成 | `harness/geomlib.py`、`generate_assets.py`；`assets/geometry|nongeometry` |
| P4 | CPU 验证闭环 + 「失败→反馈→修复」演练 | ✅ 完成 | `harness/validate.py`、`run_pipeline.py`；`assets/validation/validation_report.json` |
| P5 | 离线自包含可视化报告 | ✅ 完成 | `report.html`（2.4 MB，34 张内联图、7 张 SVG 图） |
| P6 | 离线可用性 / 导出回读 / 结论复核 | ✅ 完成 | `report_check.json`、`exports.json`、`assets/validation/ui/*.png`、9 项公共资产清单 |
| P7 | 5 秒竖切片 shot_001（ANNY 步态 + 街景 + 推镜） | ✅ 完成 | 120 帧 / 24fps / 720×404；脚滑 0.47cm 均值、3.03cm 最大；入画 100%；MP4 + contact sheet |

## 2. 关键决策记录（Decision Log）

| 编号 | 决策 | 理由 | 代价 / 边界 |
|---|---|---|---|
| D1 | 几何主干采用「JSON 配方 + 白名单解释器（trimesh/manifold3d）」 | 可精确校验、可回滚、无需执行任意代码；本机可跑 | 表达力受解释器限制，复杂有机形态需参数化底座 |
| D2 | 统一汇合层用 `GLB + USDA + JSON + BVH`，不用某个 DCC 作为运行时 | CPU 可用、跨工具、可离线；USD 可承载相机时序与骨骼 | 需要自建契约与适配器 |
| D3 | 视觉验证用自研 numpy z-buffer 软光栅，而非 Blender 渲染 | 零 GPU、无重依赖、可脚本化；本机无 Blender | 无光照/材质的高级效果，但白模检查足够 |
| D4 | 人物底座选 SOMA-X（Apache-2.0）；用 Python 3.11 venv 实测三个可商用后端 | 许可安全 + CPU 路径明确；SOMA/MHR/ANNY 均可直接下载 | SMPL 家族不可匿名下载，且仅限非商用研究 |
| D5 | 动物/植被用「代理 + 参数化」，不尝试代码化写实有机形态 | 纯 CPU 无生成模型下的现实上限 | 明确记录为诚实边界 |
| D6 | 报告载体选单文件 HTML（内联 CSS/JS/SVG/base64 图） | 需交互矩阵与矢量图；离线分发不依赖目录 | 文件 1.2 MB，但可接受 |
| D7 | 商用人体链路只依赖 SOMA / MHR / ANNY 三个 Apache-2.0 后端 | 三者均可直接下载；SMPL 家族需账号且非商用 | 放弃 SMPL-X 的表情/手部生态，面部另议 |

## 3. 验收对照

| 验收项 | 结果 | 证据 |
|---|---|---|
| ≥3 种技术范式、每种有具体候选 | ✅ 6 种范式、24+ 候选 | `research/paradigms.md`、报告 §范式 |
| 架构不依赖 GPU / 生成式模型 | ✅ 全部 CPU 执行 | 本机实测（无 GPU 调用） |
| 12 类资产均有路径或边界说明 | ✅ 14 类覆盖（含飞机/轮船） | 覆盖矩阵 + 边界图 |
| 区分「已验证」与「待验证」 | ✅ 三级徽章 + V1–V5 状态 | 报告 §方法与 §最小验证 |
| 区分几何 / 非几何输出与验证 | ✅ 独立表格与验证器 | 报告 §生成物 |
| 至少一张覆盖矩阵 / 架构图 / 依赖图 | ✅ 全部具备 | 覆盖矩阵、架构 1/2、V1–V5 依赖图 |
| 离线可打开可交互 | ✅ 外链 0、图片 27/27、控制台错误 0、外部请求 0 | `assets/validation/report_check.json` |
| 生成物真实交付 | ✅ 70+ 个文件；24/24 导出回读通过 | `assets/manifest.json`、`assets/validation/exports.json` |
| SOMA-X 可下载复用性 | ✅ SOMA/MHR/ANNY 本机跑通；SMPL 家族需账号且非商用 | `assets/validation/soma_cpu_test.json` |

## 4. 风险与应对（最终）

| 风险 | 影响 | 应对 |
|---|---|---|
| 参数化人体底座许可（SMPL/SMPL-X 非商用、SMAL 研究许可） | 商用交付受阻 | 商用链路限定 SOMA-X（Apache-2.0）/ MakeHuman 导出（CC0） |
| bpy 与 Python 版本绑定 | 本机不可装 bpy | headless 进程隔离；本机用 trimesh/manifold 等价复现 |
| LLM 代码一次通过率低 | 废网格 | 验证前置 + 白名单配方 + 结构化 hint 修复 |
| 生物/植被有机形态质量差 | 观感差 | 代理表达 + 参数化底座（SMAL / L-system） |
| 场景规模 CPU 耗时 | 迭代慢 | 低模 + 实例化 + LOD（mid/low/xlow） |
| 汽车/服装参数化底座缺失 | 只能代理 | 内部模板库；列入后续建设 |
| 面部/口型缺失 | 特写受限 | 诚实边界，单独评估面部方案 |

## 5. 执行记录（按时间追加）

- 2026-11-19：环境探测；确认无 Blender/OpenSCAD/FreeCAD；pip 镜像异常定位（清华源不可用，改官方源 + 代理）。
- 2026-11-19：抓取 SOMA-X Model Card + GitHub README；确认 `device="cpu"`、77 关节、三档 LOD、USD/NPZ、Apache-2.0。
- 2026-11-19：安装 `trimesh 5.2.1`、`manifold3d 3.5.5`、`usd-core 26.11`、`networkx`；验证 CPU 几何与 USD 可用。
- 2026-11-19：完成 6 范式 / 24+ 候选调研，写入 `research/paradigms.md`。
- 2026-11-19：实现生成 harness（人物、服装、道具、汽车、轮船、建筑、四足、植被、人群、特效、动作、相机、场景）。
- 2026-11-19：实现验证器（水密/尺度/间隙/贴地/穿插/构图/BVH/特效/布局），修复 5 个由验证器捕获的问题（部件数上限、服装贴合计口径、根位移公式等）。
- 2026-11-19：闭环演练：坏参数（2.45 m、手臂外移）→ 2 项失败 → 参数修复 → 全部通过。
- 2026-11-19：生成 15/15 项验证通过；20/20 导出回读通过；渲染 15 张预览；导出 `scene_street.usda`（相机 87 关键帧、UsdSkel 22 关节）。
- 2026-11-19：生成 `report.html`；用 Playwright 以 `file://` 无网打开校验：外链 0、图片 17/17、控制台错误 0、外部请求 0，矩阵筛选与主题切换可用。
- 2026-11-19（追加 SOMA-X 实测）：用 `uv` 建 Python 3.11 venv，安装 `py-soma-x 0.3.6` + `torch 2.15.0+cpu` + `anny`；按需下载权重到 `var/soma-assets`（SOMA 原生 81 MB、MHR lod6 4 MB、ANNY 底座 3.6 MB）。
- 2026-11-19：跑通 SOMA 原生 / MHR / ANNY 三个后端 CPU 前向：4,505 顶点、9,006 面、水密，耗时 10.3 / 12.9 / 31.0 ms；导出 Z-up 落地 GLB 并渲染预览。
- 2026-11-19：确认五类引用资产许可与获取方式：SOMA/MHR/ANNY 为 Apache-2.0 可直接复用；SMPL/SMPL-X/MANO 仅提供对应网格，模型本体需 MPI 账号且非商用。
- 2026-11-19：导出回读 23/23 通过；报告新增 SOMA 实测与许可矩阵，V2 状态更新为「前向已通过、BVH 重定向待集成」。
- 2026-11-19（场景接入）：用 ANNY 六表型搜索生成 1.776 m 成人白模，摆成 A-pose（Y-up 下绕 Z 轴 ±58°），落盘 `soma_anny_adult.glb`；街景主角由体块人偶替换为该白模，重新渲染场景/相机路径/USD。
- 2026-11-19：验证项增至 16/16（新增 `character_soma_anny`），导出回读 24/24；报告新增第 4 行 ANNY 成人实测与 4 图预览。
- 2026-11-19（资产质量迭代）：按反馈升级载具——车身/座舱抽壳、侧窗与前后风挡开口、车门分缝、门把手、后视镜、前灯、座椅/仪表台/方向盘代理；新增 `research/public_assets.md`（服装/生物/植被/道具/载具的 CC0/CC-BY 来源与接入步骤）。
- 2026-11-19（公共资产下载）：实现 `harness/fetch_public_assets.py`，下载 9 项资产（Poly Haven 箱/椅/树、MakeHuman 服装、Kenney 车/自然包、Poly Pizza 跑车、Khronos Fox/ToyCar），记录许可/哈希/面数；`harness/preview_public.py` 完成 Y-up→Z-up 与缩放归一化并渲染 6 张白模预览。
- 2026-11-19（子代理调研）：三路并行调研服装/生物植被/载具道具建筑的社区来源，汇入 `research/community_assets.md`（MakeHuman、Quaternius、KayKit、Grab3D、Poly Haven、Poly Pizza、Objaverse、GSO、FreeCAD-library 等）。
- 2026-11-19（来源预览）：抓取 Quaternius/KayKit/GSO/Objaverse/Sketchfab/Renderpeople 六个官方预览图（`assets/previews/src_*.jpg`），内联进报告；Grab3D/GrabCAD 反爬、FreeCAD-library 仅仓库卡片，未取到模型预览。
- 2026-11-21（进度复核）：报告 2.2 MB / 33 图 / 外链 0；验证 16/16、导出回读 24/24；几何 23 个、预览 31 张、公共资产 9 项；P0–P6 全部完成，进入 V2/V3/V5 与资产接入阶段。
- 2026-11-21（竖切片 P7）：实现 SOMA 姿态空间步态（A-pose 基座 + 摆腿/摆臂 + 踝关节脚锁根位移），生成 120 帧人物序列；与街景/推镜合成，CPU 软光栅渲染 720×404 × 24fps；输出帧序列、contact sheet 与 MP4。
- 2026-11-21：竖切片验证通过——支撑脚滑步均值 0.47 cm/帧、最大 3.03 cm/帧，贴地 0，主体入画 100%，高度占比 52%；MP4 1.09 MB。

## 6. 未完成 / 下一步（如实记录）

1. **V2b**：把外部 `motion_walk_2s.bvh` 重定向到 SOMA 77 关节（当前竖切片是 SOMA 原生姿态空间生成），复检脚滑/关节限位。
2. **V3**：在 Blender/UE 中导入 BVH 与 USDA，验证相机时序、UsdSkel 与体积代理的下游消费。
3. **V5**：接入云端 LLM，统计首次执行成功率与 3 轮收敛率（当前用参数级修复模拟）。
4. 汽车 / 服装参数化模板库尚未建立（当前为 loft + 偏移壳）。
5. 面部/口型方案未覆盖。
6. 下载资产尚未接入正式场景：`island_tree_01` 约 160 万面需减面，ToyCar 约 10.9 万面；需建立「公共资产层」与程序化资产混排。
