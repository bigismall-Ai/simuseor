# ROADMAP-IMAGE-VIDEO · 面向「图 / 视频生成」用途的下一阶段路线

> **📄 本文是细节存档。入口是 [`plans/ONE-PAGE.md`](./ONE-PAGE.md)**——只想知道结论和下一步，读那一页就够（一屏读完）。
> 这一页背后的全部依据都在本文：现状盘点的每个读数、每条路线建议的推导、每个阶段的交付物与验收方式、风险边界、拍板决策点的完整选项。
> 可视化速览在 [`plans/roadmap.html`](./roadmap.html)：首屏就是结论页，往下才是完整看板。

> 所属：`research/tree-resources-builder` · 路线与调研文档（**本轮不写实现代码**）
> 硬约束继承 `plans/PLAN.md` §0 的 C1–C5：禁 3D 生成式模型（扩散 / SDS / 原生生成器）｜本地全 CPU｜LLM 仅云端 API｜白模分几何层与非几何参考层｜交付物须含可回读校验的真实生成物。
> 取证口径：本文所有「现状」条目都指向仓库内**已存在的文件与已落盘的读数**；本文所有「建议」条目都在 C1–C5 内可执行。凡未实跑、未验证的内容，一律写明「未验」，不写成结论。
> 姊妹文档：调研正文见 `research/community_pipeline_practices.md`；既有结论的修正建议见本文 §8。

---

## 0. 一页读法

### 0.1 一句话结论

**这套白模体系对下游图/视频生成的核心价值不是「好看的模型」，而是「可回读的相机与结构数据」；因此下一阶段最该补的不是更多资产，而是①把条件图通道补成下游真正消费的那几件、②把运镜从一次推镜做成可复用的镜头库。** 资产侧的补全是必要的，但它的边际价值排在相机/条件图之后。

### 0.2 三个最关键的判断（详见 §2）

| # | 判断 | 依据 |
|---|---|---|
| J1 | **控制力排序要分两种消费通道说**。在「2D 条件图消费」（ControlNet 式）下，几何 ≈ 动作 ≈ 相机 > 特效；在「原生 3D / 相机位姿消费」下，相机 > 动作 > 几何 > 特效。既有报告「相机与动作最强、体积最弱」**成立但需补一个前提**：只有在下游做相机位姿 / 姿态序列条件化时，相机与动作才保持第一档。 | ControlNet 官方 README 的 9 类条件全是 2D 通道；`export_usd.py` 已能写相机时序 |
| J2 | **我们最缺的不是通道种类，而是通道的「成套契约」**。`conditions.py` 现在只出 depth / normal / seg 三张；下游最通用的线稿系（canny / m-lsd / hed / scribble）与人体姿态（pose）没有；而 depth 的极性与上轴在两套工作里是**相反的**。 | `shot_spec.py:SUPPORTED_CONDITIONS = ("depth","normal","seg")`；resources3D `wmcore.py` 深度为「近=1 远=0」 |
| J3 | **运镜要按「可校验量」而不是按「镜头名字」来建库**。社区的镜头预设是给美术用的，我们的镜头库是给下游模型和验证器用的——每个镜头类型必须自带一组可自动判定的构图/运动指标，否则只是「一条好看的关键帧」。 | `validate.py` 已有相机构图/视锥检查；`shot_001.json` 已有入画率与高度占比 |

### 0.3 本文的章节地图

| 章节 | 内容 |
|---|---|
| §1 | 现状能力盘点（基于 harness 与产物的真实盘点） |
| §2 | A 部分 · 面向图/视频生成的路线建议（控制信号排序 / 条件图 / 五类白模 / 运镜 / schema / 与 resources3D 的关系） |
| §3 | B 部分 · 社区做法的摘要与借鉴清单（细节见姊妹文档） |
| §4 | 阶段划分 R0–R7（目标 / 范围 / 交付物 / 验收 / 依赖 / 不做） |
| §5 | 明确不做 / 建议不做 |
| §6 | 风险与诚实边界 |
| §7 | 需用户拍板的决策点 |
| §8 | 对既有结论的修正建议（**只建议，不改既有文件**） |

---

## 1. 现状能力盘点（真实盘点）

### 1.1 三层视角的现状矩阵

白模体系按 PLAN.md C4 分几何层 / 非几何参考层；再加一层验证层（PLAN.md 范式 D 横切）。下表按**五类资产 + 运镜**逐格标注现状，**格内只写已落盘的事实**。

| 类别 | 几何层（已落盘文件） | 非几何参考层（已落盘文件） | 验证层（已落盘读数） | 缺口 |
|---|---|---|---|---|
| **人物** | `assets/geometry/character_hero.glb/.obj/.stl`（22 部件、3,344 面、1.74 m）；`soma_anny_adult.glb`、`soma_native_low.glb`、`soma_mhr_low.glb`、`soma_anny_low.glb`（SOMA-X 三后端 CPU 实跑） | `assets/nongeometry/character_rig.json`；`soma_anny_adult_joints.json/.npy`；`shot001_hero.npz`（pose 存储）+ `shot001_meta.json`；`motion_walk_2s.bvh` + `motion_walk_meta.json` | `validation_report.json` 16/16 通过，`character` 档：水密 22/22、体积 0.0819 m³、退化面 0、z 尺寸 1.740 m（期望带 1.6–1.86）、最大部件间隙 0.004 m、贴地最低点 z=0.0005 m | 面部/口型/手部细节；身份变体只有少数几个；服装是独立壳（`clothing_jacket.glb`，520 面），非贴合多件 |
| **植被** | `assets/geometry/vegetation_tree.glb`、`vegetation_tree_trunk.obj` | `assets/nongeometry/vegetation_params.json`（L-system 参数） | `assets/validation/public_decimated.json`：`island_tree_01` 1,599,403 → **74,097 面**；`public_normalized/island_tree_01.glb` 已落盘 | 树种配方只有 1 套；无实例化表；无分档 LOD 策略文件 |
| **道具** | `assets/geometry/prop_crate.glb/.stl`（**只有 1 件**） | 无道具专属台账（只有 `assets/validation/public_assets.json` 的 9 项公共件） | `public_assets.json` 9 项逐件带 sha256 / 许可 / 来源页 | **最大的空洞**：程序化 1 件 + 公共件 9 件，构不成「零件库」 |
| **载具** | `assets/geometry/vehicle_car.glb/.obj`（车身 loft + 抽壳 + 门缝 + **独立门板** + 4 轮 + 后视镜 + 前后灯 + 座椅/仪表台/方向盘代理）；`vehicle_boat.glb` | `assets/nongeometry/vehicle_dynamics.json`（轨迹 + 派生量：速度/加速度/横摆角速度/轮转角/世界加速度分解/悬挂姿态/转向灯） | `assets/validation/vehicle_parts.json`（分件与标签分类报告） | **没有变体**（同一拓扑多参数不可用）；零件库只有单车一套；飞机/轮船未实跑 |
| **场景** | `assets/geometry/scene_street.glb` + `scene_street.usda`（USD 汇合层） | `assets/nongeometry/scene_layout.json`（`units`/`up_axis`/`hero_source`/`objects[]`/`camera_ref`/`fx_ref`）；`crowd_layout.json`；`fx_proxy.json` | `validation_report.json` 含场景项（贴地/穿插/人群间距/构图/类别覆盖） | 只有 1 个街区；无分块 LOD 文件；公共件（3 件减面后）尚未混排进场景 |
| **运镜** | — | `assets/nongeometry/camera_path.json`（**4 个关键帧 / 87 个采样点 / 3.6 s / 24 fps**，一次推镜：eye `[7.4,-8.8,3.9]→[0.4,-5.2,1.62]`、focal 45→55 mm）；`assets/validation/shot_spec.json`（`camera.mode = mounted`，`actors[].track[]` 带 pos/yaw 时序） | `assets/validation/shot_001.json`：入画率 1.0（100%）、主体高度占比均值 0.52、贴地 0、脚滑均值 0.0047 m / 最大 0.0303 m、根速 0.436 m/s、**pass = true** | **只有 1 种镜头**（推）；没有镜头类型库、没有可校验的构图指标集、没有批量镜头包 |

### 1.2 harness 已有模块 → 能力 → 复用点

> 下表是后续所有阶段的地基。**路线建议不重新设计任何一件已有能力，只指出复用点与缺口。**

| 模块 | 已有能力 | 本路线复用点 | 缺口 |
|---|---|---|---|
| `conditions.py` | numpy z-buffer 软光栅；depth / normal / seg 三通道；语义调色板（`resolve_category`/`build_palette`）；近平面裁剪；背面剔除；`hide=True` 隐藏几何（POV 用）；`save_condition_pngs`；`conditions_check.json` 隐藏测试 | 条件图渲染主干，**不换**。已实测 512×512：光栅 70.85 ms、depth 1.05 ms、normal 5.9 ms、seg 5.28 ms、合计 83.24 ms，预算 1500 ms 内 | 缺 mask / lineart / pose 三通道；缺 sidecar 契约（画幅+焦距、near/far、通道语义） |
| `shot_spec.py` | 统一镜头描述：`camera.mode ∈ {world, mounted}`；`actors[].track[]`（pos + yaw）；`_smoothstep` 缓动；`resolve_camera(spec, t, asset_transforms)` 返回**世界坐标**；`validate_spec(spec)` | **运镜体系的地基**。加一个 `camera.move` 层即可长出镜头类型库，不必重写 | `SUPPORTED_CONDITIONS` 只列 3 通道；`camera` 字段无 `move.type` / `easing` / 手持参数；无「镜头包」概念 |
| `vehicle_dynamics.py` | `sample_track` / `track_to_matrix` / `derive_dynamics`（速度/加速度/横摆/轮转角/悬挂姿态/转向灯）+ 位置量化 9 位小数的精度教训 | 跟拍镜头的被摄体轨迹源；镜头包里的「运动校验量」的算法底座 | 无「载具类型 → 动力学预设」 |
| `vehicle_parts.py` | 无 scipy 的连通分量；按名字/几何分类部件（轮/门/灯/玻璃）；`split_vehicle_parts`；`decimate_by_part`（按部件减面、每件保底 12 面） | **道具/载具零件库的方法论模板**（命名 → 标签 → 分件 → 按件减面） | 只针对载具语义；没有通用的「资产 → 语义件」流水线 |
| `generate_assets.py` | 12 类资产的程序化生成器（人物/服装/道具/汽车/轮船/建筑/四足/植被/人群/特效/动作/相机/场景） | 五类补全的**生成侧底座**：新增类别应沿用同一套「参数 → 几何 → 落盘」形态 | 生成器是「一类一件」，不是「一类一族」 |
| `geomlib.py` | 几何工具库 | 所有新生成器的公共依赖 | — |
| `validate.py` | 水密/体积/退化面/尺度/部件数/悬空/贴地/穿插/人群间距/相机构图/类别覆盖 + BVH（关节限位/脚滑/角速度）+ camera/fx/layout/crowd/rig 校验器 | **验证层的现成骨架**：新增校验项只需加 `add(code, ok, msg, hint)` | 无「构图量化指标集」（覆盖率/居中偏移/离屏比例/速度曲线/抖动频带） |
| `pose_store.py` | pose 存储（只存 77 关节轴角 + 根位移，顶点由 SOMA 前向无损重建，比烘焙省 57×）＋跨解释器重建（.venv ↔ soma-venv） | **pose 关键点通道的数据源**：关节已在手，只需转成 OpenPose/COCO 关键点格式 | 无 pose → 关键点图导出器 |
| `export_usd.py` | USD 舞台：几何 + **相机时序**（`UsdGeom.Camera` + translate/rotate 时间采样 + focalLength 时间采样）+ UsdSkel 骨架 + FX 体积代理球 | 下游相机控制的载体 | 相机时序按 `samples[::6]` 抽样写入（87→15 帧）；未写 glTF camera；未写每帧内外参 JSON |
| `render_shot.py` | 帧序列渲染 + contact sheet + MP4（ffmpeg） | 镜头包的「可见预览」层 | 只渲「合成色图」，不批量出条件图序列 |
| `validate.py` / `verify_exports.py` / `verify_report.py` | 导出回读（24/24 通过）、离线报告校验（外链 0 / 图片全可解码 / JS 语法 / 无头浏览器 file:// 打开） | **本轮 `roadmap.html` 的验收方法直接沿用这套口径** | — |
| `make_shot_soma.py` | SOMA 原生姿态空间步态（A-pose 基座 + 摆腿摆臂 + 踝关节脚锁根位移）→ pose 序列 | 人物动作通道 | 无「外部 BVH 严格重定向」（现有为 `semantic_replay` 语义重放） |

### 1.3 产物实物清单（截至本轮实测）

| 项 | 数量 | 证据 |
|---|---|---|
| manifest 登记文件 | 79 件 / 8,168,502 字节 | `assets/manifest.json` |
| 几何文件 | 23 个（12 类资产 + 变体 + 多格式） | `assets/geometry/` |
| 预览图 | 55 张 | `assets/previews/` |
| 校验项 | **16/16 通过，pass_rate 1.0** | `assets/validation/validation_report.json`（生成于 2026-11-21 21:48:15） |
| 导出回读 | **24/24 通过** | `assets/validation/exports.json` |
| 公共资产 | 9 项 / 117,181,316 字节；许可 CC0 1.0、CC-BY、CC-BY 4.0 | `assets/validation/public_assets.json` |
| 公共资产减面 | ToyCar 108,936→29,998；island_tree_01 1,599,403→74,097；ambulance 2,804→1,497 | `assets/validation/public_decimated.json`（fast_simplification 0.2.0 / trimesh 5.2.1） |
| 竖切片 | 120 帧 / 24 fps / 720×404；入画 100%；高度占比 52%；脚滑均值 0.47 cm、最大 3.03 cm | `assets/validation/shot_001.json` |
| BVH 重定向读数 | 48 帧 / 2.0 s；脚滑均值 **1.35 cm**、最大 6.63 cm；方法 `semantic_replay` | `assets/validation/retarget_bvh.json` |
| 条件渲染耗时 | 512×512 合计 83.24 ms（预算 1500 ms） | `assets/validation/conditions_check.json` |

### 1.4 现状的四个空缺（按「对下游图/视频生成的阻塞程度」排序）

1. **条件图成套性不足**：只出 3 通道，且缺下游最通用的**线稿系**（canny / m-lsd / hed / scribble）与**人体姿态**（pose）。depth 极性与 resources3D 相反、上轴也相反，两套工作混用会静默出错。
2. **运镜只有一个样例**：一次推镜、一个相机路径、没有镜头类型、没有构图指标、没有镜头包。
3. **道具只有一个**：程序化 1 件 + 公共 9 件，缺「零件库」这一层。
4. **资产与镜头还不是一等实体**：`manifest.json` 只有 `path` + `bytes`，没有 id / 类别 / 许可 / 指纹 / 层级 / LOD / 验证状态；shot 也没有可引用的资产 id 列表。

---

## 2. A 部分 · 面向图/视频生成的路线建议

### 2.1 控制信号的层级排序（对既有结论的复核）

#### 2.1.1 排序必须分通道给，否则会误导

既有报告的结论是「相机与动作最强、体积最弱」。复核后**结论成立**，但必须补一个前提：**控制力不是信号的固有属性，而是「信号 × 下游接口」的乘积**。同一份相机数据，在不同下游接口里强度完全不同。

| 信号 | 在**2D 条件图**通道里的强度 | 在**原生 3D / 位姿**通道里的强度 | 最终以什么形式进入下游 |
|---|---|---|---|
| **相机（机位/焦距/时序）** | 中——焦距与位姿在投影成 2D 后**大部分信息不可逆丢失**，只剩下「构图」这一层 | **最强**——位姿可直接作为 3D 驱动条件（相机轨迹、视角一致性） | ① USD 相机时序（`UsdGeom.Camera` + 时间采样，`export_usd.py` 已能写）；② glTF camera（`cameras[]` + `type: perspective` + `aspectRatio`/`yfov`/`znear`/`zfar`）；③ 每帧内参外参 JSON（K/R/t）；④ 条件图里的构图约束（覆盖率/居中/离屏） |
| **动作（骨骼/轨迹）** | 高——可降维成 OpenPose/COCO 关键点图，是 ControlNet 的原生条件类型 | 高——序列姿态可被 3D-aware 视频模型直接消费 | ① 关键点图 PNG（由 SOMA 77 关节导出）；② BVH / UsdSkel 动画；③ 逐帧顶点或 pose 序列（`pose_store.py` 已有） |
| **几何（网格/代理）** | **高**——depth / normal / seg / lineart 四张图把三维结构压成二维，但下游就是吃二维的 | 中——几何本身对「视频生成」通常要先走重建或渲染才变成信号 | ① 条件图四件套（depth / normal / seg / lineart）；② mask（前景显式图）；③ GLB / USDA 几何本体 |
| **特效占位（体积/轨迹）** | **最弱**——体积没有标准下游接口，必须先压成深度/法线/遮罩才有效 | 弱——同上 | ① 深度/法线图上的补丁；② FX 事件时间轴（JSON）；③ USD 体积球串（`export_usd.py` 已有） |
| **权威数据表（manifest / validation / spec）** | **不产生任何视觉控制**（0 张像素） | 同样 0 | 不进入模型；它是**准入闸**——决定哪些资产能进管线、哪些镜头能算合格 |

#### 2.1.2 复核结论

- ✅ **「相机与动作最强」成立**，前提是下游真的提供 2D 条件图与位姿序列两类接口。
- ✅ **「体积最弱」成立**，且有工程后果：特效占位**不能作为主要控制手段**，只能作为在深度/法线上叠加的补丁。
- ⚠️ **需要修正的一处**：「几何是中间档」这个说法只在「原生 3D 通道」下成立；在 2D 条件图通道下，几何**与相机、动作同档**（都是二维图）。所以真正的排序不是「相机 > 动作 > 几何 > 体积」，而是：

> **通道决定排序，不信号决定排序。**
> 2D 通道：几何 ≈ 动作 ≈ 相机（都降维成图）> 特效
> 3D 通道：相机 > 动作 > 几何 > 特效

#### 2.1.3 这条排序对本项目的直接含义

1. **如果下游只用 2D 条件图**（ControlNet 式，当前生态最成熟），那么「多产几何」的边际收益**低于**「把条件图补成六通道并做好构图」。几何已经很够，几何图才是瓶颈。
2. **如果下游要做相机驱动的视频**（3D-aware / camera-conditioned），那么**镜头库的地位高于资产库**——这是 R2 阶段必须早做的原因。
3. **两张都要**的情况下，正确顺序是：先做条件图契约（R0/R1，因为它是所有路线的公共依赖），再做镜头库（R2），再补资产（R4）。资产补全虽然工作量大，但**不阻塞前两者**。

### 2.2 条件图通道补全（最高优先级的一步）

#### 2.2.1 下游到底要哪几张图

ControlNet 官方仓库 README 自己列出的条件类型共 9 个 Gradio 应用（canny / M-LSD(hough) / HED / scribble / fake-scribble / pose / seg / depth / normal），并点名三类检测器：HED 边缘检测、Midas 深度估计、Openpose。
resources3D 的 `eval/metrics_spec.md` 则把**下游条件图契约**定义为 **mask / depth / lineart / shade** 四件套，并要求「随图必须带三样东西」：画幅 + 焦距（`f_px`）、深度归一化区间（`near`/`far`）、通道语义 + 主体投影口径。

**两个口径合并后的六通道契约**（本项目建议的落地方案）：

| 通道 | 下游对应 | 我们有吗 | 怎么补（复用既有件） |
|---|---|---|---|
| `depth` | ControlNet depth / 指标 depth_structure_consistency | ✅ `conditions.py` | 保留；补 sidecar 声明 near/far 与极性 |
| `normal` | ControlNet normal | ✅ `conditions.py`（含 16bit 无损版） | 保留 |
| `seg` | ControlNet seg | ✅ `conditions.py`（语义调色板 + 类别表） | 保留；扩到新资产类别 |
| `mask` | 主体投影 / 前景遮罩 | ⚠️ 隐含（depth<1）但**没有独立 PNG** | 从 depth 前景掩码直接存 8bit PNG，零额外光栅成本 |
| `lineart` | ControlNet canny / m-lsd / hed / scribble；指标 edge_consistency | ❌ | 两种口径可选：① 从 seg/normal 的边缘提取（纯 numpy，成本低）；② 移植 resources3D `wmcore.line_art_from_face_id`（基于 face_id 取轮廓，轮廓纯度更好）。**建议 ②**，因为指标协议里的「轮廓纯度」正是为 face_id 路线写的 |
| `pose` | ControlNet pose（OpenPose/COCO 关键点） | ❌ | 由 `pose_store.py` 已有的 77 关节导出 COCO-18 / OpenPose-25 关键点 JSON + PNG。**零新增几何成本** |
| `shade` | 指标口径里的四件套之一 | ❌ | 可选：朗伯光照（resources3D `wmcore.rasterize` 已返回 `shade`）。**优先级最低**，因为没有标准下游接口吃 shade |

#### 2.2.2 必须先裁定的两件事（不裁定就合不了）

| 项 | tree-resources-builder 现状 | resources3D 现状 | 为什么危险 |
|---|---|---|---|
| **深度极性** | `conditions.py`：`DEPTH_ENCODING` 注释写明「**0=最近，1=最远**」，背景固定 1.0 | `wmcore.depth_to_unit`：「**近=1 / 远=0**」 | **完全相反**。两套图混用会让下游 depth 条件完全反相——而且是**静默**的，不报错、只是结果全错 |
| **上轴** | Z-up：`export_usd.py` 设 `UsdGeom.SetStageUpAxis(stage, Tokens.z)`，`scene_layout.json` 记 `up_axis: "Z"`，相机 `up=(0,0,1)` | Y-up：`wmcore.Camera.up = (0,1,0)` | 混用会让相机俯仰与投影整体翻转 |

> 注：USD 官方文档明确「UsdGeom uses a right-handed coordinate system where up is +Y, right is +X, and forward is -Z」，且**上轴是按 stage 配置的**（`SetStageUpAxis`）。所以我们用 Z-up 本身没错，但**必须在 sidecar 里显式声明 up_axis**，否则对方无法判读。

#### 2.2.3 随图 sidecar 的最小内容（把 metrics_spec 的「三样东西」固化）

```json
{
  "kind": "conditions_sidecar",
  "shot_id": "S03",
  "frame": 0,
  "resolution": [720, 404],
  "up_axis": "Z",
  "camera": { "focal_mm": 45.0, "sensor_width_mm": 36.0, "f_px": 900.0, "cx": 360.0, "cy": 202.0,
              "near": 0.05, "far": 200.0, "eye": [], "target": [] },
  "depth": { "encoding": "near=0,far=1", "background": 1.0, "unit": "normalized" },
  "channels": ["depth","normal","seg","mask","lineart","pose"],
  "mask_semantics": "subject_projection",
  "palette_version": "semantic-v1"
}
```

### 2.3 白模类别补全：人物 / 植被 / 道具 / 载具 / 场景

> 每类给出：下一步做什么 ｜ 用什么底座或模板库 ｜ 产出什么文件 ｜ 如何校验 ｜ 谁来做。
> 「谁来做」三档：**LLM 出配方**（云端 API，C3 允许）｜**程序化生成**（本地 CPU）｜**下载 CC0 资产**（本地脚本 + 台账）。
> 通用约束：**禁 AI 生成件与扩散/SDS 重建**（C1），扫描件需强减面与修复，许可逐件入台账。

#### 2.3.1 人物

| 项 | 内容 |
|---|---|
| **下一步做什么** | ① **身份变体族**：把 ANNY 六表型扩到 10 个组合（身高 × 体型 × 性别），产出同拓扑变体；② **人形部件拆分**：把 `vehicle_parts.py` 的「连通分量 + 名字/几何分类」方法论移植为 `human_parts.py`，产出头/躯干/上臂/前臂/手/大腿/小腿/脚 部件级白模，让下游能按语义开关；③ **服装贴合壳**：把现有 `clothing_jacket`（520 面独立壳）改为「人体底座 + 法向外扩 N cm + 分区（袖/身/领/下摆）」的贴合壳（resources3D 04 §2.6 已给出该做法，但本项目未实跑）；④ **面部**：只做线稿级别的极简体块（鼻/眼窝/下颌），不做表情 |
| **底座 / 模板库** | SOMA-X（Apache-2.0，可商用；本机已跑通 SOMA / MHR / ANNY 三后端，77 关节）＋ 现有 `generate_assets.py` 的体块人偶作**低模对照** |
| **产出什么文件** | `assets/geometry/soma_variants/soma_<backend>_<variant>.glb`（10 件）；`assets/geometry/character_parts/<variant>_parts.glb`（部件级）；`assets/nongeometry/character_rig.json` 扩到多变体；`assets/nongeometry/soma_variants.json`（参数与指纹） |
| **如何校验** | 复用 `validate.py` 的 `validate_geometry`：水密/体积/退化面/尺度（身高带 1.6–1.86 m）/部件数上限/悬空间隙/贴地；**新增**「部件间最小间隙 ≥ 0（不穿插）」「关节限位在 SOMA 77 关节表内」；服装壳与人体体块间隙 ≥ 阈值且不穿插 |
| **谁来做** | 变体参数 → **LLM 出配方**（云端 API 出参数 JSON）＋ 本地确定性前向；部件拆分 → **程序化生成**（复用 `vehicle_parts` 逻辑）；服装壳 → **程序化生成** |
| **明确不做** | 面部表情/口型（许可与 CPU 双重限制）、毛发、手指细节、皮肤材质 |

#### 2.3.2 植被

| 项 | 内容 |
|---|---|
| **下一步做什么** | ① **分档 LOD 规则落地**：把 `public_decimated.json` 里已经跑通的三条减面参数（ToyCar→30k、island_tree_01→60k 目标、ambulance→1.5k）抽象成通用 LOD 规则表（low ≤ 1k 面 / mid ≤ 8k / hero ≤ 50k），**注意 `island_tree_01` 实测减到 74,097 面（超过 60k 目标，因保底 12 面/部件与碎面限制）**，规则要按实测口径写，不能按目标值写；② **树种配方库**：把 L-system 参数化扩到 6 个树种配方（针叶/阔叶/灌木/枯木/草丛/藤蔓），每棵输出 trunk / crown 分件，便于 seg 标签与实例化；③ **实例化表**：同种树在场景里复用同一网格 + 每实例 transform/尺度扰动，落到 `scene_layout.json` 的 `instances[]`，并用 USD `PointInstancer` 表达（resources3D 已实测 `Scope.SetInstanceable(True)` / `PointInstancer`） |
| **底座 / 模板库** | 自建 L-system（`generate_assets.py` 已有）+ 已减面的 Poly Haven `island_tree_01` + Kenney nature-kit（已下载） |
| **产出什么文件** | `assets/geometry/vegetation/<species>.glb`（6 套）；`assets/nongeometry/vegetation_params.json` 扩为多树种 + LOD 规则 + 实例表；`assets/validation/vegetation_lod.json`（每件三档面数读数） |
| **如何校验** | 水密/退化面/尺度（树高带按树种先验，如乔木 4–25 m、灌木 0.5–3 m）/贴地；**新增** LOD 单调性（low ≤ mid ≤ hero 面数）与实例后总面数预算 |
| **谁来做** | 树种配方 → **LLM 出配方**（参数 JSON）＋ 程序化生成；LOD → **程序化生成**（`decimate_by_part` 已就绪）；hero 近景 → **下载 CC0 资产**（逐件入台账） |
| **明确不做** | 树冠写实细节（CPU 与「白模」定位双重不适）、风动形变模拟 |

#### 2.3.3 道具

| 项 | 内容 |
|---|---|
| **下一步做什么** | **补一个 20 件的 CC0 白模零件库 + 命名与许可台账 + LOD 规则。** 具体：① 选型——以 **Kenney** 为主源（CC0、面数 <1,000/件、风格统一、下载可脚本化），Poly Haven 高模件只作 hero 少量补入；② 每件走统一流水线：下载 → 归一化（轴向/尺度/单位，`preview_public.py` 已有 Y-up→Z-up 归一）→ 减面到三档 → 语义标签 → 命名 → 入台账；③ 命名规范 `<category>_<name>_<variant>`（如 `prop_crate_01`），与 `conditions.resolve_category` 的语义表对齐；④ 台账字段照抄 resources3D `gallery/manifest.json` 的资产清单设计（见 §2.5.3） |
| **底座 / 模板库** | Kenney（Car/Furniture/Nature/City Kit）+ Poly Haven models + Poly Pizza（**逐件核许可**）+ MakeHuman 服装包（已在手） |
| **产出什么文件** | `assets/geometry/props/<category>/<name>.glb`（20 件 × 3 档 LOD）；`assets/validation/prop_library.json`（台账）；`assets/nongeometry/prop_catalog.json`（检索用索引：类别/尺寸/面数/语义标签） |
| **如何校验** | 每件：水密/退化面/尺度（按类别先验给尺寸带，如「箱子 0.3–1.2 m」）/贴地/部件数/LOD 单调性；台账校验：每件都有 license + source_url + sha256 + 面数，缺一即判红（**这一条直接进 `validate.py` 的新校验器 `validate_manifest`**） |
| **谁来做** | 选取与归一 → **下载 CC0 资产** ＋ 本地脚本；台账与命名 → **程序化生成**；变体（换色/换比例/组合）→ **LLM 出配方** |
| **明确不做** | 扫描高模直接进管线（必须先减面并修复；ToyCar 实测 `parted_detail.reason` 已证明「玻璃学不出车门」，高模件只能做参考不能做部件级条件源）、CC-BY-NC / CC-BY-ND / Sketchfab Standard / GrabCAD 默认许可 |

#### 2.3.4 载具

| 项 | 内容 |
|---|---|
| **下一步做什么** | ① **同拓扑参数化变体**：把 `vehicle_car_parts()` 的 28 点截面环 + 站位表提升为 **schema 化配方**（`{length, width, height, wheelbase, roof_frac, window_band}`），使「掀背 / 三厢 / SUV / 皮卡」四种车身**同拓扑**，从而可复用同一套动画与部件库——这是本项目对「没有成熟开源参数化汽车底座」的**正解**（自己造一个够用的 schema，而不是找）；② **语义零件库**：把 `vehicle_parts.classify_component` 的分类结果固化为标准件（wheel / door / light / glass / seat / steering / mirror / bumper × 3–4 变体）；③ **载具类型 → 动力学预设**：`vehicle_dynamics.derive_dynamics` 已能给速度/加速度/横摆/轮转角/悬挂姿态，补充「轿车 / 皮卡 / 公交 / 自行车」四组参数；④ 飞机/轮船：OpenVSP / Freeship 路线**暂不实跑** |
| **底座 / 模板库** | 自建 schema（主）＋ 已减面的 Kenney car-kit（占位）＋ Poly Pizza 跑车（高保真参考，CC-BY 需署名） |
| **产出什么文件** | `assets/geometry/vehicle_car_<variant>.glb`（4 件，同拓扑）；`assets/geometry/vehicle_parts/<part>.glb`（零件库）；`assets/nongeometry/vehicle_dynamics.json` 扩为按类型分档；`assets/validation/vehicle_parts.json` 扩为多车 |
| **如何校验** | 复用 `vehicle_parts.json` 的分件报告；**新增**：同拓扑校验（四种变体的顶点索引与拓扑哈希一致，只有位置不同）、车轮着地不穿地、车门与车身间隙在 0–10 mm 带内（现有 `generate_assets.py` 的门板偏移 10 mm/2 mm 口径） |
| **谁来做** | schema 与零件 → **LLM 出配方** ＋ 程序化生成；占位件 → **下载 CC0 资产** |
| **明确不做** | 写实曲面/内饰细节/线束级 B 阶曲面 |

#### 2.3.5 场景

| 项 | 内容 |
|---|---|
| **下一步做什么** | ① **街区变体库**：3 种布局（住宅街 / 商业街 / 巷道），各出 layout JSON + 几何 + 语义标签；② **分块 LOD**：把 resources3D 已实测的 `UsdLod.RootAPI` / `OverrideAPI` 搬到 `scene_street.usda`，产 `scene_lod.usda`；③ **公共件混排**：把 3 件已减面的公共件（ToyCar 29,998 面 / island_tree_01 74,097 面 / ambulance 1,497 面）放进场景，验证「程序化资产 + 公共资产」混排；④ **布景元素表**：从道具库取件，声明「哪些进哪些镜头」 |
| **底座 / 模板库** | 现有 `generate_assets.py` 程序化街区 + 已减面公共件 + USD 汇合层 |
| **产出什么文件** | `assets/geometry/scene_<variant>.glb` + `.usda`；`assets/nongeometry/scene_layout.json` 扩为多场景 + `instances[]`；`assets/validation/scene_mix.json`（混排后的面数与穿插读数） |
| **如何校验** | 复用 `validate.py` 的场景档：贴地 / 人车穿插 / 人群间距 / 首帧构图 / 类别覆盖；**新增**：分块 LOD 层级正确性、块间不重叠（resources3D 已实测该机制）、实例化后总面数与包围盒层级 |
| **谁来做** | 布局配方 → **LLM 出配方**；几何 → **程序化生成**；近景件 → **下载 CC0 资产** |
| **明确不做** | 城市级大规模街区（CPU 与体量不划算）、真实地形高程场 |

### 2.4 运镜渲染：从「一次推镜」到「可复用镜头库」

#### 2.4.1 镜头类型库（8 类）

> 参数化表达统一为：`move = {type, duration_s, fps, start:{eye,target,focal_mm}, end:{eye,target,focal_mm}, easing, mount?, handheld?}`，挂载镜头用 `mount{asset, eye_local, target_local}` 复用 `shot_spec.py` 已有的 `mounted` 模式。

| # | 镜头 | 参数化表达 | 典型焦段 | 可校验量（自动判定） |
|---|---|---|---|---|
| 1 | **推** dolly in | eye 沿视线靠近 target，focal 可锁定 | 35–50 | 主体高度占比单调上升；速度曲线平滑（无折角） |
| 2 | **拉** dolly out | eye 远离 | 24–35 | 主体高度占比单调下降；主体仍在画幅内 |
| 3 | **摇** pan | eye 固定，target 绕 up 轴转 | 24–50 | 角速度 ≤ 上限；无 wrap 跳变；全程主体在视锥内的比例达标 |
| 4 | **俯仰** tilt | eye 固定，target 在俯仰面内转 | 24–50 | 俯仰角速度 ≤ 上限；地平线不穿出画幅高度占比异常 |
| 5 | **移** truck | eye 平行于地面横移 | 24–35 | 线速度恒定或按缓动；主体在视锥内比例 ≥ 阈值 |
| 6 | **跟** follow | eye 挂在被摄体刚体上（`mounted`） | 35–50 | 主体全程在画幅内；被摄体与机位距离恒定带宽内 |
| 7 | **环绕** orbit / arc | eye 绕 target 在水平面转 | 24–85（可变焦） | 角速度恒定；主体高度占比恒定；**与被摄体距离恒定**（这是环绕最容易破的指标） |
| 8 | **升降** pedestal / crane | eye 沿世界 up 轴升降 | 18–35 | 垂直速度符合缓动；主体不被裁切 |
| 9 | **手持** handheld | 基础轨道 + 受限频带噪声 | 35–50 | 噪声必须是**受限频带**（如 0.5–3 Hz 的正弦/柏林叠加），不是白噪声；位移幅度 ≤ 构图容差 |

> 共 8 类 + 手持共 9 种（把「跟」与「升降」并列统计）。每种必须自带上表右列的 2–4 个可自动判定的量，**没有可校验量的镜头不进入镜头库**。
>
> **两条本轮新增的实现规则**（来源已核对，见 `research/community_pipeline_practices.md` §4.7）：
> ① **恒速推轨用线性插值**，缓动曲线只用于「有起停」的镜头，且缓动作用在**位移量**上而不是每帧角度上（作用在角度上会做出弧线）。我们现有的 `shot_spec._smoothstep` 是无条件缓动，**镜头库落地时需按 move 类型区分 `linear` / `smoothstep`**。
> ② **焦距与机身分两张预设表**：Lens Settings（焦距 / F 值 / 光圈叶片）与 Filmback（传感器宽高 / Sensor Fit）相互独立——这与社区一致（Blender 相机 Presets、Unreal 的 Lens / Filmback 两表）；我们的 `sensor_width_mm` + `focal_mm` 已经是对应字段，只需补 `lens_preset` / `filmback_preset` 两个枚举。

#### 2.4.2 镜头包（Shot Package）的产出形态

**一个镜头包 = 一个目录，自包含、可单独交付**：

```
shots/<shot_id>/
├── shot_spec.json          # 场景 + 角色 + 相机 + 时间段 + 状态（§2.5.1）
├── camera/
│   ├── camera.usda         # USD 相机时序（逐帧时间采样，不抽样）
│   ├── camera.gltf         # glTF camera（perspective + yfov/znear/zfar）
│   └── intrinsics.json     # 逐帧 f_px/cx/cy + 近平面/远平面 + 内外参 R/t
├── conditions/             # 逐帧条件序列
│   ├── frame_0000_depth.png / _normal.png / _seg.png / _mask.png / _lineart.png / _pose.png
│   └── sidecar.json        # 画幅+焦距 / near-far / 通道语义 / up_axis
├── geometry/               # 该镜头用到的资产实例（GLB）
├── validation_report.json  # 几何 + 构图 + 运动 + 条件图四类校验
└── contact_sheet.jpg + previs.mp4
```

**为什么必须同时出「条件序列」和「相机参数」**：下游视频模型吃的是**逐帧条件序列**；3D 驱动视频吃的是**相机轨迹**。只出 PNG 会把焦距与位姿信息丢掉（§2.1 的核心结论）。

#### 2.4.3 镜头复用为下游相机控制的三种接法

| 接法 | 格式 | 我们已有 | 需补 |
|---|---|---|---|
| **USD 相机时序** | `UsdGeom.Camera` + translate/rotate/focalLength 的时间采样 | `export_usd.py` 已能写，但按 `samples[::6]` 抽样（87→15 帧） | 改为**逐帧写入**；补 `clippingRange`、`horizontalAperture` 与 `framing` 语义 |
| **glTF camera** | `cameras[]`：`type: perspective` + `aspectRatio` / `yfov`(rad) / `znear` / `zfar`；相机局部 +X 右、镜头朝 −Z、+Y 上 | 无 | 新增导出器。**好消息**：USD 相机约定（−Z 朝前、+Y 向上）与 glTF 一致，`export_usd.py` 的 `_look_at_rot` 可直接复用，不需要转轴。**注意**：相机是 glTF 2.0 **核心规范**的一章（`Specification.adoc` 的 "Cameras"），但 Khronos 官方扩展目录里**没有** camera 扩展（本轮实测 27 个扩展、无 camera）——所以走核心规范这条路，不必自造扩展 |
| **每帧内外参 JSON** | `f_px, cx, cy, K, R, t, near, far, W, H` | 无（`camera_path.json` 只有 eye/target/focal） | 新增导出器，并作为**唯一权威**（USD/glTF 都由它派生，避免三份数据漂移） |
| （参考）**COLMAP 位姿格式** | 四元数 (QW,QX,QY,QZ) + 平移 (TX,TY,TZ)，Hamilton 约定，相机中心 = −RᵀT | 无 | 我们内部统一用 USD/glTF 约定（X 右 / Y 上 / −Z 前）；转 COLMAP 时在转换函数里做 Y 翻转，**不靠调用方记忆** |

#### 2.4.4 运镜的验证清单（每镜必过）

1. 主体在画幅内比例 ≥ 阈值（现有 `shot_001.json` 的 `subject_inside_min` 口径，竖切片实测 1.0）。
2. 主体高度占比在目标带内（竖切片实测均值 0.52）。
3. 构图居中偏移 ≤ 容差。
4. 视锥内主体比例达标（需从 resources3D 的 `wmcore.points_in_frustum` 移植）。
5. 速度/角速度曲线连续（复用 `vehicle_dynamics` 的差分与量化口径；**注意它记录过的坑**：位置量化位数不够会让 1/dt 放大出假速度噪声）。
6. 焦距变化率 ≤ 上限（变焦太快会糊）。
7. 手持镜头的噪声落在受限频带内（否则是「抖」不是「手持」）。

### 2.5 镜头库与资产库的最小 schema 草案

#### 2.5.1 Shot spec 最小字段（对齐 `harness/shot_spec.py`）

| 字段 | 类型 | 现状 | 说明 |
|---|---|---|---|
| `shot_id` | str | ✅ 已有（`S03`） | 全局唯一 |
| `kind` | str | ⚠️ 其他 JSON 有 `kind`，shot_spec 无 | 统一为 `"shot_spec"` |
| `fps` / `duration_s` | num | ✅ 已有 | |
| `resolution` | [w,h] | ❌ 缺 | 必须有（sidecar 与条件图要引用） |
| `up_axis` | `"Z"` | ❌ 缺（只在 `scene_layout.json` 有） | 显式声明，防混用 |
| `assets[]` | `[{asset_id, transform, role}]` | ⚠️ `actors[]` 有 asset + track，无 asset_id 引用 | 改成引用 manifest 的 `asset_id` |
| `actors[]` | `[{asset, track[{t,pos,yaw_deg}]}]` | ✅ 已有 | 保留 |
| `camera.mode` | `"world"`\|`"mounted"` | ✅ 已有 | |
| `camera.mount` | `{asset, eye_local, target_local, up}` | ✅ 已有 | |
| `camera.move` | `{type, easing, handheld?}` | ❌ 缺 | **新增**：镜头类型库的核心字段 |
| `camera.keys[]` | `[{t, eye, target, focal_mm}]` | ✅ 已有 | 保留；`focal_mm` 是焦距控制入口 |
| `camera.sensor_width_mm` / `near` / `far` | num | ⚠️ `sensor_width_mm` 已有，near/far 缺 | 补 |
| `conditions` | `{channels[], depth{near,far,encoding}, mask_semantics, palette_version}` | ❌ 缺 | **新增**：条件图契约（§2.2.3） |
| `timeline.events[]` | `[{t, type, target}]` | ⚠️ `fx_proxy.json` 单独存在 | 合并进 shot，FX 才有时间轴归属 |
| `validation` | `{report_path, pass, checks[]}` | ❌ 无回链 | **新增**：shot → 验证报告 |
| `license` | `[{asset_id, license, source_url, attribution}]` | ❌ 缺 | **新增**：shot 必须带出资产许可，否则交付不可用 |
| `status` | `draft`\|`validated`\|`approved` | ❌ 缺 | 目录台语义（§3） |

#### 2.5.2 Asset manifest 最小字段

> 字段设计**照抄 resources3D `gallery/manifest.json`**（那份已经过 30 件样例验证），但并入本项目 `manifest.json` 的既有字段，向后兼容。

| 字段 | 类型 | 现状 | 说明 |
|---|---|---|---|
| `id` | str | ❌ 缺（现在只有 `path`） | 稳定标识，shot 通过它引用 |
| `path` / `bytes` | str / num | ✅ 已有 | 保留 |
| `category` | enum（载具/人物/植被/道具/场景/建筑/生物/人群/特效…） | ❌ 缺 | 对齐 `conditions.resolve_category` 的语义表 |
| `kind` | `"geometry"`\|`"nongeometry"`\|`"reference"` | ❌ 缺 | C4 的两层要在 manifest 里显式 |
| `license` | `{spdx, source_url, license_url, attribution_required, credit}` | ⚠️ 公共件在 `public_assets.json` 有，程序化件没有 | **统一到 manifest**。`spdx` 用 SPDX ID 作唯一值域（`CC0-1.0` 等）；`attribution_required` **由 `spdx` 派生**，不手填布尔位 |
| `provenance` | `{origin, statement, source_url}` | ❌ 缺 | **新增**：对应社区的 `is_ai=0/1` 过滤维度。C1 之下我们只产 human-authored 资产，但**台账里要有这个位**才能证明合规 |
| `attributes` | dict（机读属性） | ❌ 缺 | 对应社区四层元数据骨架：描述 / tags / attributes / 指纹 |
| `fingerprint` | `sha256` | ⚠️ 公共件有，程序化件无（`manifest.json` 只有 bytes） | **新增**：内容指纹。社区做法是**双层指纹**（资产级内容哈希 + 文件级哈希），我们照做两层 |
| `version` | str | ❌ 缺 | 语义化版本；镜头引用具体版本 |
| `source` | `{generator, cmd, params, tool_version}` | ❌ 缺 | 照抄 gallery manifest |
| `geometry` | `{verts, faces, watertight, bbox_m, up_axis, units}` | ⚠️ 在 `validation_report.json` 的 metrics 里，与 manifest 分离 | **合并进 manifest** |
| `hierarchy` | `{parent_id, children[]}` | ❌ 缺 | 支撑「模型 → 部件」与「场景 → 实例」 |
| `lod` | `{level, faces}` | ⚠️ 减面读数在 `public_decimated.json` | **合并** |
| `validation` | `{report_path, pass, checks[], validated_at}` | ⚠️ 分离 | **合并** |
| `tags` | str[] | ❌ 缺 | 检索用（社区惯例） |

#### 2.5.3 与现有文件的复用/缺口对照

| 现有文件 | 复用什么 | 缺什么 | 建议 |
|---|---|---|---|
| `assets/manifest.json` | `path` / `bytes` / `count` / `total_bytes` / `cpu_only` | 上面 12 个字段中的 11 个 | 升到 v2：保留 `files[]`，另加 `assets[]`（带 id 的条目），**不破坏** `verify_exports.py` 的读法 |
| `assets/validation/validation_report.json` | `summary` + `results[].checks[]`（含 code/ok/message/hint 四字段结构） | 资产 id 回链、条件图指标 | 增 `asset_id` 字段；增条件图指标段 |
| `assets/validation/public_assets.json` | 逐件 `name/category/source/page/license/license_url/files/bytes/sha256/stats/note` | 归一化后的 LOD 条目、`kind`、层级 | 作为 **asset manifest 的公共件来源**，被 manifest v2 引用而非并存 |
| `assets/nongeometry/scene_layout.json` | `units` / `up_axis` / `objects[]{name,category,transform,bbox_m,source}` | `asset_id` 引用、`instances[]` | 改 `objects[].source` 为 `asset_id`；加 `instances[]` |
| `assets/nongeometry/camera_path.json` | `keys[]` + `samples[]`（87 采样点） | 镜头类型、缓动、内参外参 | 升为 `camera/<shot_id>/intrinsics.json` 的**权威来源** |
| `assets/validation/shot_spec.json` | 整份 schema（`mode`/`mount`/`actors[].track`） | 上面 11 个字段 | 补字段即为 v2 |
| `assets/validation/shot_001.json` | `summary` 的入画率/高度占比/脚滑/贴地口径 | 构图量化指标集 | 升级为镜头库的通用校验口径 |

#### 2.5.4 R3 落地后的实际 schema（2026-11-21 实施；代码即真相）

> 落地文件：`harness/shot_spec.py`（v2 字段与校验）、`harness/asset_manifest.py`（台账合成 + 校验器）、
> `assets/manifest.json`（v2）、`assets/validation/manifest_report.json`（校验报告）、
> `assets/nongeometry/scene_layout.json`（`objects[].source` 改 asset_id）。
> 下面写的是**已落盘、且被校验器判过**的口径，不是草案。

**（1）Shot spec v2**：`schema_version=2` 时 `validate_spec` 额外强制 11 个字段；没有 `schema_version`
的老 spec（`camera_path.json` 派生的 W01 等）仍按老规则校验——补字段不会把历史产物一次性判死，
但历史产物也不会被当成 v2 用。

| 字段 | 落地形态 | 取值口径（实测） |
|---|---|---|
| `kind` | `"shot_spec"` | 固定值 |
| `resolution` | `[w, h]` | `[512, 512]`，与条件图 sidecar 同口径（R0 `condition_pack.json` 实测） |
| `up_axis` | `"Z"` | 与 `scene_layout.json` / `condition_contract.UP_AXIS` 一致 |
| `assets[]` | `[{asset_id, role, instance, transform}]` | 17 条，来自 `scene_layout.objects[]`；`asset_id` 即台账 id |
| `camera.move` | `{type, easing}` | `follow` + `smoothstep`；闭集与 `harness/camera_moves.py` 的 `MOVE_TYPES`/`EASINGS` 对齐 |
| `camera.near` / `camera.far` | 米 | `0.05` / `14.863043`：`scene_layout` 包围盒沿相机前向轴的包络逐帧求 min/max（相机在 `car_a` 包围盒内，near 取 clamp 下限 0.05 m） |
| `camera.f_px` | 像素 | `512.0`；sidecar 的 f_px 是权威内参（契约 §1），`focal_mm`/`sensor_width_mm` 只作参考 |
| `conditions` | `{channels[], depth{near,far,encoding}, mask_semantics, palette_version}` | channels 仍是六通道闭集；`encoding=near_1_far_0`；`palette_version=tree_resources_builder_fixed_v1` |
| `timeline.events[]` | `[{t, type, target}]` | 5 条：FX 代理起止 + 载具转弯 / 刹车 / 停车节点 |
| `validation` | `{report_path, pass, checks[]}` | 回链 `assets/validation/shot_spec_report.json` |
| `license[]` | `[{asset_id, license, source_url, attribution}]` | 逐资产带出，来源是 `assets/manifest.json`（不是手抄） |
| `status` | `draft`/`validated`/`approved` | 校验无问题才写 `validated` |

**（2）Asset manifest v2**：顶层 = v1 字段原样保留（`kind/version/root/cpu_only/count/total_bytes/files[]/elapsed_s`）
+ 新增 `generated_at` / `assets[]` / `asset_count` / `aliases` / `notes`。`files[]` 是 **v1 冻结快照**
（79 条，含 `assets\\manifest.json` 自引用条目，不重算），所以 `count`/`total_bytes` 与之自洽；
`assets[]` 才是 v2 的权威视图。条目共 35 条：几何件 16 + 非几何件 10 + 公共件 9（`kind` 分别为
`geometry`/`nongeometry`/`reference`）。

`assets[]` 每条的字段（对应 §2.5.2 的字段表）：

| 字段 | 内容 |
|---|---|
| `id` | `geometry/<stem>` / `nongeometry/<stem>` / `public/<name>` |
| `path` / `bytes` | 主文件（仓库相对路径）/ 该资产全部文件字节和 |
| `category` / `kind` | 语义类别 / `geometry\|nongeometry\|reference` |
| `license` | `{spdx, source_url, license_url, attribution_required, credit}` |
| `provenance` | `{origin, statement, source_url, is_ai}` |
| `attributes` | 机读属性（生成元信息 / 公共件 stats） |
| `fingerprint` | `{sha256, algorithm, files{path: sha256}, source}`（两层指纹） |
| `version` | `1.0.0` |
| `source` | `{generator, cmd, params, tool_version}` |
| `geometry` | `{verts, faces, watertight, bbox_m, up_axis, units}` |
| `hierarchy` | `{parent_id, children[]}`（`geometry/scene_street` → 5 个成员） |
| `lod` | `{level, faces, ...}`，`level ∈ {hero, mid, low, base}`（当前 32 个 base、3 个 low） |
| `validation` | `{report_path, pass, checks[], validated_at, source_key, metrics}` |
| `tags` | 检索用 |

**（3）四要素判定规则（缺一即红）**：`assets[]` 每条必须同时有 `id` + `fingerprint` + `license` +
`validation`，任一为空 → 该资产 `pass=false`（`ASSET_REQUIRED_FIELDS`）。另判：文件级指纹逐个重算一致、
资产级指纹与文件级一致、`spdx` 是 SPDX 形态、`attribution_required` **等于**由 `spdx` 派生的值
（不手填布尔位）、需署名的件必须有 `credit`、`validation.pass=true` 且 `report_path` 真实存在、
层级引用可解析、`asset_id` 全局唯一。

**（4）引用完整性**：shot spec（`assets[]` 与 `license[]`）与 `scene_layout.objects[].source` 里引用的每个 id
都要解析到台账条目——直接命中 `asset_id`，或经 `aliases[]`（`scene_street` / `character_hero` /
`shot001_hero_sequence` 这类历史短名）命中；解析不到即红。

**（5）跑法与实测读数**：

```bash
python harness/asset_manifest.py --build      # 合成 assets/manifest.json（v2）
python harness/asset_manifest.py --validate   # 写 assets/validation/manifest_report.json，退出码非 0 即红
python harness/asset_manifest.py --check      # 只校验不落盘（CI 用）
```

实测：资产 **35/35 通过**，跨资产检查 **13/13 通过**，`pass=true`；旧 `verify_exports.py` 仍 **24/24**；
`test_shot_spec.py` 仍 **10/10**。

**（6）这一轮没做的**：`scene_layout.instances[]` 未加；自产件的正式 SPDX ID 待用户拍板（当前占位
`LicenseRef-Proprietary`，改一处即可）；LOD 只有 `base` 与 `low`（hero/mid 阶梯属 R4）；
`shots/*/shot_spec.json` 里的历史短名目前靠 `aliases[]` 解析，尚未回写成 canonical id。


### 2.6 与既有 resources3D 调研的关系

> 对方目录：`/Users/moc/workspaces/SiMuseor/resources3D`（独立目录，**本轮只读，未改动**）。

#### 2.6.1 结论：应当合并成「一个共同底座 + 两套上层」，但**不是物理合并仓库**

两套工作的**硬约束一字不差**（C1–C5）、**范式划分相同**（A–F）、**资产类别基本相同**（R3D 13 行口径 vs 本项目 12/14 类），本质是**同一课题的两次不同深度的推进**：

| 维度 | tree-resources-builder（本项目） | resources3D |
|---|---|---|
| 强项 | **真实生产 harness 与产物**：79 件登记、24/24 回读、16/16 校验、120 帧竖切片 + MP4、载具分件/减面、载具动力学、SOMA 姿态存储与跨解释器重建、USD 汇合层 | **方法论纪律与评估**：溯源日志（`logs/` 读数优先于报告正文）、**条件图评估协议**（`eval/metrics_spec.md`，mask/depth/lineart/shade 五类 CPU 指标）、**lineart/shade 渲染参考实现**（`wmcore.py`）、**资产清单字段模板**（`gallery/manifest.json`，30 件六范式样例）、sha256 指纹、视锥检查、sidecar 约定 |

#### 2.6.2 可以互相引用的结论

1. **R3D 的 `eval/metrics_spec.md` 应直接作为本项目条件图的评估口径来源**——它已经定义了「随图三样东西」与五类 CPU 指标，本项目不必重写评估协议，只需把 `metrics.py` 的口径搬进 `validate.py`。
2. **R3D 的 `wmcore.py` 是 lineart / shade 的参考实现**——`line_art_from_face_id`（基于 face_id 取轮廓）与 `rasterize` 返回的 `shade`（朗伯）正是本项目缺的两件。
3. **R3D 的 `gallery/manifest.json` 是 asset manifest 的字段模板**——它已经过 30 件样例验证，本项目 §2.5.2 的字段表就是它的子集 + 本项目特有的 `category`/`kind`/`up_axis`。
4. **R3D 的 13 行覆盖矩阵与本项目的 12/14 类覆盖矩阵可直接对齐**，不必各自维护。
5. **R3D 的 `check_framing` / `points_in_frustum` / `sha256_of` 是本项目镜头校验与资产指纹的现成参考**。

#### 2.6.3 合并前必须先裁定的三件事（否则一定静默出错）

| # | 冲突 | 本项目 | resources3D | 建议裁定 |
|---|---|---|---|---|
| 1 | **深度极性** | `0=最近，1=最远`（`conditions.py` 注释与 `DEPTH_ENCODING`） | `近=1 / 远=0`（`wmcore.depth_to_unit`） | **统一为「近=1 / 远=0」**（与 R3D 的评估协议、`eval/out/t0_metrics.csv` 的 IoU 口径一致），并在 sidecar 里显式写 `encoding` |
| 2 | **上轴** | Z-up（stage `SetStageUpAxis(z)`、layout `up_axis: "Z"`） | Y-up（`Camera.up=(0,1,0)`） | **保持各自的上轴**（改动成本高），但**所有跨边界文件必须带 `up_axis` 字段**，读取端遇到不一致即判红 |
| 3 | **像素行方向 / 投影约定** | `conditions.py` 自有 `_cam_to_pixel` 口径 | `wmcore` 口径（行 0 在上、`row = H − (cy + f_px·y_c/z)`） | 需做一次**同相机同场景交叉渲染比对**（深度图逐像素对齐率），以实测定案，不能凭读文档判断 |

#### 2.6.4 建议的协作形态（不物理合并）

- **共享一份契约文档**：放在本项目 `plans/` 下（建议名 `CONTRACT-conditions.md`），定义六通道契约、随图 sidecar 三要素、深度极性、上轴声明、跨边界字段清单。R3D 侧只需引用它，不改代码。
- **R3D 的 `wmcore.py` 作为「参考实现」而非依赖**：移植 lineart/shade 两段到本项目 `conditions.py`，或以「等价实现 + 交叉验证」方式引用；**不把 R3D 目录变成本项目的运行时依赖**（两个目录分属不同工作流）。
- **指标层单点定义**：五类条件图指标只在 R3D 的 `eval/metrics_spec.md` 定义一次，本项目在 `validation_report.json` 里按该口径产出，不另立一套。

---

## 3. B 部分 · 社区怎么做的（摘要）

> 完整调研正文（含逐条来源链接与来源清单）见 **`research/community_pipeline_practices.md`**。本节只给路线决策需要的摘要。

### 3.1 四方向要点摘要

| 方向 | 社区主流做法（要点） | 对本项目的意义 |
|---|---|---|
| **3D 资产生产** | 程序化/参数化底座（Geometry Nodes / Houdini / OpenSCAD / OpenVSP / MakeHuman）＋扫描/AI 辅助**定位为「素材」而非「程序」**；资产分级（Hero/Mid/Low）、trim sheet、实例化；命名目录规范；变体管理靠参数化底座或几何节点 | 本项目**已经在主干上**（JSON 配方 + 解释器 ≈ 参数化底座）。**唯一实打实的缺口是「资产分级」与「变体管理」**——本项目所有资产都是「一件」，没有 LOD 分档、没有同拓扑变体 |
| **3D 资产管理** | 目录站点（Poly Haven / ambientCG / Sketchfab / Quaternius / Fab / KitBash3D / Omniverse）+ 元数据四层结构（描述 / tags / 机读 attributes / 指纹与统计，Poly Haven 与 ambientCG 两套同骨架）；许可值域用 **SPDX ID** + **REUSE**（`LICENSES/` 文件名即 SPDX 标识）；**双层指纹**（资产级 hash + 文件级 md5）；Sketchfab 把「人做 / AI 生成」做成 `is_ai=0/1` 显式过滤维度；USD `assetInfo` + `ArResolver` 定位；生产管理里 asset 与 shot 是**并列实体**（Kitsu：`ASSET --cast in--> SHOT`） | 本项目 `manifest.json` 缺**许可 + 指纹 + 层级 + LOD + 验证状态 + 来源证明**六项；`public_assets.json` 已有 sha256 与许可，**合并进 manifest 即可**（§2.5.2） |
| **导演台** | 镜头列表 + 缩略图墙 + 时间轴 + 版本比对 + 批注 + 状态字段，是**所有**工具的公共骨架（Boords / Kitsu / ShotGrid / Blender Storyboard / Storyboarder）；Shot list 常见字段（镜号、描述、主体、场景、时间、机位、时长）；**「人管镜头、机器管资产」**在 Kitsu/ShotGrid 里体现为 *人维护 shot 实体与任务状态，资产只被 shot 引用* | 本项目当前**完全没有界面层**。建议做一个**只读本地**的最小导演台（§4 R5），只做「镜头列表 + 缩略图墙 + 状态」，**不做协作与数据库** |
| **镜头库 / 摄影机库** | 焦距集合（16/24/35/50/85/135 mm 等，**但没有官方标准，各家自选**）+ 传感器尺寸换算；**Lens 与 Filmback 分两张预设表**（Blender 相机 Presets、Unreal Lens Settings / Filmback）；机位轨道用 DCC 原生**约束**表达（Blender Track To：朝向目标 + up 轴 roll）；HDRI/环境光库独立管理（Poly Haven CC0、16k+、unclipped）；色彩管理（ACES / ACEScct / OCIO / Blender AgX）必须在条件图阶段就固定；下游接法分**两条**：**(a) 2D 条件路线**（ControlNet 9 类条件 + SVD/Wan/CogVideoX 的首帧条件）与 **(b) 3D 条件路线**（CameraCtrl / CamI2V / TrajectoryCrafter / SV3D_p 直接吃相机位姿） | 焦距集合与传感器尺寸**我们已有**（`sensor_width_mm` + `focal_mm`）；**缺** `lens_preset` / `filmback_preset` 两个预设枚举、「条件图按数据而非颜色存储」的口径、以及恒速推轨的**线性插值**规则；**最关键**的是下游接法已明确 → 条件图六通道契约（§2.2）+ 镜头包要同时出「条件序列」与「相机参数」 |

### 3.2 借鉴清单（落到五层）

> 五层 = 几何层 / 编排层 / 镜头层 / 验证层 / 界面层。

**可直接照抄**

| # | 做法 | 落在哪层 | 在我们体系里具体是什么 |
|---|---|---|---|
| 1 | 资产清单字段设计（id / 分类 / 许可 / 指纹 / 版本 / 生成命令与参数 / 工具版本 / 几何统计 / 验证状态） | 编排层 | §2.5.2 的 asset manifest 字段表（照抄 resources3D gallery manifest） |
| 2 | 逐件许可字段 + 署名文本进交付物 | 编排层 + 验证层 | `public_assets.json` 的许可字段合入 manifest；shot 的 `license[]` 字段带出 |
| 3 | 条件图六通道 + 随图 sidecar 三要素（画幅+焦距 / near-far / 通道语义） | 编排层 + 镜头层 | §2.2.1 / §2.2.3 |
| 4 | 镜头 shot list 的字段集（镜号 / 描述 / 主体 / 场景 / 时长 / 机位 / 状态） | 镜头层 | shot spec 的 `description` / `status` 字段 |
| 5 | 内容指纹（sha256）做资产身份 | 编排层 + 验证层 | `manifest[].fingerprint`，缺即判红 |
| 6 | 镜头库的焦距预设集合 + 传感器尺寸换算口径 | 镜头层 | `camera.lens_preset` 字段 + `f_px` 换算进 sidecar |

**需要改造后使用**

| # | 做法 | 落在哪层 | 改造点 |
|---|---|---|---|
| 1 | 资产分级（Hero / Mid / Low） | 几何层 | 社区分级按「镜头距离」划；我们改成**按用途**（hero=近景主线、mid=中景、low=远景占位），并绑定面数预算 |
| 2 | 命名与目录规范 `<category>_<name>_<variant>` | 编排层 | 与 `conditions.resolve_category` 语义表对齐，避免两套类别词表 |
| 3 | 变体管理（参数化底座 / 几何节点变体） | 几何层 | 我们没有几何节点，改为**JSON 配方 schema**（载具四车身同拓扑是第一个样例） |
| 4 | USD 资产库 / Asset Resolver | 编排层 | **不做**完整 Asset Resolver，只借它的 `assetInfo` 元数据字段做 manifest 标注 |
| 5 | 导演台界面 | 界面层 | 只做**只读本地**看板：镜头列表 + 缩略图墙 + 状态；不做协作、不做服务端 |
| 6 | 色彩管理（ACES / AgX） | 验证层 | 条件图阶段不做影视色彩变换，但**必须固定「深度/线稿/法线与显示色彩无关」的约定**，避免有人把色彩管理套到条件图上 |

**明确不做**

| # | 做法 | 理由 |
|---|---|---|
| 1 | AI 生成件 / 扩散或 SDS 重建 | 直接违反 C1 |
| 2 | 扫描高模直接进管线 | CPU + 体量；且实测高模件无法可靠分件（ToyCar 的「玻璃学不出车门」） |
| 3 | 多人协作 / 权限 / 审片流 | 本项目无团队、无服务端 |
| 4 | 数据库型资产管理（ShotGrid/Ftrack 级） | 过重；JSON + 内容寻址足够 |
| 5 | 完整 VFX 平台时间线（OTIO 全量采用） | OTIO 是**剪辑时间线**模型，我们是**镜头生成时间线**，语义不同；可借字段命名，不整体采用（见 §7 决策点） |
| 6 | 摄影机物理仿真（卷帘快门 / 镜头畸变 / 呼吸效应） | 白模定位不需要；CPU 成本与收益不匹配 |

---

## 4. 阶段划分

> 阶段编号 R0–R7 是**建议**，不是承诺；每个阶段都写了「明确不做」。依赖关系：R0 → R1/R3 → R2 → R4/R5 → R6/R7。

### R0 · 契约统一（最高优先级，阻塞其余全部）

| 项 | 内容 |
|---|---|
| **目标** | 把「下游到底要什么」写成可校验的契约，并裁定与 resources3D 的两个冲突 |
| **范围** | ① 六通道契约定义（depth/normal/seg/mask/lineart/pose）；② 深度极性裁定与改码；③ 随图 sidecar 三要素；④ `up_axis` 显式化；⑤ 跨边界字段清单 |
| **交付物** | `plans/CONTRACT-conditions.md`（新增）；`harness/conditions.py` 增 mask 通道 + `depth` 编码常量显式化；`harness/shot_spec.py` 的 `SUPPORTED_CONDITIONS` 扩到 6；sidecar 写出器 |
| **验收方式** | ① 同一场景导出六通道 PNG + sidecar；② 静态扫描 sidecar 必含 `resolution/f_px/near/far/encoding/up_axis/mask_semantics`；③ 与 resources3D 同相机同场景**交叉渲染比对**（深度极性对齐后逐像素一致率 ≥ 99%），比对脚本落盘读数 |
| **依赖** | 无 |
| **明确不做** | 不改 PLAN.md / paradigms.md 等既有文件；不引入 Blender 渲染；不下载模型权重；不做下游 A/B 验证（用户已明确暂不执行） |

### R1 · 条件图六通道落地（含 pose 关键点）

| 项 | 内容 |
|---|---|
| **目标** | 把下游最通用的条件通道补齐，让竖切片直接产出可消费的条件序列 |
| **范围** | ① mask（前景显式 PNG，零额外光栅成本）；② lineart（从 face_id 取轮廓，参考 R3D `wmcore.line_art_from_face_id`）；③ pose（SOMA 77 关节 → COCO-18 / OpenPose-25 关键点 JSON + PNG）；④ 每个 shot 目录出 `conditions/` 子目录；⑤ 条件图指标（按 R3D `metrics_spec` 口径）接入 `validation_report.json` |
| **交付物** | `harness/conditions.py` 增 3 通道；`harness/pose_keypoints.py`（新增）；`assets/validation/conditions_check.json` 扩展（通道齐备率、单通道耗时分解）；`shots/shot_001/conditions/`（120 帧 × 6 通道的抽样集，非全量） |
| **验收方式** | ① 六通道齐备率 100%；② 隐藏几何回归测试仍成立（隐藏车 → 前景像素下降，参考 `conditions_check.json` 的既有 hidden_test 口径）；③ 单通道渲染耗时与总耗时可对账（现测 512×512 合计 83.24 ms，加 3 通道后仍 < 1500 ms 预算）；④ 关键点图与 `pose_store.py` 的关节序列数值一致（抽样 10 帧逐帧比对） |
| **依赖** | R0 |
| **明确不做** | 不做 shade 通道（无标准下游接口，优先级最低）；不下载任何预训练检测器（HED/Midas/OpenPose 权重）——**我们输出的是「喂给下游的图」，不需要在本机跑下游的检测器** |

### R2 · 运镜体系化（镜头类型库 + 镜头包）

| 项 | 内容 |
|---|---|
| **目标** | 从「一次推镜」变成「9 类镜头 × 可校验 × 可批量」 |
| **范围** | ① 镜头类型库（推/拉/摇/俯仰/移/跟/环绕/升降/手持）参数化；② 镜头包目录结构与写出器；③ 构图/运动校验量（覆盖率、居中偏移、离屏比例、速度曲线、焦距变化率、抖动频带、视锥内主体比例）；④ 相机时序逐帧写入 USD；⑤ glTF camera 导出；⑥ 逐帧内外参 JSON 作为唯一权威源 |
| **交付物** | `harness/camera_moves.py`（新增，9 类镜头生成器）；`harness/shot_package.py`（新增，镜头包写出）；`assets/validation/shot_library.json`（镜头库台账）；`assets/validation/camera_intrinsics.json`；`shots/<shot_id>/` 下 9 个样例镜头包 |
| **验收方式** | ① 9 类镜头各 1 个样例，每类通过 ≥ 5 项校验；② 每个镜头包目录含全部 5 类产物（spec / camera × 3 / conditions / validation / 预览）；③ 同一镜头的 USD 相机时序与 intrinsics.json 逐帧位姿一致（抽样 10 帧，重投影误差 ≤ 1e-4）；④ 手持镜头噪声频谱落在 0.5–3 Hz 带内（实测 FFT 主频） |
| **依赖** | R1（条件图通道齐备才能出条件序列） |
| **明确不做** | 不做手持以外的物理相机模型；不做卷帘快门/畸变；不做「镜头语言」自动评分（需人工判读，超出 CPU 自动校验能力） |

### R3 · 镜头库与资产库 schema 落地（已实施：2026-11-21，实际口径见 §2.5.4）

| 项 | 内容 |
|---|---|
| **目标** | 把「资产」和「镜头」变成可引用、可版本化、可追溯的一等实体 |
| **范围** | ① shot spec 补齐 §2.5.1 的 11 个缺失字段；② asset manifest v2（保留 `files[]` 兼容 `verify_exports.py`）；③ 指纹（sha256）、许可、层级、LOD、验证状态入 manifest；④ `scene_layout.json` 的 `objects[].source` 改引用 `asset_id`；⑤ 新增 `validate_manifest` 校验器 |
| **交付物** | `harness/asset_manifest.py`（新增）；`assets/manifest.json` v2；`assets/validation/manifest_report.json`；schema 文档段（并入本文 §2.5） |
| **验收方式** | ① 每个资产条目有 `id` + `fingerprint` + `license` + `validation` 四项，缺一即红；② 每个 shot 引用的 `asset_id` 在 manifest 中存在（引用完整性检查）；③ `manifest_report.json` 全绿；④ 旧 `verify_exports.py` 仍能跑通（向后兼容回归） |
| **依赖** | R0 |
| **明确不做** | 不引入数据库；不引入 USD Asset Resolver 运行时；不做资产浏览器的图形界面（界面在 R5） |

### R4 · 五类资产补全（道具优先）

| 项 | 内容 |
|---|---|
| **目标** | 补上「道具只有 1 件」这个最大空洞，并把另外四类从「一件」扩到「一族」 |
| **范围** | ① 道具 20 件 CC0 零件库 + 命名/许可台账 + LOD 规则；② 植被 6 树种配方 + 三档 LOD + 实例化表；③ 载具 4 种同拓扑车身 + 语义零件库 + 4 类动力学预设；④ 场景 3 种街区 + 分块 LOD + 公共件混排；⑤ 人物 10 个身份变体 + 部件级拆分 + 贴合服装壳 |
| **交付物** | `assets/geometry/props/**`、`assets/geometry/vegetation/**`、`assets/geometry/vehicle_car_*.glb`、`assets/geometry/scene_*.glb`、`assets/geometry/soma_variants/**`；`assets/validation/prop_library.json`、`vegetation_lod.json`、`scene_mix.json` |
| **验收方式** | ① 每类都有对应的 `validation_report` 条目且全绿；② 面数预算达标（道具 low ≤ 500 / mid ≤ 5k / hero ≤ 50k 面）；③ 台账逐件可查许可与 sha256；④ 场景混排后人/车/植被无穿插、贴地为 0；⑤ 同拓扑校验：四种车身顶点拓扑哈希一致 |
| **依赖** | R3（要先有 asset_id 与台账，否则新增资产无处挂） |
| **明确不做** | 不做扫描高模直入；不做 AI 生成件；不做面部表情；不做飞机/轮船参数化底座（OpenVSP/Freeship 未实跑，列入二次评估） |

### R5 · 最小导演台（只读本地）

| 项 | 内容 |
|---|---|
| **目标** | 给人一个「选镜头、选资产、看校验」的最小界面 |
| **范围** | ① 镜头列表（镜号/描述/主体/场景/时长/机位/状态）；② 缩略图墙（读镜头包的 contact sheet）；③ 时间轴（读 intrinsics.json）；④ 状态字段（draft/validated/approved）；⑤ 批注位（本地 JSON，无账号） |
| **交付物** | `harness/board.py`（新增）；`boards/shot_board.html`（新增，单文件离线） |
| **验收方式** | ① 离线 `file://` 打开，0 外链、0 控制台错误（沿用 `verify_report.py` 口径）；② 能从镜头列表跳到镜头包；③ 状态字段可编辑并回写 shot spec |
| **依赖** | R2、R3 |
| **明确不做** | 不做多人协作、不做服务端、不做审片流、不做缩略图生成（用现成 contact sheet） |

### R6 · 与 resources3D 的契约对齐

| 项 | 内容 |
|---|---|
| **目标** | 两套工作接到同一份契约上，并完成交叉验证 |
| **范围** | ① 深度极性/上轴/像素方向的最终裁定落码；② R3D `wmcore` 的 lineart/shade 与本项目实现的等价性比对；③ R3D `metrics_spec` 的五类 CPU 指标接入本项目 `validation_report`；④ 13 行覆盖矩阵与本项目类别矩阵对齐 |
| **交付物** | 契约对齐记录（并入本文 §2.6.3 的表格更新）；`assets/validation/condition_metrics.json` |
| **验收方式** | ① 同相机同场景在两套实现下渲染的深度图逐像素一致率 ≥ 99%；② 五类指标可在本项目产物上算出并落盘；③ 覆盖矩阵对齐表无空行 |
| **依赖** | R0、R1、R3 |
| **明确不做** | **不改 resources3D 目录任何文件**；不物理合并两个仓库；不引入 Blender 作为渲染运行时（可选，见 §7 决策点 5） |

### R7 · 云端 LLM 接入（把「验证闭环」真实化）

| 项 | 内容 |
|---|---|
| **目标** | 完成 PLAN.md §6 的 V5：统计首次执行成功率与 3 轮收敛率 |
| **范围** | ① 云端 LLM API 出 JSON 配方 → 本地确定性执行 → `validate.py` 判定 → 结构化 hint → 修复；② 批量任务的统计 |
| **交付物** | LLM 配方→执行的记录文件；成功率与收敛率统计（并入 `assets/validation/`） |
| **验收方式** | ① N 个资产的「首过率」「3 轮内收敛率」有落盘统计（每档样本 ≥ 20）；② 失败案例保留完整 hint 链 |
| **依赖** | R0、R3 |
| **明确不做** | 不本地推理；不使用任何 3D 生成式模型；不把「模型认为对了」当作通过（仍以 `validate.py` 判定为准） |

---

## 5. 明确不做 / 建议不做

### 5.1 本轮不做（本任务边界）

| 项 | 理由 |
|---|---|
| 任何实现代码 | 本轮交付物是调研与规划文档 + 看板 HTML |
| 下载模型权重 / 大规模外网下载 | 纪律要求；调研只需引用公开资料 |
| 改 `PLAN.md` / `paradigms.md` / `community_assets.md` 等既有文件 | 修正建议单独成节（§8），由用户裁定后再改 |
| 改 `resources3D/` 目录 | 对方是独立工作流，本轮只读 |
| 提交 / 推送 / 建 PR | 纪律要求 |
| 下游图/视频模型的 A/B 验证 | 用户已明确「下游 A/B 暂不执行，只做 CPU 侧评估指标」 |

### 5.2 路线上建议不做（并给出理由）

| # | 建议不做 | 理由 | 替代方案 |
|---|---|---|---|
| 1 | 追求照片级有机细节（毛发/皮肤/树冠写实/布料褶皱） | 纯 CPU + 无生成式模型 ⇒ 硬天花板（PLAN.md §4 风险表已记录） | 代理表达 + 结构正确 + 运动正确 |
| 2 | 去找「成熟开源参数化汽车底座」 | 诚实边界：不存在（paradigms.md 候选表 C9 已判定） | 自建够用的 JSON 配方 schema（同拓扑四车身） |
| 3 | 采集扫描件做近景主资产 | CPU 减面与修复成本高；实测高模件无法可靠分件 | CC0 低模库（Kenney 为主）作占位，Poly Haven 高模作少量 hero |
| 4 | 做完整的资产库服务 / 数据库 | 过重；本项目产出量级不需要 | JSON + 内容寻址 + 离线看板 |
| 5 | 采用 OTIO 全量作为时间线模型 | OTIO 面向**剪辑时间线**（track/clip/source range），我们是**镜头生成时间线**（相机轨迹 + 条件序列），语义不同 | 借字段命名与「外部引用」概念，自建 shot spec（§7 决策点 1） |
| 6 | 在本机跑下游的预训练检测器（HED/Midas/OpenPose） | 我们输出的是「喂给下游的图」，不需要在本机跑下游；且违反「不下载模型权重」纪律 | 关键点图由我们自己的 SOMA 关节导出，线稿由 face_id 取轮廓 |
| 7 | 用 Blender 做条件图渲染运行时 | bpy 5.0.0 在本机**实测可用**（resources3D `venvs/df`，Python 3.11.16），但引入后：启动开销大、渲染结果与 numpy 光栅不同源、跨解释器一致性成本高 | 继续用 numpy z-buffer；把 Blender 留作**下游验证工具**（V3：在 Blender/UE 里导入 BVH 与 USDA 验消费） |
| 8 | 把语义 seg 做成 100+ 类的 Segment Anything 体系 | 我们只有 12 类资产，扩展成本高收益低；且下游 seg 通道对白模的价值主要在「可开关」而非「精细分类」 | 保持 12–16 类的固定调色板（`build_palette` 的「颜色两两不同」约束要保留） |

---

## 6. 风险与诚实边界

### 6.1 风险表

| 风险 | 影响 | 触发条件 | 应对 | 归属阶段 |
|---|---|---|---|---|
| **深度极性/上轴混用** | 下游条件图静默反相或翻转——**不报错、结果全错** | 两套工作产物混用 | 契约显式化 + 跨渲染比对 + 读取端不一致即判红 | R0 / R6 |
| **条件图通道堆得越多、下游可用越少** | 做了六通道但下游只吃两张，投入浪费 | 未与下游接口对齐就扩通道 | 先定契约再扩通道；通道清单必须对应到具体下游条件类型 | R0 / R1 |
| **镜头库变成「好看的关键帧集合」** | 无自动校验量的镜头不可维护、不可复用 | 镜头类型只写名字不写可校验量 | 每类镜头必须带 ≥ 2 个可自动判定的构图/运动量 | R2 |
| **资产库扩张快于验证能力** | 新增资产进不了管线，白做 | R4 一次补 20+ 件 | 每类资产先跑通 1 件的完整链路（生成→台账→校验）再扩量 | R4 |
| **公共件许可与再分发风险** | 交付物不可商用 | CC-BY 署名遗漏、CC-BY-ND 被误用 | 台账逐件记许可 + 署名文本；`validate_manifest` 缺许可即红 | R3 / R4 |
| **LLM 配方一次通过率低** | 返工 | C3 允许但 C5 要求真实产物 | 验证前置 + 白名单配方 + 结构化 hint（PLAN.md 已定 D1/D3） | R7 |
| **CPU 耗时随镜头数线性增长** | 批量出镜头包不可行 | 每镜 120 帧 × 6 通道 | 现测 512×512 六通道 ≈ 100 ms/帧量级（推算，未实测）；按分辨率与通道数分档，先小样验证 | R1 / R2 |
| **界面层做过头** | 变成另一个产品 | R5 越界到协作/服务端 | 明确「只读本地」；不做协作 | R5 |

### 6.2 诚实边界（本文明确不声称的事）

1. **本文没有实跑任何新代码**。§1 的全部数字都来自仓库内**已落盘**的 JSON 读数；§4 的阶段、§2.3 的配方、§2.5 的 schema 都是**建议**，不是已完成的工作。
2. **六通道的耗时是推算不是实测**：现测只有 depth/normal/seg 三通道（512×512 合计 83.24 ms）；加 mask/lineart/pose 后的总耗时**未实测**，R1 的验收里必须先测再定预算。
3. **「镜头库被下游用起来」没有证据**：下游 A/B 验证按用户要求**暂不执行**，因此本文只能保证「产物格式正确、可被解析」，**不能保证「下游模型听话」**。这一点沿用 resources3D `metrics_spec.md` 的原话：指标只证明「条件图里的结构信息被下游保留了多少」，不能替代「下游模型愿意听条件图」这一层验证。
4. **视线/手动的语义边界**：本文说的「手持」是**可控频带的机械噪声**，不是真人手持的物理仿真；「推/摇/移」是机位运动，不是光学变焦（焦距变化由 `focal_mm` 单独表达）。
5. **社区调研的边界**：B 部分结论均为公开资料层面（官方文档 / 官方仓库 / 论文），**未做行业访谈**；个别做法与主流做法的判断是**基于公开证据的评估**，不是从业者统计。被打拦的站点已在姊妹文档中标「未验」。
6. **「没有成熟开源参数化汽车底座」这个判断未变**：本文没有找到反例；§2.3.4 的自建 schema 是绕道方案，不是替代品。

---

## 7. 需用户拍板的决策点

> 这 5 个问题会**实质改变**后续做什么；建议在进入 R0 之前先定。

### 决策点 1 · 镜头库的数据模型：自造 vs 采用现成

| 选项 | 说明 | 影响 |
|---|---|---|
| **A. 自建 shot spec（本文建议）** | 沿用 `shot_spec.py` 的 schema 扩字段，借鉴 OTIO 的「外部引用」概念但不整体采用 | R2/R3 完全在掌控内；下游若要接 OTIO 需另写适配器 |
| B. 采用 OpenTimelineIO 作为时间线层 | OTIO 是 Apache-2.0 的开放剪辑时间线标准，生态成熟 | 格式通用；但语义错位（剪辑 clip vs 镜头包），且引入一个 Python 依赖与一套「source range」心智负担 |

**建议 A**，理由见 §5.2 第 5 条。

> **补充（本轮调研新增，重要）**：社区里「按身份而非按路径引用资产」这件事**已经有现成标准**，即 **OpenAssetIO**（Apache-2.0，`github.com/OpenAssetIO/OpenAssetIO`）——它用「实体引用（Entity Reference）」代替文件路径、属性按需解析；官方已有 USD AR2 解析器插件（`usdOpenAssetIOResolver`）、OTIO 插件（`otio-openassetio`）、ShotGrid manager 插件（`fpt_openassetio_manager`），还有一个刻意简化的参照 manager（`OpenAssetIO-Manager-BAL`）。
>
> 于是决策点 1 实际是**三选一**：
> - **A1（建议）**：自建 shot spec + **只借 OpenAssetIO 的数据模型**（`asset_id` + `version` + `fingerprint` +「有 id 按 id 解析、无 id 按路径兜底」的两级查找），**不引入任何外部运行时依赖**；
> - A2：完整引入 OpenAssetIO 运行时（Apache-2.0，但会把管线绑到外部库版本上）；
> - B：采用 OpenTimelineIO 作为时间线层。
>
> **建议 A1**：拿到 OpenAssetIO 的语义与引用语法，却不背它的依赖。详见 `research/community_pipeline_practices.md` §2.6。

### 决策点 2 · 条件图通道清单与深度极性

| 选项 | 说明 | 影响 |
|---|---|---|
| **A. 六通道（depth/normal/seg/mask/lineart/pose），深度改「近=1 远=0」（本文建议）** | 与 resources3D 评估协议、R3D `wmcore` 一致；六通道各有明确下游对应 | 需要改 `conditions.py` 的深度编码（**影响已有条件图产物**）；R6 交叉比对有统一基准 |
| B. 保持「近=0 远=1」，六通道照做 | 不动既有产物 | 与 R3D 的评估指标口径反向，交叉验证时必须显式转换；深度图发给下游时需确认下游约定（**ControlNet depth 通常近处更亮**） |

**建议 A**，但需确认：**已产出的条件图是否需要重新生成**（当前仓库里 `assets/validation/conditions_check.json` 记录的是现有口径的读数）。

### 决策点 3 · 道具零件库的来源策略

| 选项 | 说明 | 影响 |
|---|---|---|
| **A. Kenney 为主 + 少量 Poly Haven hero（本文建议）** | Kenney CC0、面数 <1,000、风格统一、可脚本化下载 | 视觉风格统一（偏低模）；近景写实度弱 |
| B. 以 Poly Haven 为主 | 写实度好、近景强 | 每件 5k–100k 面、需强减面、下载量大（已下载的 `island_tree_01` 单件 66 MB） |
| C. 纯程序化生成 | 不下载任何外部件 | 品类受限、风格单一；但许可最干净 |

**建议 A**，并把 C 作为「特定缺口类目」的兜底。

### 决策点 4 · 资产补全的优先级：先道具还是先镜头库

| 选项 | 说明 | 影响 |
|---|---|---|
| **A. 镜头库优先（R2 先于 R4，本文建议）** | 镜头/相机对下游控制力最强且阻塞下游接入 | 资产侧缺口（道具）短期仍明显 |
| B. 资产优先（R4 先于 R2） | 资产是「内容」，镜头是「拍法」；内容先到位 | 镜头库拖后，下游接入晚 |

**建议 A**，理由见 §2.1.3。

### 决策点 5 · 是否把 Blender 引入为可选的下游验证工具

| 选项 | 说明 | 影响 |
|---|---|---|
| **A. 继续只用 numpy z-buffer，Blender 仅用于人工验证（本文建议）** | 保持 CPU 轻量、结果同源 | 放弃了 Blender 渲染的现成能力（如光线追踪与材质预览） |
| B. 引入 `resources3D/venvs/df` 那套 bpy 5.0.0（Python 3.11.16，本机**实测可用**） | 可做 PLAN.md §6 的 V3：在 Blender 里导入 BVH 与 USDA 验下游消费 | 引入跨解释器一致性成本；启动开销大；与 C2「本地全 CPU」不冲突但增加依赖面 |

**建议 A**，把 B 作为 R6 的一个**可选**验证分支（用现成 venv，不新增依赖安装）。

---

## 8. 对既有结论的修正建议

> **本节只提建议，不改任何既有文件。** 位置写明、建议改法写明、依据写明。请用户裁定后再改 PLAN.md / paradigms.md / community_assets.md 等。

### M1 · `plans/PLAN.md` §0「本机资源基线」——代理端口已过时

- **位置**：`plans/PLAN.md` §0 「本机资源基线（实测，2026-11-19）」中的「网络：本机代理 `127.0.0.1:7890`」。
- **实测**：2026-11-21 本轮，`curl -x http://127.0.0.1:7890` 连接失败（exit 7，Couldn't connect）；`lsof -nP -iTCP -sTCP:LISTEN` 显示本机代理实际监听在 **7897**（进程 `verge-mih`）。用 7897 访问公开站点正常返回 200。
- **建议改法**：改为「本机代理 `127.0.0.1:7897`（Clash Verge / verge-mih 监听；2026-11-21 实测）」，并把「实测」日期更新。**注**：PLAN.md 记录的 7890 在 2026-11-19 当天可能是对的，端口会随代理软件重启而变——建议改成「端口以 `lsof` 实测为准，常见 7890/7897」。

### M2 · `plans/PLAN.md` §0「未安装 Blender / OpenSCAD / FreeCAD」——表述过强

- **位置**：`plans/PLAN.md` §0 「未安装 Blender / OpenSCAD / FreeCAD（bpy 仅支持 Python 3.11，本机 3.13 不可装）」。
- **实测**：兄弟目录 `resources3D/venvs/df/bin/python`（**Python 3.11.16**）里 **`bpy 5.0.0` 可用**；`resources3D/gallery/manifest.json` 记录的渲染器正是 `"bpy 5.0.0 (Blender as a Python module)"`、`"render_device": "CPU"`。同目录下 `venvs/blender-portable/` 与 `venvs/openscad-portable/` 的 `bin` 目录**为空**，即只有 `df` 这一套实测可用。
- **建议改法**：改为「**主 `.venv`（Python 3.13）装不上 bpy；bpy 需装在独立的 Python 3.11 venv 中**（本机已有可用实例：`resources3D/venvs/df`，bpy 5.0.0，CPU）」。这与 `research/paradigms.md` §A1 已经写明的正确口径一致——**PLAN.md §0 的表述把「主 venv 装不上」说成了「本机未安装」，属过度概括**。这一改会影响「要不要用 Blender」的决策基础（见本文 §7 决策点 5）。

### M3 · `plans/PLAN.md` §6 第 1 条（V2b）——状态与实际读数不符

- **位置**：`plans/PLAN.md` §6「未完成 / 下一步」第 1 条：「**V2b**：把外部 `motion_walk_2s.bvh` 重定向到 SOMA 77 关节（当前竖切片是 SOMA 原生姿态空间生成），复检脚滑/关节限位。」
- **实测**：`assets/validation/retarget_bvh.json` 已存在并有读数：**48 帧 / 2.0 s / 脚滑均值 0.0135 m、最大 0.0663 m / 贴地 0.0 / method = `semantic_replay`**，且文件内自带与原生步态的对比（`shot_001: 0.47 cm mean / 3.03 cm max`）；`assets/nongeometry/shot003_retarget_pose.npz` 已落盘。
- **建议改法**：把 V2b 从「未完成」改为「**部分完成**：已有语义重放（`semantic_replay`）版读数，脚滑均值 1.35 cm / 最大 6.63 cm，**约为原生步态（0.47 / 3.03 cm）的 2.9 倍 / 2.2 倍**，未达竖切片水平；严格骨架重定向（BVH→SOMA 77 关节的求解式重定向）仍未做」。
- **意义**：不写清楚容易被误读成「BVH 重定向还没跑过」，从而重复劳动或高估/低估风险。

### M4 · `plans/PLAN.md` §6 第 6 条——「公共资产尚未接入」中的「需减面」部分已完成

- **位置**：`plans/PLAN.md` §6 第 6 条：「下载资产尚未接入正式场景：`island_tree_01` 约 160 万面需减面，ToyCar 约 10.9 万面；需建立「公共资产层」与程序化资产混排。」
- **实测**：`assets/validation/public_decimated.json`（生成于 2026-11-21T13:54:11Z）已记录减面完成：`island_tree_01` 1,599,403 → **74,097** 面；`ToyCar` 108,936 → **29,998** 面；`ambulance` 2,804 → **1,497** 面；工具为 `fast_simplification 0.2.0` + `trimesh 5.2.1`；减面结果已落盘到 `assets/public_normalized/{ToyCar,island_tree_01,ambulance}.glb`。
- **建议改法**：改为「**减面已完成**（island_tree_01 → 74,097 面；ToyCar → 29,998 面；ambulance → 1,497 面，产物在 `assets/public_normalized/`）；**未完成的**是『接入正式场景』与『公共资产层』的台账化」。另注：`island_tree_01` 实测 74,097 面**超过**当时的 60,000 目标（每部件保底 12 面的策略导致），若按目标值验收会误判。

### M5 · `plans/PLAN.md` §5 执行记录——条件图通道数需要补记

- **位置**：`plans/PLAN.md` §3 验收对照与 §5 执行记录里描述条件图的部分。
- **实测**：`harness/conditions.py` 与 `harness/shot_spec.py:SUPPORTED_CONDITIONS` 都只列 **3 个通道（depth/normal/seg）**；`save_condition_pngs` 的 docstring 也写明「把三个通道写成 PNG」。
- **建议改法**：明确写「当前条件图为 **3 通道**（depth/normal/seg），**尚未**包含下游最常用的线稿系与人体姿态；六通道契约见 `plans/ROADMAP-IMAGE-VIDEO.md` §2.2」。避免下游误以为「条件图四件套已就位」。

### M6 · `research/community_assets.md` §4——ToyCar 与 Poly Pizza 跑车两行的「用途」描述可以更准

- **位置**：`research/community_assets.md` §4 表格末两行附近。
- **实测**：`public_decimated.json` 的 `parted_detail` 对 ToyCar 给出明确结论：「只有玻璃/车窗类独立件（Glass），车身仍是单网格；玻璃学不出车门，**不能治门漂移**」。也就是说 ToyCar **不能**作为「部件级条件源」，只能作材质/相机测试与整体参考。
- **建议改法**：把 ToyCar 的「用途」列从「材质/相机测试，已转白模」明确为「**仅整体参考 + 材质/相机测试**；不可用作部件级条件源（车身未分件，分不出车门）」，并在「风险」列加一句，避免后续把它当成分件管线的验证样本。

### M7 · `research/community_assets.md` §5 第 1 条——量产/变体的建议需要与「资产分级」对齐

- **位置**：`research/community_assets.md` §5「选择建议」第 1 条：「量产/变体继续用程序化；近景主资产用 CC0 下载件（Poly Haven / Kenney / MakeHuman）。」
- **建议改法**：补一句分级口径——「近景主资产」宜明确为 **hero 级（≤ 50k 面）**，其余下载件归 **mid/low 级（≤ 5k / ≤ 500 面）**；并指出 Kenney 单件面数 <1,000，天然落在 low/mid 带，Poly Haven 需减面才能进 mid 带。这一改动只影响建议措辞，不改既有结论。

### M8 · 新增建议：把「跨项目契约」提升为一等文档

- **位置**：`plans/` 目录（新增 `plans/CONTRACT-conditions.md`），并在 `plans/PLAN.md` §5 执行记录追加一行指向它。
- **理由**：本项目与 `resources3D` 已在**深度极性**与**上轴**上出现**相反约定**（见本文 §2.6.3）。两份文档各自都正确，合起来会静默出错。**最省事的防错手段不是改代码，而是把「深度极性 / 上轴 / 通道清单 / 随图三要素 / 跨边界字段」写成一份共享契约，并让两个项目的读取端都带校验。**

---

### M9 · 「OpenAssetManagement (OAM)」这个说法需要更正为「OpenAssetIO」

- **位置**：本轮任务书里出现的「OpenAssetManagement」；以及任何打算引用它的路线讨论。
- **实测**：ASWF 名下 `OpenAssetManagement` / `OpenAssetManager` 两个仓库地址**均为 404**，GitHub 仓库检索也返回空（本轮两路独立核对，结论一致）。真正存在并活跃的是 **`OpenAssetIO`**（Apache-2.0，`github.com/OpenAssetIO/OpenAssetIO`），定位是「面向媒体生产中工具与内容管理系统的开源互操作标准」。
- **建议改法**：路线讨论里凡提到 OAM 的，一律改称 **OpenAssetIO**，并引用其官方插件：`usdOpenAssetIOResolver`（USD AR2 插件）、`otio-openassetio`（OTIO 插件）、`fpt_openassetio_manager`（ShotGrid manager 插件）、`OpenAssetIO-Manager-BAL`（最小 manager 参照）。
- **意义**：OpenAssetIO 的核心主张与我们的处境**高度一致**——「用当前的文件系统位置引用受管数据，会剥掉关于数据身份、用途与来源的语义信息」；解法是「用实体引用按身份引用，属性按需解析」。这直接支持 §2.5.2 的 `asset_id` + `version` + `fingerprint` 设计，并给了「有 id 按 id 解析、无 id 按路径兜底」的两级查找范式。**建议：借模型，不引运行时依赖。**

### M10 · `harness/shot_spec.py` 的缓动口径需要按镜头类型分档

- **位置**：`harness/shot_spec.py` 的 `_smoothstep`（注释写「与 render_shot.cam_at 一致，关键帧之间不留折角」）。
- **实测与依据**：摄影机运动学的通行实践是——**恒速推轨应使用线性插值**（Bezier / 自动手柄会在两端引入缓动、破坏匀速感）；缓动只用于有起停的镜头，且缓动应作用在**位移量**而非每帧角度上。官方插值文档本轮未核对到（Cloudflare 挑战页），故按通行实践标注、不当权威。
- **建议改法**：镜头库落地时让 `camera.move` 显式带 `easing`（`linear` / `smoothstep` / `handheld`），**恒速类镜头默认 `linear`**；保留现有 `_smoothstep` 作为有起停镜头的默认值，不改既有代码路径，避免影响已验证的竖切片。

---

## 9. 附：本文引用的文件（全部在本仓库内或兄弟目录，只读）

| 路径 | 用途 |
|---|---|
| `plans/PLAN.md` | 约束 C1–C5、阶段 P0–P7、决策 D1–D7、风险表、验收对照 |
| `research/community_pipeline_practices.md` | B 部分调研正文：资产生产 / 资产管理 / 导演台 / 镜头库四方向，逐条带来源链接与来源清单 |
| `research/paradigms.md` | 范式 A–F 与候选底座表（含「没有成熟开源参数化汽车底座」判定） |
| `research/somax.md` / `research/somax_repo_readme.md` | SOMA-X 能力、许可、本机实测 |
| `research/community_assets.md` | 社区公开资产来源与许可矩阵 |
| `harness/*.py` | 现状能力盘点（§1.2 的全部依据） |
| `assets/manifest.json` | 79 件登记 |
| `assets/validation/validation_report.json` | 16/16 校验读数 |
| `assets/validation/exports.json` | 24/24 回读 |
| `assets/validation/conditions_check.json` | 条件渲染耗时与隐藏测试 |
| `assets/validation/public_assets.json` / `public_decimated.json` | 公共件台账与减面读数 |
| `assets/validation/shot_001.json` / `shot_spec.json` / `retarget_bvh.json` | 竖切片与镜头读数 |
| `assets/nongeometry/*.json` | 场景布局、相机路径、植被参数、载具动力学、FX 代理 |
| `../resources3D/eval/metrics_spec.md` | 条件图评估协议（六通道口径与「随图三样东西」） |
| `../resources3D/research/harness/wmcore.py` | lineart/shade 参考实现、深度极性、sha256、视锥检查 |
| `../resources3D/gallery/manifest.json` | 资产清单字段模板 |
| `../resources3D/research/05-synthesis.md` | 13 行覆盖矩阵与架构裁定 |
