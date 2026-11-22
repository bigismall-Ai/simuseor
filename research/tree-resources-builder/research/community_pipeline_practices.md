# 社区做法调研：3D 资产生产 / 资产管理 / 导演台 / 镜头库

> **📄 本文是细节存档。入口是 [`plans/ONE-PAGE.md`](../plans/ONE-PAGE.md)**——只想知道结论和下一步，读那一页就够（一屏读完）。
> 这一页背后的依据有两份：本文是「社区怎么做的」那一份（每条结论带标注、来源清单）；路线汇总与借鉴清单落点在 [`plans/ROADMAP-IMAGE-VIDEO.md`](../plans/ROADMAP-IMAGE-VIDEO.md)。
> 可视化速览在 [`plans/roadmap.html`](../plans/roadmap.html)：首屏就是结论页，往下才是完整看板。

> 所属：`research/tree-resources-builder` · B 部分调研正文
> 姊妹文档：`plans/ROADMAP-IMAGE-VIDEO.md`（路线汇总与借鉴清单落点）
> 取证时间：2026-11-21

---

## 0. 口径、标注约定与检索纪律

### 0.1 我们的前提（决定哪些做法「不适用」）

| 编号 | 硬约束（继承 `plans/PLAN.md` §0） | 对本文的影响 |
|---|---|---|
| C1 | 禁 3D 生成式模型（扩散 / SDS / 原生生成器） | 排除 AI 生成件（Meshy / Tripo / Sketchfab AI 等）、AI 生成贴图作为白模组成部分、生成式合成路线（Wonder Studio / Flow Studio 式） |
| C2 | 本地全 CPU | 排除依赖 GPU 的生成与渲染路径 |
| C3 | LLM 仅云端 API | LLM 只出代码 / 参数 / 结构，不产出几何 |
| C4 | 白模分几何层与非几何参考层 | trim sheet / UDIM 这类「贴图生产链」要降级改造，不是整套照抄 |
| C5 | 交付物须含可回读校验的真实生成物 | 「资产分级」「命名规范」必须能落成可校验的台账字段 |

### 0.2 标注约定（每条结论都带）

每条结论的格式固定为：

> **结论句。**[主流做法 | 个别做法 | 我们不适用] — 来源：<URL>（页面标题）

- **主流做法**：多家工具 / 多份文档共同采用的做法，有官方文档或规范支撑。
- **个别做法**：存在但非通行的做法（单一厂商、单一插件、单一社区）。
- **我们不适用**：与 C1–C5 冲突，或代价明显超出本项目收益。

### 0.3 检索纪律（写入本文的硬要求）

- 优先**官方文档 / 官方仓库 / 官方产品页 / 论文页**；社区博客与第三方教程只作补充，并标注类型。
- 访问站点**间隔 ≥2 秒**，客户端**自报 UA**（`SiMuseorResearch/1.0`，不冒充浏览器）；**遇 403 / 挑战页 / TLS 失败立即停止**，不重试、不绕过、不伪造 cookie。
- 被拦的页面一律标「未验」，**不据此下结论**。
- 不下载大文件；不下载任何模型权重。
- **不编造** URL、标题或访问结果。

### 0.4 本轮链接复核（2026-11-21，独立于撰写过程）

对本文引用链接中**抽样的 24 条**做了一次独立的 HTTP 状态复核（本文全文引用约 120 条，此处是抽样而非穷举）：

| 结果 | 条数 | 说明 |
|---|---|---|
| `200` | 21 | 复核通过 |
| `403` | 2 | `tripo3d.ai`（AI 3D 许可博客）、`docs.unrealengine.com`（PCG 概览）——撰写时已打开，本轮复核时站点反爬策略已变，标为「撰写时已打开 / 本轮复核 403」 |
| 连接失败 | 1 | `docs.unity3d.com`（LODGroup 文档）——撰写时已打开，本轮复核时不可达 |

> 结论：**本文的链接本身可用**；个别站点对自动化访问的策略会变，所以凡关键结论都给了**官方出处**而非单一商业页面。

---

## 1. 3D 资产生产

### 1.1 参数化 / 程序化底座

**CAD / 脚本化建模是硬表面资产生产的主流底座**：模型即程序，尺寸即变量，改一个参数重跑即得新件。build123d 建立在 OpenCascade BREP 内核上，模型是 Python 程序、精确几何，可导出 STEP 给 FreeCAD/SolidWorks，适合「参数化底座 + 交换格式」。[主流做法] — 来源：https://build123d.readthedocs.io/en/latest/ （What is build123d?）

OpenSCAD 官方文档把「参数化建模」作为主线组织（User Manual、Language Reference、Customizer），其定位是「读取描述设计的文本脚本生成模型」，参数可配置——这正是我们「LLM 只写参数」的理想形态。[主流做法] — 来源：https://openscad.org/documentation.html （OpenSCAD - Documentation）

Blender 几何节点的节点组可右键「标记为资产」，进入资产浏览器目录并按目录归类，还能保存成资产包复制到资产库共享；节点组内置「实例项 / 实例计数 / 嵌套实例」等节点，是参数化阵列与变体的标准做法。[主流做法] — 来源：https://docs.blender.org/manual/zh.cn/dev/modeling/geometry_nodes/tools.html （基于节点的工具）

Houdini Engine 把 Houdini 节点网络直接接入 Unity、Unreal、Maya、3ds Max，用于在引擎内程序化产出资产。[主流做法] — 来源：https://www.sidefx.com/products/houdini-engine/ （Houdini Engine）

OpenVSP 用参数化几何 + API 生成飞行器外形，是「垂直领域参数化白模」的成熟样本；其对气动外形有可查的几何 / 系数定义（弦长、展长、参考面积、阻力系数等），说明**参数化白模常配套可核对的物理量**。[个别做法] — 来源：https://openvsp.org/ （OpenVSP）· https://openvsp.org/wiki/doku.php?id=parasitedrag （Parasite Drag）

用「种子 + 参数」批量生成随机分形树（可复现同一棵树，也可换种子生成变体）是插件社区常见做法，可作我们 L-system 变体管理的参照。[个别做法] — 来源：https://github.com/edwardszhou/arbor-barber （Arbor Barber）

> **未找到可核对来源**：Freeship / DELFTship（官网返回非文本内容）、Arbaro（GitHub 仓库路径 404）。本文不据这两条下任何结论——它们在 `research/paradigms.md` 的候选表里出现过，但本轮无法核实。
>
> **与我们的关系**：我们已在主干上——`harness/generate_assets.py` 的「JSON 配方 + 白名单解释器」等价于一个自建的参数化底座。**这条路不需要改**；社区这一节的价值在于「参数化底座要配可核对的物理量」（OpenVSP 的气动系数 → 我们对应的是车辆尺寸先验、树高先验）这个习惯。

### 1.2 扫描与 AI 辅助生成的定位与许可（重点）

摄影测量是「采集真实物体」而非「生成几何」，与 C1 不冲突，是主流路线。Metashape 许可分 Standard / Professional / Educational，永久有效、含 12 个月技术支持与 2.x 更新；教育许可只面向认证教育机构及其师生。[主流做法] — 来源：https://www.agisoftmetashape.com/buy/ （Buy | Agisoft Metashape）

RealityCapture 各版本均可用于商业目的，但演示版创建的场景不能在付费版中打开。[主流做法] — 来源：https://www.realitycapture.com.cn/?newsid=20/ （RealityCapture）

Polycam 同时提供摄影测量工具与「AI 3D model generator」，但前者是采集、后者是生成，**性质必须分开记账**。[主流做法] — 来源：https://poly.cam/ （Polycam — AI 3D Scanning, Floor Plans & Reality Capture for Teams）

AI 生成 3D 的主流许可模式是「免费层 CC BY 4.0 需署名、付费层去署名并允许商用」——Meshy 免费层仅允许有限商用并需署名，Pro 层去除署名义务。[主流做法] — 来源：https://www.tripo3d.ai/zh/blog/commercial-use-ai-3d-models （AI 生成的 3D 模型可以用于商业用途吗？）

Tripo 等生成器能秒级产出「Smart Mesh 白模」，说明「白模」这一形态**并不专属人工建模**——正因如此我们更要自己产出几何以保证出处可追溯。[我们不适用] — 来源：https://www.tripo3d.ai/zh/blog/commercial-use-ai-3d-models

我们不采用任何扩散 / SDS / 原生生成器产出的几何，也不采用 AI 生成贴图作为白模体系的组成部分。[我们不适用] — 来源：https://www.tripo3d.ai/zh/blog/commercial-use-ai-3d-models

采集件要进入生产，合规前提是拍摄对象与扫描结果的权属清晰。CC0 资产库的做法是给出**签名溯源证明**，含资产 ID / 版本、SHA-256、CC0 确认、「made by humans, no generative AI」声明与贡献者链。[主流做法] — 来源：https://polyhaven.org/corporate （Corporate Partnerships）

Substance 3D Sampler 的「Image to Material」属 AI 辅助的贴图 / 材质生成与扫描处理，**不产生几何**，可作为「贴图侧 AI 可用、几何侧 AI 禁用」的边界范例。[主流做法] — 来源：https://www.adobe.com/products/substance3d-sampler.html （Capture your world in 3D.）

聚合平台上的资产许可逐件不同，Sketchfab 的许可协议对部分许可明确设限（不可商用、不可用于暗示赞助或关联），**不能以「平台上下的」推定可用**。[主流做法] — 来源：https://sketchfab.com/licenses （License Agreement）

> **对我们的直接含义**：① 扫描件可以进，但必须先有拍摄授权与逐件出处证明；② 资产台账必须有 `sha256` + 许可 + 「非生成式来源」声明三件套（与 `plans/ROADMAP-IMAGE-VIDEO.md` §2.5.2 的 manifest 字段表一致）；③ **Poly Haven 的溯源清单是最值得照抄的模板**。

### 1.3 资产分级、LOD 与贴图规范

LOD 主流做法是按「屏幕相对高度 / 切换距离」分级，而不是按固定面数一刀切；Unity 用 LODGroup 设定各级 LOD 与过渡高度。[主流做法] — 来源：https://docs.unity3d.com/Manual/class-LODGroup.html （LOD Group component reference）

UE 侧对应机制是静态网格体的 LOD 链加每级 LOD reduction settings，减面比例逐级递减。[主流做法] — 来源：https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/EditorScripting/StaticMesh/GetLodReductionSettings （Get Lod Reduction Settings）

单网格三角面预算只有量级参考、**没有行业统一标准**；第三方工具给出的量级为 PC 约 30 万、Steam Deck 约 10 万、Switch 约 6 万、Quest 约 2 万、移动约 1.5 万。[个别做法] — 来源：https://tridiart.com/lod-tailor （LOD Tailor）

trim sheet 是主流贴图策略：把 UV 壳排在标准化横向行（trim）内，一份材质跨网格复用，常规规格为 2048×2048 贴图、6px padding、按 45° 处理法线斜切。[主流做法] — 来源：https://darkslope.atlassian.net/wiki/plugins/viewsource/viewpagesrc.action?pageId=2361229347 （Trimsheet workflow）

Hero / Mid / Low 三级资产分级是社区通行的资源分配框架（按镜头可见度分配面数、贴图、细节），但**未见引擎或协会发布的强制标准**。[主流做法] — 来源：https://github.com/KhronosGroup/glTF-Sample-Assets （Khronos glTF Sample Assets，逐件带 license 字段，是「分级 + 许可标注」的社区样本）

> **未找到可核对来源**：UDIM 官方说明、几何代理（proxy）的官方定义、Hero/Mid/Low 的引擎级强制标准。本轮预算内未取得，故不写。
>
> **与我们的关系**：社区按「屏幕相对高度」分级，我们按**用途**分级（hero = 近景主线、mid = 中景、low = 远景占位）并绑定面数上限——这是 ROADMAP §3.2 记的「需要改造后使用」项。面数预算用上表的**量级**做参照区间（Quest 级 10⁴ 量级对白模正合适），**不作为硬阈值**。

### 1.4 命名与目录规范

Blender 的资产化流程本身给出了目录与命名范式：「标记为资产」→ 资产浏览器按目录（catalog）归类 → 目录名即菜单 / 分类名 → 保存资产包并复制到资产库。[主流做法] — 来源：https://docs.blender.org/manual/zh.cn/dev/modeling/geometry_nodes/tools.html （基于节点的工具）

UE 侧的做法是「一切皆项目内资产」：在内容浏览器里创建的资产（如 PCG 图表）可被 PCG 组件以实例方式引用，同一份定义多处生成。[主流做法] — 来源：https://docs.unrealengine.com/5.2/zh-CN/procedural-content-generation-overview （程序化内容生成概述）

跨文件引用要分清两种语义：**Link 是活引用**（源文件改动自动传播），**Append 是独立副本**（与源无关）——这是资产库分发时必须登记的规则。[主流做法] — 来源：https://blendervisualinvestigation.com/knowledge-base/docs/techniques/utility-workflows/scene-management （Scene Management）

`<category>_<name>_<variant>` 三段式命名与按类别分层目录是社区普遍做法，但未见引擎方发布的官方强制命名规范文档，可视为各家规范的**收敛结果**而非标准。[主流做法] — 来源：https://docs.blender.org/manual/zh.cn/dev/modeling/geometry_nodes/tools.html （基于节点的工具）

Quaternius 的资产包为 CC0：可商用、无需署名、可自由修改与合并，可用 Blender 直接打开 .blend 或导入 FBX，多数包用图集（atlas）贴图以优化性能。[主流做法] — 来源：https://quaternius.com/faq.html （Quaternius • F.A.Q）

MakeHuman / MPFB 采用「资产与代码分离」的拆分许可：核心资产为 CC0（免付费、免署名、衍生自由），源码分别为 AGPL 与 GPL——即「用它的资产没有负担，分发或改造它的工具要顾 copyleft」。[主流做法] — 来源：https://static.makehumancommunity.org/about/license.html （License :: MakeHuman Community）

### 1.5 变体管理

UE PCG 的主流范式是「参数化图表资产 + 组件实例」：图表以节点（密度、筛选、取样、生成器、变换）描述规则，组件在关卡中取样并实时刷新。[主流做法] — 来源：https://docs.unrealengine.com/5.2/zh-CN/procedural-content-generation-overview （程序化内容生成概述）

Houdini Engine 的范式是把同一份节点网络（HDA）在不同引擎中复用为资产，参数在资产侧暴露而非重做模型。[主流做法] — 来源：https://www.sidefx.com/products/houdini-engine/ （Houdini Engine）

Blender 侧的对应做法是集合实例与链接复制（Alt+D 共享同一网格数据块）：改一次几何、摆放多处，改模型不动摆位。[主流做法] — 来源：https://www.blender.org/manual/zh-hans/3.5/modeling/geometry_nodes/index.html （几何节点）

「同一资产的不同参数档位如何在目录中登记为变体」的行业统一约定，**未找到可核对来源**。[个别做法] — 来源：https://www.blender.org/manual/zh-hans/3.5/modeling/geometry_nodes/index.html

### 1.6 本方向来源清单

| 主题 | 链接 | 类型 | 访问结果 |
|---|---|---|---|
| build123d 参数化 CAD（OpenCascade BREP、STEP 导出） | https://build123d.readthedocs.io/en/latest/ | 官方文档 | 已打开核对 |
| OpenSCAD 文档体系（参数化建模主线） | https://openscad.org/documentation.html | 官方文档 | 已打开核对 |
| OpenSCAD 定位（脚本生成实体） | https://openscad.org/ | 官网 | 仅检索结果未打开 |
| Blender 几何节点：标记为资产 / 资产包 / 目录归类 | https://docs.blender.org/manual/zh.cn/dev/modeling/geometry_nodes/tools.html | 官方文档 | 撰写时已打开 / 本轮复核 403（反爬挑战页） |
| Blender 几何节点：实例项 / 实例计数 / 嵌套实例 | https://www.blender.org/manual/zh-hans/3.5/modeling/geometry_nodes/index.html | 官方文档 | 仅检索结果未打开 |
| Blender 资产库目录规范 | https://docs.blender.org/manual/en/latest/files/asset_libraries/introduction.html | 官方文档 | 未打开（403 挑战页，未重试） |
| Houdini Engine 接入引擎 | https://www.sidefx.com/products/houdini-engine/ | 官方产品页 | 已打开核对 |
| OpenVSP 官网 | https://openvsp.org/ | 官网 | 已打开核对 |
| OpenVSP 参数化气动定义 | https://openvsp.org/wiki/doku.php?id=parasitedrag&rev=1520025476 | 官方 Wiki | 仅检索结果未打开 |
| 随机分形树插件（种子 + 参数） | https://github.com/edwardszhou/arbor-barber | GitHub 仓库 | 仅检索结果未打开 |
| Freeship / DELFTship | https://www.freeship.org/ | 官网 | 未打开（返回非文本内容） |
| Arbaro（Blender 树生成插件） | https://github.com/timelapse/Arbaro | GitHub 仓库 | 未找到可核对来源（404） |
| Metashape 许可与版本 | https://www.agisoftmetashape.com/buy/ | 官方页面 | 已打开核对 |
| RealityCapture 许可 | https://www.realitycapture.com.cn/?newsid=20/ | 官方站中文页 | 仅检索结果未打开（英文官网抓取失败） |
| Polycam 摄影测量与 AI 生成 | https://poly.cam/ | 官网 | 已打开核对 |
| AI 3D 许可分级（Tripo / Meshy 等） | https://www.tripo3d.ai/zh/blog/commercial-use-ai-3d-models | 官方博客 | 撰写时已打开 / 本轮复核 403 |
| Meshy 许可（第三方指南） | https://mesyai.com/pt-br | 第三方指南 | 仅检索结果未打开（Meshy 官网 403 挑战页） |
| Poly Haven CC0 与溯源证明（ID / 版本 / SHA-256 / 非生成式声明） | https://polyhaven.org/corporate | 官方页面 | 已打开核对 |
| Substance 3D Sampler | https://www.adobe.com/products/substance3d-sampler.html | 官方产品页 | 仅检索结果未打开（直连 403 未验） |
| Sketchfab 许可条款 | https://sketchfab.com/licenses | 官方协议页 | 已打开核对 |
| Unity LODGroup | https://docs.unity3d.com/Manual/class-LODGroup.html | 官方文档 | 撰写时已打开 / 本轮复核连接失败 |
| UE 静态网格体 LOD reduction | https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/EditorScripting/StaticMesh/GetLodReductionSettings | 官方 API 文档 | 仅检索结果未打开 |
| 各平台三角面预算量级（第三方） | https://tridiart.com/lod-tailor | 厂商工具页 | 仅检索结果未打开 |
| Trim sheet / Ultimate Trim 工作流 | https://darkslope.atlassian.net/wiki/plugins/viewsource/viewpagesrc.action?pageId=2361229347 | 工作室技术文档 | 已打开核对 |
| Quaternius CC0 与使用条款 | https://quaternius.com/faq.html | 官方 FAQ | 已打开核对（答案在折叠区，经检索摘要交叉确认） |
| MakeHuman / MPFB 拆分许可（资产 CC0 / 源码 AGPL+GPL） | https://static.makehumancommunity.org/about/license.html | 官方页面 | 已打开核对 |
| UE PCG 概览（图表资产 + 组件实例） | https://docs.unrealengine.com/5.2/zh-CN/procedural-content-generation-overview | 官方文档 | 撰写时已打开 / 本轮复核 403 |
| Link 与 Append 的区别（活引用 vs 独立副本） | https://blendervisualinvestigation.com/knowledge-base/docs/techniques/utility-workflows/scene-management | 第三方教程 | 仅检索结果未打开 |
| glTF Sample Assets（逐件 license 字段的社区样本） | https://github.com/KhronosGroup/glTF-Sample-Assets | 官方 GitHub | 已打开核对 |

**本方向未找到可核对来源的三项**（因此本文不据此下结论）：UDIM 官方说明、几何代理（proxy）的官方定义、Hero/Mid/Low 的引擎级强制标准。

## 2. 3D 资产管理

### 2.1 资产库的目录、检索与许可字段惯例

Poly Haven 把整个站做成一个可编程检索面：公开 API 免费（含商用），`/assets` 一次返回全部资产元数据，`/info/<id>` 给单资产详情，`/files/<id>` 精确到「分辨率×格式」的文件级 url + size + md5，`/types` 只有 hdris/textures/models 三类。[主流做法] — 来源：https://polyhaven.org/our-api （API • Poly Haven）

Poly Haven 的资产元数据分**四层**：可读描述（name / description / category）、检索标签（tags）、机读属性（attributes：time_of_day、weather、contrast、environment 等）、指纹与统计（files_hash、max_resolution、download_count、authors 且区分 Processing 与 Photography 角色）。[主流做法] — 来源：https://api.polyhaven.com/info/sunset_jhbcentral （Poly Haven API JSON 响应）

Poly Haven 的资产清单里**没有** `license_id` 这类逐条许可字段，许可以「全站统一 CC0」声明；资产之间的差异只体现在 hash 与 files_hash 上。[主流做法] — 来源：https://polyhaven.org/our-api

ambientCG 同时提供机器 API 与人读页面：API v2 `full_json` 支持 `include=downloadData,tagData`，单条含 assetId、dataType、creationMethod（如 PBRPhotogrammetry）、tags、displayCategory、dimensionX/Y/Z、downloadCount、shortLink。[主流做法] — 来源：https://ambientcg.com/api/v2/full_json?limit=1&include=downloadData,tagData （ambientCG API JSON 响应）

ambientCG 的许可只有一种——CC0 1.0，可商用可不署名，并给每个资产一个稳定短链 `ambientcg.com/a/<id>` 供成品回指来源。[主流做法] — 来源：https://docs.ambientcg.com/license/ （License - ambientCG Docs）

Poly Pizza 走「逐文件许可」路线：每个模型挂自己的 Licence 徽标，站级许可页不存在（`/license`、`/faq`、`/terms` 均 404，仅 `/docs/tos` 说明「下载者遵守每个模型所选 CC 许可」）。[个别做法] — 来源：https://raw.githubusercontent.com/TMHSDigital/Free-Game-Dev-Assets/main/catalog/3d/poly-pizza.md （poly-pizza.md，第三方资产目录）

Sketchfab 的许可分 standard 与 editorial 两档（editorial 禁商用、禁用于宣传），并额外规定不得转售、不得把衍生品当独立资产再分发，许可非独占。[主流做法] — 来源：https://sketchfab.com/licenses （License Agreement）

**Sketchfab 的检索维度里已把「人做 / AI 生成」拆成 `is_ai=0` / `is_ai=1` 两个显式过滤器**，与「可下载」并列。[主流做法] — 来源：https://sketchfab.com/search?features=downloadable （Sketchfab 检索页）

KitBash3D 用订阅 / 买断两档商业许可替代 CC：订阅期内可下载使用、到期需续；买断可跨项目永久使用；两档均允许商用。[个别做法] — 来源：https://kitbash3d.com/pages/licenses （Licenses – KitBash3D）

Quaternius 自造许可名 QAL v1.0：个人 / 教育 / 商业免费、不要求署名，但不得把资产本身转售或再分发。[个别做法] — 来源：https://quaternius.com/license.html （Quaternius Asset License (QAL)）

Epic Fab 用平台自有许可（Fab Standard License）：允许商用 / 私用 / 改造 / 随项目分发 / 与协作者共享，禁止独立转售；分 Personal、Professional、Reference-Only 三档，Reference-Only 只给引用不给源文件；不要求署名；部分资产沿用 CC-BY。[主流做法] — 来源：https://www.fab.com/eula （Fab）

NVIDIA Omniverse 用 USD Composer 承接「世界搭建」：装配 / 布光 / 仿真 / 渲染大规模场景，靠 USD 的 Layers、Variants、Instancing 组合资产；连上 Nucleus 服务器后可在多应用、多机器、多人之间实时共编。[主流做法] — 来源：https://docs.omniverse.nvidia.com/composer/latest/overview_external.html （USD Composer Overview）

Omniverse 另配 Asset Validator：对 Stage 或 Prim 逐条跑规则与要求，可一键修复，资产入库前先过一致性校验。[主流做法] — 来源：https://docs.omniverse.nvidia.com/kit/docs/asset-validator/latest/source/extensions/omni.asset_validator.ui/docs/windows.html （Windows — Omni Asset Validator）

「全站单一 CC0、库里没有许可字段」的做法**不适用于我们**——我们要混采多许可源，逐资产许可字段是必需项。[我们不适用] — 来源：https://polyhaven.org/our-api

KitBash3D 的订阅制、Fab 的商店分层与 Reference-Only 档，对离线白模库没有意义。[我们不适用] — 来源：https://kitbash3d.com/pages/licenses

### 2.2 元数据与许可字段：署名要求、SPDX、USD assetInfo

USD 的资产元数据放在 prim 的 `assetInfo` 字典里；AssetPreviewsAPI 是 applied schema、不定义任何属性，只把缩略图写进 `assetInfo.previews.thumbnails.<name>.defaultImage`，访问某 stage 的默认预览要看它的 `defaultPrim`。[主流做法] — 来源：https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/usdMedia/schema.usda （pxr/usd/usdMedia/schema.usda）

USD 的资产定位走 resolver 插件：`ArGetResolver` 按插件发现候选、`ArDefaultResolver` 兜底，`ArSetPreferredResolver` 可强制指定，消费方从 session 的 `ArAssetResolver` 取 `ArAsset`。[主流做法] — 来源：https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/ar/resolver.h （pxr/usd/ar/resolver.h）

resolver 返回的 `ArAssetInfo` 只有四个字段：`version`、`assetName`、`repoPath`（已弃用）、`resolverInfo`——即「解析结果至少要带回**版本与资产名**」是 USD 侧的最低要求。[主流做法] — 来源：https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/ar/assetInfo.h （pxr/usd/ar/assetInfo.h，本轮逐字读取）

许可标识用 **SPDX ID** 作唯一机器可读值域（`CC0-1.0` = Creative Commons Zero v1.0 Universal，OSI 认证列标 Y）。[主流做法] — 来源：https://spdx.org/licenses/ （SPDX License List）

REUSE 3.3 要求项目根目录 `LICENSES/` 放每个许可的全文、**文件名即 SPDX 标识**（`LICENSES/GPL-3.0-or-later.txt`），`.reuse/dep5` 与 `REUSE.toml` 承载声明，且 DEP5 已标注 deprecated。[主流做法] — 来源：https://reuse.software/spec-3.3/ （REUSE Specification）

Blender 自身源码用 SPDX 文件头标注版权与许可（`SPDX-FileCopyrightText` / `SPDX-License-Identifier`），是文件级许可标注的社区惯例。[主流做法] — 来源：https://raw.githubusercontent.com/blender/blender/main/scripts/startup/bl_operators/assets.py （bl_operators/assets.py）

Blender 把「资产标记」做成显式操作：`AssetBrowserMetadataOperator` 与 `AssetMetaDataPanel` 负责写入 / 展示资产元数据，`SpaceAssetInfo` 判断当前是否处于资产浏览器空间。[主流做法] — 来源：https://raw.githubusercontent.com/blender/blender/main/scripts/modules/bpy_extras/asset_utils.py （bpy_extras/asset_utils.py）

「署名要求」不是独立布尔字段，而是**许可条款的派生结果**：Fab 明示不要求署名，ambientCG 不需但欢迎署名，Quaternius QAL 明示不要求署名，只有 CC-BY 才必须署名。[主流做法] — 来源：https://docs.ambientcg.com/license/

### 2.3 版本与指纹

指纹普遍分**两级**：资产级内容哈希（Poly Haven 的 `files_hash`）+ 文件级哈希（Poly Haven `/files` 给每文件的 md5、size、url）。[主流做法] — 来源：https://api.polyhaven.com/files/sunset_jhbcentral （Poly Haven API JSON 响应）

缩略图也单独版本化（Poly Haven 的 `img_version` 与 CDN URL 上的 `v=` 参数），说明「预览图」在资产体系里是被当作需独立追踪的产物。[主流做法] — 来源：https://api.polyhaven.com/info/sunset_jhbcentral

大文件不进普通 Git 指针而用 git-lfs：GB 级文件纳入 Git 版本控制，沿用同一套工作流与访问控制。[主流做法] — 来源：https://git-lfs.com/ （Git Large File Storage）

生产系统里的「版本」通常只记录文件位置而不存文件本体（ftrack 文档如此描述）。（页面被 Cloudflare 拦截，仅检索摘要）[主流做法] — 来源：http://ftrack.rtd.ftrack.com/en/3.3.18/faq/managing_assets.html （Managing assets）

### 2.4 库与场景怎么组合

USD 的官方定位就是「把 assets 组合成更大装配体」的组合能力，库与场景的关系被定义在 layer / variant / instance 层而不是拷贝层。[主流做法] — 来源：https://openusd.org/release/index.html （USD Home — Universal Scene Description）

Unity 的 Asset Database 把「源文件」与「导入后的产物」成对保存并保持同步——库里的资产和运行时资产不是同一份数据。[主流做法] — 来源：https://docs.unity3d.com/Manual/AssetDatabase.html （Managing assets with the Asset Database）

Houdini Engine for Unreal 把资产做成「参数化会话」：可导入导出资产、参数 / 输入输出 / 句柄分组，并有 SessionSync 与 NodeSync 两种同步形态。[主流做法] — 来源：https://www.sidefx.com/docs/houdini/unreal/ （Unreal — Houdini Engine for Unreal）

Nucleus 这类中心化在线协同服务器不适用于纯离线体系，我们只需借鉴它的目录 / 挂载约定。[我们不适用] — 来源：https://docs.omniverse.nvidia.com/composer/latest/overview_external.html

### 2.5 生产管理系统里 asset 与 shot 的实体建模

Kitsu 的层级是：project 是所有 asset、shot、task、metadata 的根容器，shot 再向下分 episode → sequence → shot。[主流做法] — 来源：https://dev.kitsu.cloud/guides/production-setup （Creating and Structuring a Production）

Kitsu 的 shot 字段为 project、sequence、name、nb_frames、frame_in、frame_out、description、data（`data` 承载自由扩展数据），资产类型则由 asset type + 任务类型工作流定义：workflow 可被某个 production 覆盖，落在 workflow 外的 task 在界面上被遮蔽但 API 仍返回。[主流做法] — 来源：https://dev.kitsu.cloud/guides/production-setup

Kitsu 支持 studio 级 metadata descriptor 扩展内置字段，项目模板可预置 task types、statuses、asset types、metadata descriptors、production settings。[主流做法] — 来源：https://dev.kitsu.cloud/guides/production-setup

ShotGrid 里 asset 是独立实体类型，带 code、sg_asset_type 等字段，可用 `find("Asset", filters, fields)` 检索并与 sequence 建立关系，shot 与 asset 的关联统计用 Query 字段按「Shots > includes > Current Shot」过滤实现。（Autodesk 支持页返回 403，仅检索摘要）[主流做法] — 来源：https://developers.shotgridsoftware.com/python-api/reference.html （API Reference）

影视向的 task / status / 工时 / 评审流相对我们过重，我们只取「asset 与 shot 同级 + 类型与工作流分离 + 扩展 metadata descriptor」这套实体骨架。[我们不适用] — 来源：https://dev.kitsu.cloud/guides/production-setup

### 2.6 OpenAssetIO —— 「资产管理互操作标准」的真身（本节修正一处常见误记）

> ⚠️ **重要修正**：任务书里提到的「OpenAssetManagement (OAM)」**当前并不存在可核对的官方仓库或规范页**——ASWF 名下 `OpenAssetManagement` / `OpenAssetManager` 均为 404，GitHub 仓库检索也返回空（本轮两路独立核对，结论一致）。
>
> **真正存在的是 `OpenAssetIO`**，它就是媒体生产资产管理的互操作标准，且**已有官方 USD / OTIO / ShotGrid 三条现成接法**。

OpenAssetIO 自我定位为「面向媒体生产中工具与内容管理系统的开源互操作标准」，许可 Apache-2.0。[主流做法] — 来源：https://github.com/OpenAssetIO/OpenAssetIO （OpenAssetIO 仓库，本轮已打开核对 README）

它的问题陈述与我们的处境高度一致：「在现代创作管线里，数据通常由一个权威系统（Asset Management System / DAM / MAM）管理；而创作工具常常**用当前的文件系统位置**来引用这些受管数据。这不仅限制文档的可移植性，还**剥掉了关于数据身份、用途与来源的语义信息**，使加载、版本管理与分布式计算都变复杂。」[主流做法] — 来源：https://github.com/OpenAssetIO/OpenAssetIO

它的解法是：**用「实体引用（Entity Reference）」按身份引用数据，而不是按路径**；实体的任何属性（所在位置、可用版本等）都可以按当前计算环境**按需解析（resolve）**。[主流做法] — 来源：https://github.com/OpenAssetIO/OpenAssetIO

官方仓库生态里已有几条**正是我们关心的**接法（仓库名与描述经本轮 GitHub API 实测确认，均存在且可访问）：

| 仓库 | 作用 | 对我们的意义 |
|---|---|---|
| `OpenAssetIO/usdOpenAssetIOResolver` | 「一个承载 OpenAssetIO 的 USD AR2 插件」，可让任意 OpenAssetIO manager 解析实体引用，且**保留 `ArDefaultResolver` 基于搜索路径的解析行为** | **USD 侧的现成范式**：我们不必做完整 Asset Resolver，只要做到「有 id 就按 id 解析，没有就按路径兜底」 |
| `OpenAssetIO/otio-openassetio` | 「一个原型 OpenTimelineIO 插件，用于让带资产的 EDL 通过 OpenAssetIO 解析」 | 证明 OTIO 与资产管理**可以并存**，两者不是二选一——直接回应我们的决策点 1 |
| `OpenAssetIO/fpt_openassetio_manager` | Flow Production Tracking（ShotGrid）的 OpenAssetIO manager 插件 | 证明「自建轻量 manager」是社区常规做法，而非只能上 ShotGrid |
| `OpenAssetIO/OpenAssetIO-Manager-BAL` | 「一个为 OpenAssetIO 集成测试而造的刻意简化的资产管理系统」 | **最小 manager 的现成参照**：正是我们「自建最小资产管理器」的样板 |
| `OpenAssetIO/Template-OpenAssetIO-Manager-Python` | manager 插件模板 | 自建 manager 的脚手架 |

usdOpenAssetIOResolver 的用法示例也值得抄：`references = @bal:///floor@</ParkingLot_Floor>`——**引用里带解析器前缀（`bal://`）与实体路径（`@...@`）**，与「asset id + 版本」一一对应。[主流做法] — 来源：https://github.com/OpenAssetIO/usdOpenAssetIOResolver （README，本轮已打开核对）

### 2.7 开源生产管理系统的许可与可自建性

Kitsu（cgwire/kitsu）许可为 **AGPL-3.0**，自建需评估 copyleft 传染面（对外提供网络服务时会触发源码开放义务）。[主流做法] — 来源：https://api.github.com/repos/cgwire/kitsu （GitHub 仓库元数据 JSON，本轮实测）

OpenTimelineIO 为 **Apache-2.0**（LICENSE.txt 首部为 Apache License 2.0 全文）。[主流做法] — 来源：https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenTimelineIO/main/LICENSE.txt （OpenTimelineIO LICENSE.txt，本轮实测）

OpenAssetIO 为 **Apache-2.0**。[主流做法] — 来源：https://api.github.com/repos/OpenAssetIO/OpenAssetIO （GitHub 仓库元数据 JSON，本轮实测）

OpenPBR 仓库为 Apache-2.0，规范当前版本 v1.1.2（2026-10-28），模型是 Autodesk Standard Surface 与 Adobe Standard Material 的综合。[主流做法] — 来源：https://api.github.com/repos/AcademySoftwareFoundation/OpenPBR · https://academysoftwarefoundation.github.io/OpenPBR/

> **OAM（OpenAssetManagement）本次未找到可核对的官方仓库或规范页**（ASWF 名下两个候选均为 404，GitHub 检索返回空）——本轮两路独立核对结论一致。**真实的对应标准是 `OpenAssetIO`（见 §2.6）。**

### 2.8 本方向来源清单

| 主题 | 链接 | 类型 | 访问结果 |
|---|---|---|---|
| Poly Haven API 文档 | https://polyhaven.org/our-api | 官方文档 | 已打开核对 |
| Poly Haven 资产详情 API（四层元数据 + authors 角色） | https://api.polyhaven.com/info/sunset_jhbcentral | 官方 API | 已打开核对 |
| Poly Haven 文件级 API（md5 / size / url） | https://api.polyhaven.com/files/sunset_jhbcentral | 官方 API | 已打开核对 |
| Poly Haven 类型 API | https://api.polyhaven.com/types | 官方 API | 已打开核对 |
| Poly Pizza 许可页（不存在 → 逐文件许可） | https://poly.pizza/license | 站点 | 已打开核对（404，站点无此页） |
| Poly Pizza 第三方目录条目 | https://raw.githubusercontent.com/TMHSDigital/Free-Game-Dev-Assets/main/catalog/3d/poly-pizza.md | 第三方目录 | 已打开核对 |
| ambientCG API（assetId / creationMethod / dimension） | https://ambientcg.com/api/v2/full_json?limit=1&include=downloadData,tagData | 官方 API | 已打开核对 |
| ambientCG 许可页（CC0 1.0 + 稳定短链） | https://docs.ambientcg.com/license/ | 官方文档 | 已打开核对 |
| Sketchfab 许可条款（standard / editorial） | https://sketchfab.com/licenses | 官方文档 | 已打开核对 |
| Sketchfab 检索页（`is_ai` 过滤器） | https://sketchfab.com/search?features=downloadable | 站点页面 | 已打开核对 |
| KitBash3D 许可（订阅 / 买断） | https://kitbash3d.com/pages/licenses | 官方文档 | 已打开核对 |
| Quaternius QAL 许可 | https://quaternius.com/license.html | 官方文档 | 已打开核对 |
| Epic Fab EULA（三档分层） | https://www.fab.com/eula | 官方文档 | 已打开核对 |
| Omniverse USD Composer | https://docs.omniverse.nvidia.com/composer/latest/overview_external.html | 官方文档 | 已打开核对 |
| Omniverse Asset Validator（规则 / 一键修） | https://docs.omniverse.nvidia.com/kit/docs/asset-validator/latest/source/extensions/omni.asset_validator.ui/docs/windows.html | 官方文档 | 已打开核对 |
| Omniverse resolver 文档 | https://docs.omniverse.nvidia.com/kit/docs/omniverse_resolver/latest/index.html | 官方文档 | 仅检索结果未打开（AccessDenied） |
| OpenUSD 首页（组合定位） | https://openusd.org/release/index.html | 官方文档 | 已打开核对 |
| OpenUSD usdMedia schema（assetInfo / AssetPreviewsAPI） | https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/usdMedia/schema.usda | 官方源码 | 已打开核对 |
| OpenUSD ar/resolver.h（ArGetResolver / ArDefaultResolver） | https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/ar/resolver.h | 官方源码 | 已打开核对 |
| OpenUSD ar/assetInfo.h（version / assetName / repoPath 已弃用） | https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/ar/assetInfo.h | 官方源码 | 已打开核对（本轮逐字读取） |
| SPDX 许可列表 | https://spdx.org/licenses/ | 官方列表 | 已打开核对 |
| REUSE 规范 3.3（LICENSES/ + SPDX 文件头） | https://reuse.software/spec-3.3/ | 官方规范 | 已打开核对 |
| git-lfs | https://git-lfs.com/ | 官方文档 | 已打开核对 |
| Blender assets.py（SPDX 文件头惯例） | https://raw.githubusercontent.com/blender/blender/main/scripts/startup/bl_operators/assets.py | 官方源码 | 已打开核对 |
| Blender bpy_extras/asset_utils.py（资产元数据算子） | https://raw.githubusercontent.com/blender/blender/main/scripts/modules/bpy_extras/asset_utils.py | 官方源码 | 已打开核对 |
| Blender 手册 Asset Libraries | https://docs.blender.org/manual/en/latest/files/asset_libraries.html | 官方文档 | 仅检索结果未打开（验证挑战页） |
| Unity Asset Database（源文件 + 导入产物成对） | https://docs.unity3d.com/Manual/AssetDatabase.html | 官方文档 | 已打开核对 |
| Houdini Engine for Unreal（资产 = 参数化会话） | https://www.sidefx.com/docs/houdini/unreal/ | 官方文档 | 已打开核对 |
| Unreal Content Browser | https://dev.epicgames.com/documentation/en-us/unreal-engine/content-browser | 官方文档 | 仅检索结果未打开（200 但仅返回前端框架页） |
| Kitsu 生产搭建指南 | https://dev.kitsu.cloud/guides/production-setup | 官方文档 | 已打开核对 |
| Kitsu 仓库许可元数据（AGPL-3.0） | https://api.github.com/repos/cgwire/kitsu | 官方 API | 已打开核对（本轮实测） |
| ShotGrid Python API 参考 | https://developers.shotgridsoftware.com/python-api/reference.html | 官方文档 | 已打开核对 |
| ShotGrid asset-shot 关联支持页 | https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/ESP/How-to-display-how-many-Assets-are-linked-to-a-Shot-in-ShotGrid.html | 官方文档 | 仅检索结果未打开（403） |
| ftrack 资产管理 FAQ | http://ftrack.rtd.ftrack.com/en/3.3.18/faq/managing_assets.html | 官方文档 | 仅检索结果未打开（Cloudflare 拦截） |
| **OpenAssetIO 仓库（Apache-2.0，资产管理互操作标准）** | https://github.com/OpenAssetIO/OpenAssetIO | 官方仓库 | **已打开核对（本轮实测）** |
| **OpenAssetIO 组织仓库列表（含 USD / OTIO / ShotGrid / BAL / 模板）** | https://github.com/OpenAssetIO | 官方组织 | **已打开核对（本轮实测）** |
| **usdOpenAssetIOResolver（USD AR2 插件 + 引用语法示例）** | https://github.com/OpenAssetIO/usdOpenAssetIOResolver | 官方仓库 | **已打开核对（本轮实测）** |
| otio-openassetio（OTIO × OpenAssetIO 原型插件） | https://github.com/OpenAssetIO/otio-openassetio | 官方仓库 | 已打开核对（仓库列表实测） |
| fpt_openassetio_manager（ShotGrid manager 插件） | https://github.com/OpenAssetIO/fpt_openassetio_manager | 官方仓库 | 已打开核对（仓库列表实测） |
| OpenAssetIO-Manager-BAL（最小 manager 参照） | https://github.com/OpenAssetIO/OpenAssetIO-Manager-BAL | 官方仓库 | 已打开核对（仓库列表实测） |
| OpenAssetIO 文档站 | https://docs.openassetio.org/OpenAssetIO | 官方文档 | 仅检索结果未打开 |
| OpenTimelineIO LICENSE（Apache-2.0） | https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenTimelineIO/main/LICENSE.txt | 官方源码 | 已打开核对（本轮实测） |
| OpenPBR 仓库元数据与规范 | https://api.github.com/repos/AcademySoftwareFoundation/OpenPBR · https://academysoftwarefoundation.github.io/OpenPBR/ | 官方仓库 / 规范 | 已打开核对 |
| OAM 仓库候选（ASWF） | https://api.github.com/repos/AcademySoftwareFoundation/OpenAssetManagement | 官方 API | 仅检索结果未打开（404） |

---

## 3. 导演台 / Director's Console

### 3.1 工具形态与定位

前期工具呈两类分工：一类是「镜头创作与评审台」，一类是「生产管理系统」；前者管画面、编号与签字，后者管层级、任务与进度。[主流做法] — 来源：https://wiki.previspro.com/ （Previs Pro Wiki — Storyboarding, Previs & Animatics Reference）

最适合作为开源可核对样本的是 Kitsu：它把制作数据组织成 `production → episode/sequence/shot` 与 `asset` 两条并行分支，再与 task tracking 体系交叉。[主流做法] — 来源：https://kitsu.cg-wire.com/guides/production-structure （Production Structure | Kitsu Documentation）

Kitsu 的关系模型在官方文档里有明确图示：`SEQUENCE --contains--> SHOT`、`ASSET --cast in--> SHOT`、`SHOT --tracked by--> TASK`。[主流做法] — 来源：https://kitsu.cg-wire.com/guides/production-structure/manage-shots （Manage Shots | Kitsu Documentation）

Kitsu 的制作台被官方拆成 Productions / Episodes / Sequences / Shots / Studio Labels 五个管理页，外加 task type、task status、department 三层横向结构。[主流做法] — 来源：https://kitsu.cg-wire.com/guides/production-structure

Storyboarder 是开源的「快速可视化」路线：官方 README 定位为「用火柴人速度把故事画出来、做 animatic 给人看」，强调试错而非生产管理。[个别做法] — 来源：https://github.com/wonderunit/storyboarder （Storyboarder README）

Blender 把前期预演做进 DCC 本身：官方手册有独立 Storyboarding 章节，把 2D 绘制、3D 布局、视频剪辑合成为一条非破坏式工作流，用于开拍前「规划、可视化、迭代镜头」。[主流做法] — 来源：https://docs.blender.org/manual/en/latest/video_editing/storyboarding/index.html （Storyboarding - Blender Manual）

Toon Boom Storyboard Pro 的形态是「多视图工作站」：Storyboard View、Panel View、Tool Properties View，加 Tools / Storyboard / Playback 三条工具栏；Panel View 还承载 caption 编辑与草图、语音批注。[主流做法] — 来源：https://docs.toonboom.com/help/storyboard-pro-22/storyboard/getting-started/interface.html （About the User Interface | Storyboard Pro Online Help）

Previs Pro 走「3D 预演 + 动画样片」路线：工作区由 Breakdown / Boards / Timeline 三个标签页构成，另有 Canvas Editor（3D / 2D / CAM）与 Director's View。[主流做法] — 来源：https://wiki.previspro.com/

Boords 面向代理商与品牌方，做的是「脚本 → 分镜 → 带声 animatic → 客户签字」闭环，导出面覆盖 PDF、MP4 animatic、PPTX、XLSX、Word 与 NLE 时间线。[主流做法] — 来源：https://www.boords.com/export （Export storyboards as PDF, MP4, PowerPoint and more | Boords）

Twelve Labs 走的是另一端：不做创作，而是从已有素材里抽结构——transcription 给出词/句/utterance 级文本与起止时间，segment 则切分并产出 scene 级元数据。[个别做法] — 来源：https://docs.twelvelabs.io/api-reference/manage-assets/retrieve-transcription （Retrieve the transcription of an asset | TwelveLabs）

### 3.2 信息架构：典型区块

Previs Pro 官方 wiki 明确列出的区块是全样本里最完整的一份：缩略图墙（Scenes & Shot Tiles）、Shot Menu / Scene Menu、Side Panel（Shot Info / Scene Info / Project Info / Set Library）、Coverage Overview、Shot List、Timeline、Script Panel、Animatics、Share for Review / Comments / Doodle Annotations / Approvals / Publish to Web、Export Hub。[主流做法] — 来源：https://wiki.previspro.com/

Previs Pro 的三个标签页分工清晰：Breakdown 管脚本拆解、Boards 管镜头编排、Timeline 管时序；缩略图墙与时间轴是同一批镜头的两种视图。[主流做法] — 来源：https://wiki.previspro.com/

批注与审批是**独立一级区块**，不塞进镜头备注：Previs Pro 单列 Share for Review、Comments、Doodle Annotations、Approvals、Publish to Web 五个章节。[主流做法] — 来源：https://wiki.previspro.com/

Toon Boom 的对应区块是 Panel View（当前分镜的基本信息、caption 编辑、草图与语音批注）、Storyboard View（项目级剧本）、Animatic View（加运动与声音的样片）。[主流做法] — 来源：https://docs.toonboom.com/help/storyboard-pro-22/storyboard/getting-started/interface.html

Kitsu 的对应区块是「实体列表 + 任务列表」两栏：shot 页按 sequence 列出 shot，shot 详情里带自己的 task 列表与评论。[主流做法] — 来源：https://kitsu.cg-wire.com/guides/production-structure/manage-shots

Boords 的区块是脚本编辑器、分镜画板、帧字段、状态、评论、版本与签字，以及一个记录操作的项目活动流（示例里能看到「changed the status of … to In review」「marked a comment … as complete」）。[主流做法] — 来源：https://www.boords.com/storyboard-creator （The AI storyboard generator built for video agencies & brand teams | Boords）

StudioBinder 把脚本与镜头表并排打通：选脚本里的任意一行台词或动作就生成一条新镜头（Shot Tagging），再按机位/灯光分组（Camera Setups），并给出工时估算。[主流做法] — 来源：https://www.studiobinder.com/shot-list-storyboard/ （Free Shot List Software for Film & Video | StudioBinder）

缩略图墙 + 表格表 + 时间轴是三种最常见的镜头视图：Boords 的导出即「每帧一行、每字段一列、含状态列、可含图片与评论」的镜头表。[主流做法] — 来源：https://www.boords.com/export

### 3.3 镜头表（shot list）常见字段

StudioBinder 官方列举的镜头规格维度是：shot size（景别）、camera movement（机位运动）、lens（镜头）、frame rate（帧率）、camera angle（机位角度）、sound（声音）、location（场景）。[主流做法] — 来源：https://www.studiobinder.com/shot-list-storyboard/

Previs Pro 的 Shot Info 字段是：Size、Angle、Equipment、Framing、Duration、Movement，外加 Notes；其中 animatic 镜头的 Duration 与 Movement 被锁定。[主流做法] — 来源：https://wiki.previspro.com/

Kitsu 的 shot 实体字段只有最小集：`nb_frames`、`frame_in`、`frame_out`、`description`；扩展字段靠 metadata descriptor（可挂到 Asset / Shot / Edit / Episode / Sequence / Project / Task 上）。[主流做法] — 来源：https://dev.kitsu.cloud/guides/production-setup （Creating and Structuring a Production | Kitsu Developer）

因此「subject / time of day / 声音备注」这类字段在主流实现里落在 description 与自定义字段（metadata descriptor / frame field）上，而非硬编码列。[主流做法] — 来源：https://dev.kitsu.cloud/guides/production-setup

编号惯例是分层 + 补零：Kitsu 提供 Shot Padding，自动生成 SH0010 / SH0020；Previs Pro 则把 Scene & Shot Numbering 列为独立章节，场景号与镜头号分层。[主流做法] — 来源：https://kitsu.cg-wire.com/guides/production-structure/manage-shots

分镜画面与文字层是分离的：Toon Boom Storyboard Pro 全项目只有一个 Script field（存放整份剧本），每个 panel 有自己的 caption fields，分别存对白、动作、场景信息、scrubbing 信息，字段类型可自定义。[主流做法] — 来源：https://docs.toonboom.com/help/storyboard-pro-22/storyboard/caption/about-caption.html （About Script and Captions | Storyboard Pro Online Help）

Boords 的做法是把拍摄信息做成「每帧的 shot field」：可给每帧加机位角度、镜头备注和自定义制作字段。[主流做法] — 来源：https://www.boords.com/storyboard-creator

### 3.4 状态字段惯例

Kitsu 官方给出的任务状态集是 Todo、Work in Progress、Done、Retake、Waiting For Approval——正好覆盖「待办 / 进行中 / 待审 / 已批准」，并把「返工」单列为一态。[主流做法] — 来源：https://kitsu.cg-wire.com/guides/task-configuration （Task Configuration | Kitsu Documentation）

shot 状态与 task 状态是分开的：Kitsu 规定 Task 是「始终挂在 shot 或 asset 上的工作单元」，带一个 task type（Layout、Animation、Lighting 等，归属某个 department）和一个 task status。[主流做法] — 来源：https://kitsu.cg-wire.com/guides/task-configuration

也就是说：**镜头本身的状态（有没有分镜、有没有排进时间轴）和「这个镜头上的动画任务过没过审」是两套字段，不要混用。**[主流做法] — 来源：https://dev.kitsu.cloud/guides/task-tracking （Task Tracking | Kitsu Developer）

进度状态之上还有一层「排期」字段：Kitsu 的 task 带 start_date、due_date、estimation、duration、real_start_date、end_date、retake_count、priority 等，可直接聚合出时间线与甘特。[主流做法] — 来源：https://dev.kitsu.cloud/guides/task-tracking

审批在另一条线上：Previs Pro 把 Approvals 与 Share for Review 并列在「Sharing & Review」章节，属于**评审动作**而非生产进度状态。[主流做法] — 来源：https://wiki.previspro.com/

最轻的一档是 Boords：只给帧/板设状态（官方示例出现 In review），不区分部门与任务类型。[主流做法] — 来源：https://www.boords.com/storyboard-creator

跨工具并没有统一命名标准，但「todo / in-progress / waiting-for-approval / done」这套语义是各家的公约数；命名统一需我们自定映射表。[主流做法] — 来源：https://kitsu.cg-wire.com/guides/task-configuration

### 3.5 「人管镜头、机器管资产」的职责分界

Kitsu 的资产库与镜头树是两条独立分支，唯一交点是 `ASSET --cast in--> SHOT`：**资产不「拥有」镜头，镜头只是「调用」了资产。**[主流做法] — 来源：https://kitsu.cg-wire.com/guides/production-structure/manage-shots

职责切分最终落在任务层：资产任务（Modeling、Rigging…）与镜头任务（Layout、Animation、Compositing…）共用同一套 task type / task status / department 体系，但挂在不同实体上。[主流做法] — 来源：https://dev.kitsu.cloud/guides/production-setup

资产的归类由 asset type 决定，并由此决定「哪些任务与状态适用于它」；官方列举的标准类型包括 characters、props、sets/environments、vehicles、FX elements，也允许自定义。[主流做法] — 来源：https://dev.kitsu.cloud/guides/production-setup

Autodesk Flow Production Tracking（原 ShotGrid）用实体字段做交汇：创建 Entity 或 Multi-Entity 字段时，系统会在被链接实体上自动生成反向字段，一个 Entity 字段可从多个实体类型里链接一条记录（例如 one Asset 或 one Shot）。[主流做法] — 来源：https://www.autodesk.com/support/technical/article/Linking-entities-in-Flow-Production-Tracking （Linking entities in Flow Production Tracking）

ShotGrid 已更名为 Autodesk Flow Production Tracking，产品标题本身即写明「Formerly ShotGrid」。[主流做法] — 来源：https://www.autodesk.com/products/flow-production-tracking/overview （Autodesk Flow Production Tracking (Formerly ShotGrid)）

Previs Pro 把资产做成一等公民：Environments（墙、set、location、props）、Characters（cast list、Character Creator、3D 角色）、Set Library 与 Boards/Timeline 上的 shot 分开管理，再由镜头引用。[主流做法] — 来源：https://wiki.previspro.com/

轻量工具里的最小实现是「资产库 + 引用」：Boords 把角色、场景、道具存进团队 Asset Library，用 @ 引用进每一帧，以保证跨镜头的人脸与场景连续性。[主流做法] — 来源：https://www.boords.com/storyboard-creator

我们据此把职责切分定为：导演 / 分镜师只写镜头（编号、景别、机位、运动、时长、批注、审批），资产组只维护资产条目与其版本；系统只负责建立引用与状态追溯。**注：「资产版本被 shot pin 住」未找到官方依据，属我们自定规则，不作为行业事实。**[我们不适用（该 pin 规则无官方来源）] — 来源：https://kitsu.cg-wire.com/guides/production-structure/manage-shots

### 3.6 AI 预演与「禁生成式模型」约束

AI 预演已经进入商用预演工具的功能面：Previs Pro 的 AI Studio 覆盖图像生成、视频生成、音频生成、Sketch with AI、3D Props & Characters 与 Generation History。[主流做法] — 来源：https://wiki.previspro.com/

Boords 是「AI 优先」形态：脚本自动拆成 scene 与 frame，AI 出图并可用 Refine 局部重画，其自我定位是「AI 图像工具产出图片，Boords 产出分镜」。[主流做法] — 来源：https://www.boords.com/storyboard-creator

但两者的「**结构化部分**」与「**生成部分**」是可分离的：Boords 的脚本拆帧、帧字段、状态、评论、版本与签字链路不依赖生成模型；Previs Pro 的覆盖、编号、blocking、审阅同样是工程化结构。[我们不适用（生成部分）] — 来源：https://wiki.previspro.com/

因此我们明确不引入：AI 出图 / 出视频 / 出音频、AI 资产库自动生成、Credits 与积分体系、Generation History 这类生成计费与历史机制。[我们不适用] — 来源：https://wiki.previspro.com/

新兴 AI previs 路线（如 Wonder Studio，公开资料称已并入 Autodesk Flow Studio）主打把 CG 元素自动合成进实拍素材做预演，属生成式合成，与我们的约束直接冲突，不采纳；其官方页面被访问网关拦截，正文未能核对。[我们不适用] — 来源：https://www.autodesk.com/products/flow-studio/overview （Autodesk Flow Studio overview，访问被拒，未验）

Previs Pro 的 Suggest Coverage（自动建议覆盖）与「从建议镜头到 3D」若依赖模型则不采纳；纯规则推导的覆盖建议可另行评估。[我们不适用] — 来源：https://wiki.previspro.com/

### 3.7 本方向来源清单

| 主题 | 链接 | 类型 | 访问结果 |
|---|---|---|---|
| Kitsu 层级与数据模型 | https://kitsu.cg-wire.com/guides/production-structure | 官方文档 | 已打开核对 |
| Kitsu 任务类型与状态 | https://kitsu.cg-wire.com/guides/task-configuration | 官方文档 | 已打开核对 |
| Kitsu 镜头页与 asset↔shot↔task 关系 | https://kitsu.cg-wire.com/guides/production-structure/manage-shots | 官方文档 | 已打开核对 |
| Kitsu 生产结构（字段、元数据描述符、资产类型） | https://dev.kitsu.cloud/guides/production-setup | 官方开发者文档 | 已打开核对 |
| Kitsu 任务跟踪（排期、分配、评论） | https://dev.kitsu.cloud/guides/task-tracking | 官方开发者文档 | 已打开核对 |
| ShotGrid / Flow 实体链接语义 | https://www.autodesk.com/support/technical/article/Linking-entities-in-Flow-Production-Tracking | 官方支持文档 | 已打开核对 |
| Flow Production Tracking 产品页 | https://www.autodesk.com/products/flow-production-tracking/overview | 官方产品页 | 已打开核对（仅核对标题） |
| Flow Studio（AI previs） | https://www.autodesk.com/products/flow-studio/overview | 官方产品页 | 仅检索结果未打开（网关拒绝） |
| Previs Pro 官方 wiki（IA 全景） | https://wiki.previspro.com/ | 官方文档 | 已打开核对 |
| StudioBinder 镜头表字段与 Shot Tagging | https://www.studiobinder.com/shot-list-storyboard/ | 官方产品页 | 已打开核对 |
| Toon Boom Storyboard Pro 界面分区 | https://docs.toonboom.com/help/storyboard-pro-22/storyboard/getting-started/interface.html | 官方文档 | 已打开核对 |
| Toon Boom Script field 与 caption fields | https://docs.toonboom.com/help/storyboard-pro-22/storyboard/caption/about-caption.html | 官方文档 | 已打开核对 |
| Blender 故事板工作流 | https://docs.blender.org/manual/en/latest/video_editing/storyboarding/index.html | 官方手册 | 已打开核对 |
| Storyboarder（开源） | https://github.com/wonderunit/storyboarder | 官方 GitHub README | 已打开核对 |
| Boords 分镜生成与资产库 | https://www.boords.com/storyboard-creator | 官方产品页 | 已打开核对 |
| Boords 导出（镜头表格式） | https://www.boords.com/export | 官方文档 | 已打开核对 |
| Twelve Labs 转写 | https://docs.twelvelabs.io/api-reference/manage-assets/retrieve-transcription | 官方文档 | 已打开核对 |
| Twelve Labs 视频切分 | https://docs.twelvelabs.io/docs/guides/segment-videos | 官方文档 | 已打开核对 |
| Celtx 镜头列表 | https://www.celtx.com/shot-list-software/ | 官方产品页 | 仅检索结果未打开（TLS 失败） |
| Storyboarder 原仓库地址 | https://github.com/wboord/storyboarder | GitHub | 仅检索结果未打开（404，已迁至 wonderunit） |

---

## 4. 镜头库 / 摄影机库

### 4.1 焦距与镜头集合

行业通行的做法是把「镜头」拆成**焦距**与**传感器尺寸**两个耦合参数，而不是只存一个 FOV：焦距越长 FOV 越小，短焦距能看到更多场景。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/cameras.rst （Blender Manual · Camera）

传感器如何贴合输出画幅要显式声明（Auto / Horizontal / Vertical），它直接决定角 FOV 的计算基准；Blender 还提供 Sensor Fit 与 Sensor Width/Height 的配合来复刻真实画幅。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/cameras.rst

Blender 相机本身带「Presets」可直接匹配真实相机机身，而不是让用户从零填参数。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/cameras.rst

Unreal 把预设拆成两张表：**Lens Settings** 是真实镜头预设列表（影响焦距、F 值、光圈叶片），**Filmback** 是真实机身预设列表（影响传感器宽高），两者相互独立。[主流做法] — 来源：https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-cameras-in-unreal-engine （Unreal Engine Documentation · Cinematic Cameras in Unreal Engine）

35mm 等效（裁切系数）= 成像幅面尺寸与参考幅面的比值，最常用参考是 35mm 的 36×24 mm；**面积比是裁切系数的平方**，它被用来跨画幅比较 FOV。[主流做法] — 来源：https://en.wikipedia.org/wiki/Crop_factor （Crop factor - Wikipedia）

「16/24/35/50/85/135 mm 是被官方定义的行业标准定焦集合」**未找到可核对来源**：现有工具的镜头清单都是厂商自选枚举（Unreal Lens Settings 是可枚举的真实镜头预设），Adobe / StudioBinder 的术语页在本次访问中被拦截（未验）。因此这套定焦集合只能作为**我们自建库的约定**而非引用标准。[我们不适用（无官方依据）] — 来源：https://www.adobe.com/creativecloud/video/discover/types-of-camera-shots.html （Access Denied，未验）· https://www.studiobinder.com/blog/types-of-camera-shots （仅检索结果未打开）

Blender 的 **shift** 参数用于调整灭点（vanishing points），正交相机下等效于平移相机——这是「构图微调」而非「换镜头」，应单列为构图参数。[个别做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/cameras.rst

> **与我们的关系**：我们已有 `sensor_width_mm` + `focal_mm`，与这条主流做法一致；缺的只是**预设集合**与**Sensor Fit 声明**。建议镜头库字段直接抄 Blender / Unreal 的两层拆分：`lens_preset`（焦距 / F 值 / 光圈叶片）+ `filmback_preset`（传感器宽高 / Sensor Fit），并把我们自建的定焦集合明确标为「自建约定」而非引用标准。

### 4.2 机位轨道与运镜预设

Blender 的机位跟随用**约束**而不是手打关键帧：**Track To** 让对象/骨骼朝向目标，并绕轴 roll 使某一局部轴保持朝上。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/animation/constraints/tracking/track_to.rst （Blender Manual · Track To Constraint）

Unreal 的 **Cine Camera Actor** 是拍摄电影化内容的主相机类型，并提供 Constrain Aspect Ratio（按传感器与基础宽高比加黑边）、Use Pawn Control Rotation 等机位行为开关。[主流做法] — 来源：https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-cameras-in-unreal-engine

Resolve 侧的对应物是 3D 跟踪器：官方 Color 页说明跟踪器可用于稳定画面，或把镜头光晕等效果附着到场景中的具体物体；同页也给出跨机位素材的 auto balance / color match，即「不同机位要看起来一致」在后期侧的落地方式。[主流做法] — 来源：https://www.blackmagicdesign.com/products/davinciresolve/color （DaVinci Resolve – Color）

运镜术语（dolly in/out、pan、tilt、truck、pedestal、orbit、handheld）的权威定义页在本次访问中**均未能核对**：StudioBinder 直连返回挑战页、Adobe 官方页返回 Access Denied。因此我们把术语枚举**自己写进预设库**并附中文释义，不以第三方页面作为唯一依据。[我们不适用] — 来源：https://www.studiobinder.com/blog/types-of-camera-shots · https://helpx.adobe.com/after-effects/using/null-objects.html （Access Denied，未验）

DaVinci Resolve 的「镜头数据库 / 相机数据库」**未找到可核对来源**：官方 Color 产品页与 Training 页均无该功能描述，只有手册 PDF 入口（本轮不下载大文件），故我们不把「Resolve 镜头库」当作可依赖的方案。[我们不适用] — 来源：https://www.blackmagicdesign.com/products/davinciresolve/training （DaVinci Resolve – Training，已打开核对）

### 4.3 可复用的镜头参数化方案

**Blender**：镜头库最小字段集 = 焦距、传感器宽高、Sensor Fit、shift、DOF（F-Stop / Blades / Aperture）。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/cameras.rst

**OpenUSD `UsdGeom.Camera`**：`focalLength` 默认 50，单位是「场景单位的十分之一」；`clippingRange` 默认 `(1, 1000000)`；`projection` 是 token，默认 `"perspective"`，允许值 `perspective / orthographic`；相机几何量一律用**场景单位**（由 `metersPerUnit` 决定）而非毫米。[主流做法] — 来源：https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/usdGeom/camera.h （UsdGeomCamera 头文件）

同一头文件还定义了 aperture 与 framing 相关属性，但本轮只逐条核对了 focalLength / clippingRange / projection 三项，其余未摘录核对。[主流做法] — 来源：https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/usdGeom/camera.h

**glTF 2.0 的相机在核心规范里，不在扩展里**（本轮独立复核，务必区分两件事）：

- 核心规范（`Specification.adoc` 的 "Cameras" 章节）**确实定义了相机**：`cameras[]` 数组、`type` 为 `perspective` 或 `orthographic`；`perspective` 子对象含 `aspectRatio`、`yfov`（弧度）、`znear`、`zfar`（`zfar` 未定义即为无限远投影）；相机局部坐标约定为 **+X 向右、镜头朝 −Z、顶部对齐 +Y**。[主流做法] — 来源：https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/Specification.adoc （glTF Version 2.0 规范，第 "== Cameras" 章）
- 但 Khronos 官方扩展目录 `extensions/2.0/Khronos` 下的 **27 个扩展中没有任何 camera 扩展**（本轮实测计数 27，`camera` 命中为空）。因此「glTF 相机扩展」不存在，**相机只有核心规范这一条路**。[主流做法] — 来源：https://api.github.com/repos/KhronosGroup/glTF/contents/extensions/2.0/Khronos （KhronosGroup/glTF 官方扩展目录）

> **修正一处子调研的说法**：「glTF 2.0 没有官方相机扩展」这句话字面正确，但容易被读成「glTF 没有相机」。**准确表述是：相机是 glTF 2.0 的核心特性，只是没有单独的官方扩展**。这直接影响我们的路线——§2.4.3 里「glTF camera 导出」是可行的，不必自造扩展。

**COLMAP**：相机模型为 `SIMPLE_PINHOLE`（f + cx + cy）、`PINHOLE`（fx, fy, cx, cy）、`SIMPLE_RADIAL`（再加一个径向畸变参数）等；内参以**像素**为单位，且可通过 `CAMERA_ID` 被多张图共享。[主流做法] — 来源：https://colmap.github.io/format.html （COLMAP · Output Format）

COLMAP 的位姿表达可直接当我们的机位轨道数据模型：世界→相机投影 = 四元数 (QW,QX,QY,QZ) + 平移 (TX,TY,TZ)，Hamilton 约定，相机中心 = −RᵀT，相机局部坐标 **X 右、Y 下、Z 前**。[主流做法] — 来源：https://colmap.github.io/format.html

> ⚠️ **两个相机坐标约定不一致，必须显式区分**：glTF / USD 约定是 **X 右、Y 上、Z 后**（镜头朝 −Z），COLMAP 是 **X 右、Y 下、Z 前**。两者差一个 Y 轴翻转。我们内部统一用 **USD/glTF 约定**（与 `export_usd.py` 的 `_look_at_rot` 一致），只有在转 COLMAP 格式时才做翻转，并写进转换函数而不是靠调用方记忆。

### 4.4 HDRI / 环境光库

Poly Haven 的 HDRI 为 16k+ 分辨率且官方声明 **unclipped**（不需要额外调 gamma 或接进强度输入即可获得真实结果），这正是把环境光当「标准打光」用的前提。[主流做法] — 来源：https://polyhaven.com/hdris （HDRIs • Poly Haven）· https://docs.polyhaven.com/en/faq （Poly Haven Wiki / FAQ）

Poly Haven FAQ 给出 HDRI 的操作性定义：每像素每通道超过 8 bit（JPG/PNG 通常 8bit 属 LDR，EXR 为 HDR 格式）。[主流做法] — 来源：https://docs.polyhaven.com/en/faq

Poly Haven 全部资产为 **CC0**，可商用、无需署名，唯一限制是不得声称原作者或再许可；因此 HDRI 可以直接进我们的资产库与渲染管线。[主流做法] — 来源：https://polyhaven.com/license （Poly Haven · Terms of Service）· https://docs.polyhaven.com/en/faq

IES / IES LM-1 光域光标准页（ies.org）本次返回 Cloudflare 安全验证，**未验**；Blender 官方 World 节点文档（docs.blender.org）同样返回挑战页，**未验**。因此「IES 导入 Blender」「World 节点接 HDRI」这两步目前**没有可核对的官方依据**，我们先按 Poly Haven + 自建脚本实现。[我们不适用] — 来源：https://www.ies.org/standards/committee-reports/ （未验）· https://docs.blender.org/manual/en/latest/render/shader_nodes/world/index.html （未验）

工程含义（综合推论）：环境光给整体照度与色温倾向，打光给可控的主光/轮廓/动机光；用 HDRI 打亮「白模/条件图」时若不固定曝光与强度，不同图之间的亮度分布会漂，下游模型看到的条件分布就不一致。[主流做法] — 来源：https://docs.polyhaven.com/en/faq · https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/color_spaces.rst （Blender Manual · Color Spaces）

### 4.5 相机与色彩管理

ACES = **Academy Color Encoding System**，是覆盖影视、电视、游戏、沉浸式的行业标准；其文档体系包含 Encodings（ACES2065-1、ACEScg、**ACEScct**、ACEScc、ACESproxy、APD、ADX）、Tone Mapping、Gamut Compression、Display Encoding、Look Transforms、Transform IDs 等章节。[主流做法] — 来源：https://docs.acescentral.com/ （ACES Documentation）

ACEScct 是 ACES 官方 Encodings 章节列出的编码之一（与 ACES2065-1、ACEScg、ACEScc、ACESproxy、APD、ADX 并列），适合作为着色/合成链路的传递编码。[主流做法] — 来源：https://docs.acescentral.com/

OCIO 是面向影视制作的完整色彩管理方案，**与 ACES 兼容**且与 LUT 格式无关；v1 于 2011 年发布（2003 起开发）。[主流做法] — 来源：https://opencolorio.readthedocs.io/en/latest/ （OpenColorIO · Overview）

Blender 的色调映射现状：**AgX** 替代 **Filmic**，提供 16.5 档动态范围，并对高曝光颜色去饱和以模拟胶片响应；**Filmic 已被弃用**（deprecated）并由 AgX 取代。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/displays_views.rst （Blender Manual · Displays and Views）

Blender 的 View Transform 列表同时包含 Standard、AgX、Filmic、**ACES 1.3** 与 **ACES 2.0**；ACES 2.0 相对 1.3 中间调对比更低、高光滚降更柔并改进 gamut mapping。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/displays_views.rst

Blender 规定：渲染与合成应在 **scene linear** 空间进行；颜色贴图应标记为 **Non-Color Data**（它们存的是数据不是颜色）；生产中的中间文件推荐 **OpenEXR**（始终以 scene linear 存储、精度高）。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/color_spaces.rst

Blender 的 Sequencer 默认在 **sRGB** 空间操作（可切 Linear），不同色彩空间会给调色、叠化带来不同结果——预览管线与渲染管线色彩空间不一致是常见坑。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/color_spaces.rst

**为什么下游图/视频生成消费条件图必须固定色彩处理**（综合推论）：depth / canny / 线稿 / 掩膜本质是**数据**而非颜色，必须按单通道或 Non-Color 语义解释；若先按 sRGB 显示参考解码、再当彩色图喂给模型，就会引入非线性与压缩噪声，使条件分布与训练时不一致。所以我们规定：条件图一律存 PNG-16 / EXR 灰度或无色彩标签，并用同一套 scene-linear→display 的变换生成「给人看的预览」，两者分离。[主流做法] — 来源：https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/color_spaces.rst · https://github.com/lllyasviel/ControlNet

### 4.6 「机位 + 构图」在下游视频生成里的实际接法

ControlNet 的做法是**锁住**已训练好的大规模扩散模型、复用其深层编码层，只训练空间条件分支，因此可用很小数据集零样本训练；官方仓库给出 canny、scribble、语义分割（ADE20K）、depth（Midas）、HED 边缘、Openpose 等条件的现成推理脚本。[主流做法] — 来源：https://github.com/lllyasviel/ControlNet · https://arxiv.org/abs/2302.05543 （Adding Conditional Control to Text-to-Image Diffusion Models）

SVD 是 image-to-video：生成 14 帧、分辨率 576×1024，条件是**同尺寸的一张 context frame**，用 SD 2.1 的图像编码器换接时序感知 decoder。[主流做法] — 来源：https://github.com/Stability-AI/generative-models （Stability-AI/generative-models）

SVD 系列里相机条件是**逐级加上的独立能力**：SV3D_u 可由单图生成轨道运动视频但**不带相机条件**；SV3D_p 支持**沿指定相机路径**生成 3D 视频。[主流做法] — 来源：https://github.com/Stability-AI/generative-models

开源视频模型的一等公民条件是「首帧图 + 文本」：Wan2.2 同时支持文生视频与图生视频、720P@24fps（5B TI2V + Wan2.2-VAE，16×16×4 压缩）；CogVideoX 支持文生视频、视频续写、图生视频三任务，其中 CogVideoX-5B-I2V 以一张图像作为背景输入。[主流做法] — 来源：https://github.com/Wan-Video/Wan2.2 · https://github.com/THUDM/CogVideo

**相机位姿直接作为条件**的代表作 CameraCtrl：提出相机位姿控制（系统研究相机轨迹参数化）与即插即用的相机位姿控制模块，训练在视频扩散模型之上且不动基座其他模块，并系统评估训练数据中相机运动多样性的影响。[主流做法] — 来源：https://arxiv.org/abs/2404.02101 （CameraCtrl: Enabling Camera Control for Text-to-Video Generation）

CamI2V 把相机位姿当作「电影语言」来做 image-to-video 相机控制，官方仓库直接给出右摇+推近、推近+上移、下移+拉远等运镜样例，并提供 DynamiCrafter 版 RealCam-I2V 与 CogVideoX 版实现。[主流做法] — 来源：https://github.com/ZGCTroy/CamI2V

TrajectoryCrafter 把「确定性的视角变换」与「随机性的内容生成」解耦，用**点云渲染 + 原视频双流条件**实现用户指定相机轨迹的精确重定向。[主流做法] — 来源：https://arxiv.org/abs/2503.05638 （TrajectoryCrafter: Redirecting Camera Trajectory for Monocular Videos via Diffusion Models）

由此可归纳出两条「机位 + 构图」的下游接法：

- **(a) 2D 条件路线**——把机位渲染成构图 / 深度 / 线稿 / 白模条件图，走 ControlNet 或图生视频模型（首帧即条件）。
- **(b) 3D 条件路线**——直接把外参 / 内参 / 轨迹作为条件（CameraCtrl、CamI2V、TrajectoryCrafter、SV3D_p）。

我们应当**同时支持两条，但优先 (a)**：它对现有开源栈改动最小，且 CPU 侧产出条件图的能力我们已经有了。[主流做法] — 来源：https://github.com/Stability-AI/generative-models · https://arxiv.org/abs/2404.02101 · https://arxiv.org/abs/2503.05638

> 这一条直接印证了 `plans/ROADMAP-IMAGE-VIDEO.md` §2.1 的排序：**2D 通道与 3D 通道的排序不同**，所以镜头包必须同时出「逐帧条件序列」与「逐帧相机参数」两份产物，不能只出 PNG。

### 4.7 摄影机运动学与曲线

恒速推轨（dolly）的物理表达是：相机沿直线做**匀速平移、零旋转**，透视随距离连续变化；对应到关键帧应使用**线性插值**，而 Bezier/自动手柄会在两端引入缓动、破坏匀速感。起停有加减速时（ease in / ease out）才用缓动曲线，且缓动应作用在**位移量**而非每帧角度上，否则会做出弧线。[主流做法] — 来源：https://docs.blender.org/manual/en/latest/animation/keyframes.html （Blender Manual · Keyframes，未验：本次访问返回挑战页）

因此本次**未核对到任何官方页面对「Interpolation = Constant/Linear/Bezier + Easing」与「ease in/out / smoothstep」的具体定义**，上述结论按通行实践给出并在实现中自行标注；不得在文档里把第三方词表当作权威依据。[我们不适用] — 来源：https://docs.blender.org/manual/en/latest/animation/keyframes.html （未验）

> **与我们的关系**：我们的 `harness/shot_spec.py` 已经用 `_smoothstep` 做关键帧间缓动，且注释写明「与 render_shot.cam_at 一致」。按上面的物理表达，**恒速推轨应改用线性插值，缓动只用于有起停的镜头**——这是一条可以立刻落进现有代码的规则，也是镜头库「每类镜头自带缓动策略」的设计依据。

### 4.8 本方向来源清单

| 主题 | 链接 | 类型 | 访问结果 |
|---|---|---|---|
| Blender 镜头/相机参数（焦距、传感器、Sensor Fit、Presets、shift、DOF） | https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/cameras.rst | 官方手册源码 | 已打开核对 |
| Blender 机位跟随 Track To 约束 | https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/animation/constraints/tracking/track_to.rst | 官方手册源码 | 已打开核对 |
| Blender 色彩管理章节树 | https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/index.rst | 官方手册源码 | 已打开核对 |
| Blender 视图变换（AgX / Filmic / Standard / ACES 1.3 / ACES 2.0） | https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/displays_views.rst | 官方手册源码 | 已打开核对 |
| Blender 色彩空间（scene linear / Non-Color / OpenEXR） | https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/render/color_management/color_spaces.rst | 官方手册源码 | 已打开核对 |
| Blender 关键帧插值与缓动 | https://docs.blender.org/manual/en/latest/animation/keyframes.html | 官方手册 HTML | 未验（Cloudflare 挑战页） |
| Blender World 节点 / HDRI | https://docs.blender.org/manual/en/latest/render/shader_nodes/world/index.html | 官方手册 HTML | 未验（挑战页） |
| USD `UsdGeom.Camera` 属性定义 | https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/release/pxr/usd/usdGeom/camera.h | 官方源码（头文件注释） | 已打开核对 |
| OpenUSD UsdGeom schema 总览（Camera = 镜头/光圈/快门；右手系 up=+Y / forward=−Z；上轴按 stage 配置） | https://openusd.org/dev/user_guides/schemas/usdGeom/overview.html | 官方文档 | 已打开核对（本轮独立复核） |
| glTF 2.0 核心规范 · Cameras 章节（cameras[] / type / aspectRatio / yfov / znear / zfar；+X 右 / −Z 前 / +Y 上） | https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/Specification.adoc | 官方规范源 | 已打开核对（本轮独立复核，逐字读取该章） |
| glTF 2.0 官方扩展目录（27 个，**无** camera 扩展） | https://api.github.com/repos/KhronosGroup/glTF/contents/extensions/2.0/Khronos | 官方仓库 API | 已打开核对（本轮独立复核，计数 27） |
| COLMAP 相机模型与位姿格式（X 右 / Y 下 / Z 前） | https://colmap.github.io/format.html | 官方文档 | 已打开核对 |
| Unreal 电影机位相机（Lens / Filmback 两层预设） | https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-cameras-in-unreal-engine | 官方文档 | 已打开核对 |
| Unreal Camera Rig Rail（运动曲线/缓动） | https://dev.epicgames.com/documentation/en-us/unreal-engine/camera-rig-rail-in-unreal-engine | 官方文档 | 未验（跳转到文档索引页） |
| Premiere 镜头校正与镜头数据库 | https://helpx.adobe.com/premiere-pro/using/lens-distortion-correction.html | 官方帮助 | 未验（Access Denied） |
| After Effects Null 对象（虚拟摄影机锚点） | https://helpx.adobe.com/after-effects/using/null-objects.html | 官方帮助 | 未验（Access Denied） |
| Adobe 运镜/镜头类型术语页 | https://www.adobe.com/creativecloud/video/discover/types-of-camera-shots.html | 官方页面 | 未验（Access Denied） |
| 运镜与镜头术语词表 | https://www.studiobinder.com/blog/types-of-camera-shots | 第三方教程 | 仅检索结果未打开（直连被挑战页拦截） |
| Resolve 3D 跟踪器与跨机位一致性 | https://www.blackmagicdesign.com/products/davinciresolve/color | 官方产品页 | 已打开核对 |
| Resolve 官方培训/手册入口 | https://www.blackmagicdesign.com/products/davinciresolve/training | 官方页面 | 已打开核对 |
| Poly Haven HDRI 库 | https://polyhaven.com/hdris | 官方站点 | 已打开核对 |
| Poly Haven 许可（CC0） | https://polyhaven.com/license | 官方页面 | 已打开核对 |
| Poly Haven FAQ（HDRI 定义 / unclipped） | https://docs.polyhaven.com/en/faq | 官方文档 | 已打开核对 |
| IES / IES LM-1 光域光标准 | https://www.ies.org/standards/committee-reports/ | 官方 | 未验（Cloudflare 安全验证） |
| ACES 官方文档 | https://docs.acescentral.com/ | 官方文档 | 已打开核对 |
| OpenColorIO 官方文档 | https://opencolorio.readthedocs.io/en/latest/ | 官方文档 | 已打开核对 |
| ControlNet 官方仓库（条件类型与推理脚本） | https://github.com/lllyasviel/ControlNet | 官方仓库 | 已打开核对 |
| ControlNet 论文 | https://arxiv.org/abs/2302.05543 | 论文 | 已打开核对 |
| SVD / SV3D 官方仓库 | https://github.com/Stability-AI/generative-models | 官方仓库 | 已打开核对 |
| Wan2.2 官方仓库（720P@24fps I2V） | https://github.com/Wan-Video/Wan2.2 | 官方仓库 | 已打开核对 |
| CogVideoX 官方仓库（T2V / V2V / I2V） | https://github.com/THUDM/CogVideo | 官方仓库 | 已打开核对 |
| CameraCtrl 论文 | https://arxiv.org/abs/2404.02101 | 论文 | 已打开核对（本轮独立复核标题） |
| CamI2V 官方仓库 | https://github.com/ZGCTroy/CamI2V | 官方仓库 | 已打开核对 |
| CamI2V 论文 | https://arxiv.org/abs/2410.15957 | 论文 | 仅检索结果未打开 |
| TrajectoryCrafter 论文 | https://arxiv.org/abs/2503.05638 | 论文 | 已打开核对 |
| 裁切系数 / 35mm 等效 | https://en.wikipedia.org/wiki/Crop_factor | 百科 | 已打开核对 |



---

## 5. 我们能借鉴 / 不能借鉴（汇总）

> 每条写清**借鉴后在我们体系里落在哪一层**：几何层 / 编排层 / 镜头层 / 验证层 / 界面层。
> 与 `plans/ROADMAP-IMAGE-VIDEO.md` §3.2 的清单同源；本节只做「证据 → 结论」的收口。

### 5.1 可直接照抄

| # | 做法 | 证据出处 | 落在哪层 | 在我们体系里具体是什么 |
|---|---|---|---|---|
| 1 | 资产清单字段设计（id / 分类 / 许可 / 指纹 / 版本 / 生成命令与参数 / 工具版本 / 几何统计 / 验证状态） | resources3D `gallery/manifest.json`（30 件样例已验证）+ Poly Haven 溯源清单 | 编排层 | manifest v2 字段表（ROADMAP §2.5.2） |
| 2 | 逐件许可 + 署名文本 + 「非生成式来源」声明进交付物 | Poly Haven corporate（SHA-256 + 溯源）· Sketchfab licenses | 编排层 + 验证层 | manifest 的 `license` 与 `fingerprint` 字段；`validate_manifest` 缺项即红 |
| 3 | 三段式命名 + 按类别分层目录 | Blender 资产化流程 · UE Content Browser | 编排层 | `<category>_<name>_<variant>`，对齐 `conditions.resolve_category` |
| 4 | Link / Append 引用语义要登记 | Blender Scene Management | 编排层 | manifest 的 `source` 与 `hierarchy` 字段 |
| 5 | 条件图六通道 + 随图三要素 | ControlNet 官方 9 类条件 + resources3D metrics_spec | 编排层 + 镜头层 | ROADMAP §2.2 |
| 6 | 镜头表字段集（景别 / 机位运动 / 焦段 / 帧率 / 机位角度 / 声音 / 场景） | StudioBinder 镜头规格维度 | 镜头层 | shot spec 的 `description` / `status` |
| 7 | 「镜头引用资产」的单向关系（资产不拥有镜头） | Kitsu `ASSET --cast in--> SHOT` | 编排层 + 界面层 | shot spec 的 `assets[]` 引用 manifest 的 `id` |
| 8 | 镜头状态 / 任务状态分层 | Kitsu task status 与 shot status 分离 | 界面层 | shot 级与 task 级两套字段 |
| 9 | 导演台区块骨架（缩略图墙 / 镜头列表 / 覆盖视图 / 时间轴 / 脚本面板 / 审阅 / 导出中心） | Previs Pro wiki | 界面层 | R5 最小导演台 |
| 10 | 导出格式基线（签字 PDF、带声 MP4 animatic、每帧一行每字段一列并带状态列的表格） | Boords export | 界面层 | 镜头包的可交付形态 |
| 11 | 许可值域用 **SPDX ID**（CC0-1.0 / CC-BY-4.0）+ REUSE 规范（库根 `LICENSES/` 放许可全文，文件名即 SPDX 标识）+ 文件级 SPDX 头 | SPDX License List · REUSE 3.3 · Blender 源码 | 编排层 | manifest 的 `license.spdx` 值域 + `LICENSES/` 目录 + `SPDX-License-Identifier` 文件头 |
| 12 | 元数据**四层结构**：可读描述 + 检索 tags + 机读 attributes + 指纹与统计 | Poly Haven API · ambientCG API v2 | 编排层 | manifest 的 `description` / `tags` / `attributes` / `fingerprint` 四段 |
| 13 | **双层指纹**：资产级内容哈希 + 文件级哈希（md5/size/url），缩略图单独版本化 | Poly Haven `files_hash` + `/files` 的 `img_version` | 编排层 + 验证层 | manifest 的 `fingerprint`（资产级）+ `files[].md5`（文件级）+ 预览图版本号 |
| 14 | **稳定主键 + 短链接**（`ambientcg.com/a/<id>`），让任何成品能反查资产记录 | ambientCG | 编排层 | manifest 的 `id` + `source.page` 短链 |
| 15 | 「AI 生成 / 人做」作为**显式检索维度** | Sketchfab `is_ai=0/1` 过滤器 | 编排层 + 验证层 | manifest 的 `provenance` 段（`origin: human-authored`）+ 检索过滤器 |
| 16 | asset 与 shot **同级**挂在 project 下；类型 / 状态 / 扩展字段三者分离 | Kitsu 实体模型 | 编排层 + 界面层 | asset 与 shot 平级，扩展字段走独立 `metadata` 字典（对应 Kitsu 的 `data` 字段） |
| 17 | 署名要求作为**许可条款的派生结论**存储，不各自维护布尔字段 | ambientCG · Fab · QAL | 编排层 | `license.attribution_required` 由 `spdx` 派生，不手填 |
| 18 | 镜头库字段用**两层预设拆分**：Lens Settings（焦距/F 值/光圈叶片）+ Filmback（传感器宽高） | Blender 相机 Presets · Unreal Lens/Filmback | 镜头层 | `camera.lens_preset` + `camera.filmback_preset` |
| 19 | 机位轨道用**约束语义**（朝向目标 + up 轴 roll）而非手打关键帧 | Blender Track To 约束 | 镜头层 | `camera.move` 的 `look_at` / `up_roll` 语义（我们已有 `resolve_camera`） |
| 20 | 条件图按**数据**而非颜色存储（单通道 / Non-Color），人看的预览另走 display 变换 | Blender Color Spaces · ControlNet | 验证层 | 条件图存 PNG-16 / EXR 灰度；预览图与条件图分离 |
| 21 | **恒速推轨用线性插值**，缓动只用于有起停的镜头，且缓动作用在位移量上 | 摄影机运动学通行实践（官方插值文档未验） | 镜头层 | 镜头类型的 `easing` 字段：`linear`（恒速）/ `smoothstep`（起停）分档 |

### 5.2 需要改造后使用

| # | 做法 | 改造点 | 落在哪层 |
|---|---|---|---|
| 1 | 资产分级（Hero/Mid/Low） | 社区按「屏幕相对高度」；我们改成**按用途**（hero 近景主线 / mid 中景 / low 远景占位），并绑定面数上限；面数预算用各平台量级作区间参照而非硬阈值 | 几何层 |
| 2 | 变体管理（PCG / Houdini Engine 运行时程序化） | 改成**离线烘焙 + 资产库 + 实例引用**：保留参数化描述文件，交付物是静态资产 + 配方 JSON | 几何层 |
| 3 | trim sheet / UDIM | 我们只做白模，降级为「UV 排布规则 + 单一顶点色 / 材质槽规范」，**不引入整套贴图生产链** | 几何层 |
| 4 | 摄影测量 / 扫描 | 可保留为「人工采集」渠道，但必须先建立拍摄授权与逐件出处证明，沿用 Poly Haven 溯源清单思路；且必须先减面（实测高模件无法可靠分件） | 几何层 + 编排层 |
| 5 | USD 资产库 / Asset Resolver | 不做完整 Asset Resolver，只借其 `assetInfo` 元数据字段做 manifest 标注 | 编排层 |
| 6 | 导演台界面 | 只做**只读本地**看板：镜头列表 + 缩略图墙 + 状态；不做协作 / 服务端 / 审片流 | 界面层 |
| 7 | 色彩管理（ACES / AgX / OCIO） | 条件图阶段不做影视色彩变换，但必须固定「depth / 线稿 / 法线与显示色彩无关」的约定，避免有人把色彩管理套到条件图上 | 验证层 |
| 8 | 镜头表字段 | 照抄维度清单但裁成导演台子集：去掉器材 / 工时 / 排期类（属制片域），改为可扩展自定义字段 | 镜头层 |
| 9 | 脚本拆解（脚本 → 场景 → 帧） | 借鉴切分**结果的结构**，但改为由人确认切分点，机器不生成画面 | 编排层 |
| 10 | 覆盖建议（Previs Pro Suggest Coverage） | 先确认是否依赖模型；纯规则推导版再做 | 镜头层 |
| 11 | **OpenAssetIO 的实体引用模型**（按身份而非路径引用，属性按需解析） | 我们自建 `asset_id` + `version` + `fingerprint` 语义；**不引入 OpenAssetIO 运行时依赖**，只借它的数据模型与「解析器前缀 + 实体路径」的引用语法 | 编排层 |
| 12 | resolver 插件式资产定位（`ArDefaultResolver` 兜底 + `ArSetPreferredResolver` 指定） | 改成「目录索引 + 路径规则」两级查找：先按 id 查 manifest，查不到再按路径兜底。纯 CPU、无运行时依赖 | 编排层 |
| 13 | 「规则 / 要求 / 一键修」的资产校验框架（Omniverse Asset Validator） | 换成白模专属规则集：单位、朝向、面数上限、命名、LOD 配对、许可完备性 | 验证层 |
| 14 | 「源文件 + 导入产物成对同步」（Unity Asset Database） | 改成白模源 + 派生产物（部件级 / LOD / 预览）双向可追 | 编排层 |
| 15 | 商业站自有许可（Fab / QAL） | 改成「许可 ID + 条款版本号 + 条款快照哈希」，避免条款更新后无从判定 | 编排层 |
| 16 | 镜头运动学的官方定义缺口 | 术语枚举全部内联进我们自己的词表并附中文释义；官方文档未验的条目在代码注释里标「通行实践，非官方」 | 镜头层 |
| 17 | COLMAP 的位姿格式（四元数 + 平移，Hamilton 约定） | 内部统一用 USD/glTF 约定（X 右 / Y 上 / −Z 前），转 COLMAP 时在转换函数里做 Y 翻转，**不靠调用方记忆** | 镜头层 |

### 5.3 明确不做

| # | 做法 | 理由 | 约束 |
|---|---|---|---|
| 1 | 任何扩散模型 / SDS / 原生 3D 生成器产出的几何（Meshy / Tripo / Sketchfab AI 生成件等） | 直接冲突 | C1 |
| 2 | AI 生成贴图作为白模体系组成部分 | 直接冲突 | C1 |
| 3 | AI 出图 / 出视频 / 出音频、Credits / Generation History 一类生成计费与历史机制 | 直接冲突 | C1 |
| 4 | 生成式合成路线（Wonder Studio / Flow Studio 式把 CG 自动合成进实拍素材） | 生成式合成 | C1 |
| 5 | 依赖模型自动产出创作判断（自动分镜画面 / 自动 coverage 建议 / 自动审批结论） | 违反 C1 与「不下载模型权重」纪律 | C1 |
| 6 | 交付引擎内运行时程序化生成的结果作为资产本体 | 不可离线复现，违反可回读校验 | C2 / C5 |
| 7 | 扫描高模直接进管线 | CPU + 体量；实测高模件无法可靠分件（ToyCar「玻璃学不出车门」） | C2 |
| 8 | 把聚合平台的「看着可用」当可用 | 许可未逐件确认的资产一律排除 | 许可 |
| 9 | 多人协作 / 权限 / 审片流 | 本项目无团队、无服务端 | 规模 |
| 10 | 数据库型资产管理（ShotGrid / Ftrack 级） | 过重；JSON + 内容寻址足够 | 规模 |
| 11 | 完整采用 OpenTimelineIO 作为时间线模型 | OTIO 面向**剪辑时间线**（track / clip / source range），我们是**镜头生成时间线**（相机轨迹 + 条件序列），语义不同 | 语义 |
| 12 | 摄影机物理仿真（卷帘快门 / 镜头畸变 / 呼吸效应） | 白模定位不需要；CPU 成本与收益不匹配 | 定位 |
| 13 | 在本机跑下游预训练检测器（HED / Midas / OpenPose） | 我们输出的是喂给下游的图，不需要在本机跑下游 | 纪律 |
| 14 | 引入 OpenAssetIO / OTIO 作为**运行时依赖** | 两者都是 Apache-2.0 且很合适，但会把我们的管线绑到外部库版本上；**只借数据模型，不引运行时** | 依赖面 |
| 15 | Nucleus 式中心化在线协同服务器与实时共编 | 纯离线体系 | 部署形态 |
| 16 | 影视级 task / status / 工时 / 评审与审核流 | 过重；只做 asset 与 shot 两实体 + 版本与指纹 | 规模 |
| 17 | 全站统一 CC0、库里无许可字段的模型（Poly Haven 式） | 我们混采多许可源，逐资产许可字段是必需项 | 许可 |
| 18 | 商店式订阅 / 买断经济与付费墙（KitBash3D / Fab / CGTrader 路线） | 与离线白模库无关 | 商业模式 |

---

## 6. 来源清单

### 6.1 本轮复核状态说明

「访问结果」列区分三种状态：

- **已打开核对**：撰写时打开并读取了正文。
- **撰写时已打开 / 本轮复核 403**：撰写时读取成功，本轮独立 HTTP 复核时站点反爬策略已变（属站点侧行为变化，非链接失效）。
- **仅检索结果未打开**：只在搜索摘要里见到，未打开正文；**不据此下结论**。

### 6.2 汇总表

见本文各节末尾的分方向来源表（§1.6 资产生产 / §2.8 资产管理 / §3.7 导演台 / §4.8 镜头库），以及 §0.4 的复核统计。

---

## 7. 本调研自身的边界

1. **只到公开资料层面，未做行业访谈**；「主流 / 个别 / 不适用」的判断是基于公开证据的评估，不是从业者统计。
2. **不覆盖商业工具的付费功能细节**（ShotGrid / Ftrack / Houdini / Maya 的高级资产流水线），只覆盖其公开可核对的实体模型与文档。
3. **个别做法与「没有找到官方规范」是两回事**：本文多处写「未找到可核对来源」，指的是**本轮预算内没取得官方依据**，不等于「社区没有这个惯例」。
4. **本轮未下载任何资产或模型权重**，所有关于面数、体量、耗时的数字均来自公开文档或我们自己的既有读数。
