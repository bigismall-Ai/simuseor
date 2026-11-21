# 范式调研：CPU + 云端 LLM 约束下的白模参考资产生成路线

> 评估口径统一为四项：**CPU 路径可用性**、**代码/资产可运行性**、**与硬约束匹配度**、**对白模参考目标的适用性**。
> 本文件只陈述可核对的来源；主观评分在报告中单独标注为「评估值」。

## 0. 先给结论

1. **没有任何单一范式覆盖全部类别。** 硬表面（道具/载具/建筑）靠「代码即几何」；人物/生物靠「参数化底座」；场景/人群靠「图元装配 + 实例化」；动作/相机/特效靠「参数化数据 + 代理」。
2. **CPU 侧需要统一汇合层。** 推荐 `glTF/GLB（几何）+ OpenUSD（场景/相机/骨骼/时序）+ JSON（语义契约）`，而不是把某个 DCC 软件当运行时。
3. **质量上限由验证闭环决定，而不是由生成范式决定。** BlenderGym（CVPR 2025）明确观察到：在推理算力有限时，**增加验证（verifier）比增加生成更有效**；3DCodeBench（2026）与 CodeGen-3D 也把「执行成功率/渲染一致性」作为核心指标。
4. **有机形态不能靠代码硬写。** 人物走 SOMA-X / MakeHuman；动物走 SMAL；植被走 L-system 参数化；否则只能得到不可用的体块。

## 1. 范式 A：程序化代码生成（Code-as-3D）

LLM 输出可执行脚本，本地确定性解释器执行成几何。**这是本项目的主干范式**：可复现、可 diff、可单元测试，且天然适配 CPU。

### A1. Blender Python（bpy / headless）

- 形态：`blender -b -P gen.py` 或 `import bpy`（PyPI 包）。
- 能力：网格、曲线、布尔、修改器、绑定、材质、渲染六视图，一站式。
- 证据：BlenderGym（<https://arxiv.org/abs/2504.01786>）用「代码编辑 + 六视图渲染」评测 VLM；3DCodeBench（<https://arxiv.org/pdf/2606.01057>）系统评测 12 个 VLM 的程序化建模能力；CodeGen-3D（IEEE，<https://xplorestaging.ieee.org/document/11355469/metrics>）给出编译/运行错误率 + 六视图协议。
- 约束匹配：CPU 可执行（`-b` 无界面）；GPL-2.0+；**bpy 与 Python 版本强绑定**（4.x 需 3.11，本机 3.13 装不上）→ 用独立 Blender 进程隔离，别把 bpy 塞进业务 venv。
- 白模适用：硬表面/建筑/道具强；人物/生物弱（需要绑定与拓扑）。
- 风险：启动开销大、错误信息对 LLM 不友好（需包一层结构化 harness）。

### A2. CAD 脚本（CadQuery / build123d / OpenSCAD / FreeCAD API）

- CadQuery（Apache-2.0，Python）：`Workplane` 链式建模，STEP/STL 导出，B-Rep 精度。
- build123d（Apache-2.0）：CadQuery 同族，代数式 API，更适合 LLM 生成（上下文管理器 + 运算符）。
- OpenSCAD（GPL-2.0）：声明式 CSG 语言，`openscad -o out.stl in.scad` 纯 CPU 批处理，是最稳的「代码→实心白模」路径，但只有 CSG，无圆角/曲面 loft。
- FreeCAD（LGPL-2.1）：Python 宏 + 参数化表，`freecadcmd` headless；生态成熟但 API 冗长。
- 证据：CAD-Coder（<https://arxiv.org/abs/2505.14646>）证明 VLM 可生成语法 100% 合法的 CadQuery 代码（GenCAD-Code 16.3 万对），但**其模型本身属于专用生成模型，本项目只借鉴「代码 + 几何奖励」的验证思路，不调用其权重**。
- 约束匹配：全部 CPU；导出 STEP 让下游 CAD/CFD 可用；对「尺寸正确」极友好。
- 白模适用：道具、机械件、建筑构件、载具外壳；不适合有机形态（倒角/曲面成本高）。

### A3. Web / JS 几何引擎（three.js、Babylon.js）

- three.js（MIT）：`BufferGeometry` + CSG 扩展，Node 侧可导出 GLB；Babylon.js（Apache-2.0）自带 CSG/布尔。
- 优势：前端预览与生成同构；GLB 直出；适合「场景装配 + 网页审阅」。
- 劣势：无 B-Rep、无数控级精度；布尔鲁棒性弱于 manifold3d。
- 适用：大型场景的装配与预览，不作为精密件主路径。

### A4. 声明式 JSON 几何配方 + 自有解释器

- 形态：LLM 只输出 `{"type":"loft","sections":[...]}` 之类配方，本地解释器调 trimesh/manifold3d 生成。
- 优势：**可校验、可回滚、可白名单**（禁止任意代码执行）；错误可精确定位到配方字段；输出稳定可复现。
- 劣势：表达力受解释器限制，LLM 无法「发明」新几何算法。
- 本报告实测：用该范式生成了载具车身 loft、建筑体量、L-system 植被、人群布局（见 `assets/`）。

**A 范式结论**：作为**几何主干**采用；其中硬表面优先 A2/A4，场景装配优先 A1/A3，精密件用 A2 输出 STEP。

## 2. 范式 B：结构化 Token / 图元序列

LLM 输出「零件 + 装配关系」的符号序列，由确定性组装器拼成资产。

### B1. ShapeAssembly DSL

- 论文：<https://arxiv.org/pdf/2009.08026v1>（2020/2021）。用「长方体零件代理 + 父子附着 + 对称」描述结构，程序可参数化生成一族形状。
- 价值：**零件层级与对称约束**天然匹配家具、载具、建筑体块；组装器极轻（CPU）。
- 边界：只有长方体代理，细部需后续替换为 A 范式的精细网格。

### B2. SceneScript / BIMScript（结构化场景程序）

- SceneScript（Meta，ECCV 2024，<https://arxiv.org/pdf/2403.13064v1>）：场景即 `make_wall / make_door` 等命令序列，紧凑、可读、可直接编辑。
- BIMScript（2026，<https://arxiv.org/pdf/2608.21447>）：把结构化场景程序推进到 BIM 语义摄取。
- 注意：这两者的**推理端是专用模型**（点云→命令），不在本项目约束内；可借鉴的是**语言设计与执行器**，由云端 LLM 直接产出同类命令。
- 价值：建筑/室内/大型场景的语义化装配；导出 IFC/USD 后可保留楼层、房间、构件语义。

### B3. 装配图 + 参数化零件库（URDF / glTF 节点图 / USD Composition）

- 形态：LLM 输出 `{part: "wheel_18in", transform: ...}`，CPU 侧从零件库实例化并组装。
- 兼容性最好：URDF 进仿真（pybullet/MuJoCo CPU），glTF 进引擎，USD 进 DCC。
- 价值：**人群代理、载具编队、场景重复元素**的首选；层级语义完整保留。
- 风险：零件库覆盖度决定上限；库的维护成本高于写代码。

**B 范式结论**：作为**装配与场景层**采用（B3 为主，B1 为约束表达），不做单件精细几何的主路径。

## 3. 范式 C：参数化模型操控

LLM 只「拨参数」，几何由经过验证的参数化系统生成。**这是白模质量最稳的一条路**。

| 编号 | 底座 | 覆盖类别 | CPU | 许可 | 判断 |
|---|---|---|---|---|---|
| C1 | **SOMA-X**（<https://github.com/NVlabs/SOMA-X>） | 人体 + 手 | ✅ 官方 12.1ms/mesh（32 核）；纯解析 | Apache-2.0 | **人物/服装底座首选**，详见 `somax.md` |
| C2 | SMPL / SMPL-X（<https://smpl-x.is.tue.mpg.de/>） | 人体 + 手 + 表情 | ✅ | 非商用研究许可 | 生态最广，但商用需授权；作为兼容后端而非主选 |
| C3 | MakeHuman + MPFB2（<https://static.makehumancommunity.org/mpfb.html>） | 人体（含全年龄） | ✅（需 Blender） | 代码 AGPL；**导出资产 CC0** | 需要 Blender 进程；适合快速体型库 |
| C4 | **SMAL**（<https://smal.is.tue.mpg.de/>） | 四足动物（马/狮/狗/牛…） | ✅ | 非商用研究许可 | 动物白模唯一成熟底座，但**骨架与人体异构**，需独立重定向 |
| C5 | **OpenVSP**（<https://openvsp.org/pyapi_docs/latest/>） | 飞机/飞行器 | ✅ headless Python API | NASA NOSA 1.3 | 载具（航空）最强参数化，可导 STEP/STL |
| C6 | **IfcOpenShell + Bonsai**（<https://ifcopenshell.org/>） | 建筑/BIM | ✅ | LGPL-3.0 | 建筑构件语义与 IFC 互操作最佳 |
| C7 | Freeship / DELFTship | 船体 | ✅ | 免费/开源版本 | 船体曲面参数化；导出 OBJ/STL |
| C8 | Arbaro / ngPlant / Blender Sapling | 植被 | ✅ | 开源（Arbaro Java） | 参数化树；Sapling 已停止维护但可跑 |
| C9 | 汽车参数化库 | 汽车 | — | — | **诚实边界：没有成熟开源参数化汽车底座**；用 A 范式 loft + 零件库替代 |

- 共同风险：**底座许可**。C2/C4 为研究许可，商用时必须替换为 C1/C3 或自建。
- 生物骨架异构：SOMA-X 77 关节（人）与 SMAL 四足骨架完全不同，动作资产不能直接复用，只能做「同拓扑重定向」或分别生成。
- 服装：没有成熟开源「参数化服装底座」。可行路径是「人体底座 + 偏移壳/板片 + CPU 布料模拟（Blender Cloth）」，或商业软件。**这是本项目最诚实的缺口之一。**

**C 范式结论**：人物、动物、飞机、建筑、船体、植被全部走 C；其余类别用 A/B 补。

## 4. 范式 D：Agentic 验证与迭代闭环

「生成→执行→验证→反馈→修正」，是废网格与可用白模的分水岭。

### D1. 执行 harness 的结构化反馈

- 把解释器 stderr、异常栈、导出失败统一转为 `{error_code, asset_path, message, hint, offending_params}`。
- 证据：BlenderGym 的「verifier scaling」结论（<https://openaccess.thecvf.com/content/CVPR2025/papers/Gu_BlenderGym_Benchmarking_Foundational_Model_Systems_for_Graphics_Editing_CVPR_2025_paper.pdf>）。

### D2. 视觉验证（CPU 渲染）

- 路径 1：Blender Cycles CPU 渲染（无需 GPU，但慢）。
- 路径 2：`trimesh` + 软光栅/自研 z-buffer（本报告实测：纯 numpy + Pillow，零 GPU，毫秒级到秒级）。
- 路径 3：`pyrender` + OSMesa（Linux 更稳，Windows 支持差）。
- 反馈形态：多视角图 → 云端 VLM 打分（LLM 仅 API），或与参考剪影做 IoU。

### D3. 几何/场景/非几何验证器

| 验证器 | 检查内容 | CPU 成本 | 输出信号 |
|---|---|---|---|
| 网格完整性 | 水密、法线一致、退化面、自交 | 低（manifold3d/trimesh） | 布尔 + 面/边定位 |
| 尺度校验 | 包围盒 vs 类别先验（人身高、车门高、层高） | 极低 | 偏差百分比 |
| 地面接触 | min-z、脚底/轮胎贴地 | 极低 | 悬空/穿地毫米数 |
| 碰撞/穿插 | AABB / 凸包 / 三角形相交 | 中 | 相交对列表 |
| 关节限位 | 欧拉角/四元数区间、膝肘反关节 | 极低 | 越界关节名 + 角度 |
| 脚部滑步 | 支撑相脚趾世界位移 | 低 | 滑移米/帧 |
| 相机视锥 | 目标点投影覆盖率、主体居中、离屏比例 | 极低 | 覆盖率 + 建议位移 |
| 运动连续性 | 关节角速度/加速度上限 | 极低 | 爆点帧号 |

### D4. 多 Agent 分工

- Planner（拆资产清单）→ Coder（写配方/脚本）→ Executor（本地 CPU）→ Critic（几何+视觉）→ Repair（按 hint 改参数）。
- 工具层建议统一为 **MCP**：`blender-mcp`（<https://pypi.org/project/blender-mcp-server/>）、`freecad-mcp`（<https://buildcad.ai/guides/cad-mcp-servers> 提到 neka-nat/freecad-mcp）、OpenSCAD/CadQuery MCP 均已存在。
- 注意：MCP 解决「调用标准化」，**不解决几何正确性**；正确性仍靠 D1–D3 的验证器。

**D 范式结论**：不是可选优化，而是**必选基础设施**；本报告用真实「失败→反馈→修复→复检」演练验证其可行性。

## 5. 范式 E：跨类别组合策略

| 资产类别 | 首选范式 | 具体工具/底座 | 表达层级 |
|---|---|---|---|
| 人物 | C | SOMA-X（CPU/商用） | 完整几何（低模） |
| 服装 | C + A | 人体底座 + 偏移壳/板片 | 简化几何（外壳） |
| 道具 | A + B | CadQuery/OpenSCAD/JSON 配方 | 完整几何 |
| 载具（汽车） | A + B | loft + 零件库 | 完整几何 |
| 载具（飞机） | C | OpenVSP | 完整几何 |
| 载具（轮船） | C | Freeship/DELFTship | 完整几何 |
| 建筑 | B + C | BIMScript 风格 + IfcOpenShell | 完整几何（构件级） |
| 大型场景 | B + A | USD 组装 + 程序化街区 | 完整几何 + 实例 |
| 生物/动物 | C | SMAL（研究许可） | 完整几何（低模） |
| 植被 | C + A | L-system / Arbaro | 简化几何（枝干+冠代理） |
| 人群 | B + F | 实例化 + UsdSkel/缓存 | 代理表达 |
| 特效占位 | F | 体积/轨迹 JSON + USD Volume | 纯数据/代理 |
| 动作 | F | BVH + 重定向 | 纯数据 |
| 摄像机 | F | USD Camera / JSON | 纯数据 |

统一执行层建议：**MCP 工具网关 + JSON Schema 契约 + USD 汇合 + GLB 交付**。E 范式的本质不是「一个工具打天下」，而是「一套契约打天下」。

## 6. 范式 F：非网格参考资产与异构编排

### F1. 动作与表演

- 格式：**BVH**（Biovision，纯文本、关节层级 + 通道 + 帧数据），CPU 可读写、可 diff、可被 Blender/UE/Unity/Maya 消费。
- 生成路径：LLM 输出步态参数/关键帧（关节角、相位、步幅）→ 本地 CPU 烘焙成 BVH → 校验（关节限位、脚滑、根位移）。
- 复用路径：Mixamo（免费，需联网获取）、AMASS（许可需核对）离线动作库检索 → 重定向到 SOMA-X 骨架。
- 诚实边界：LLM 直接生成「表演级」细腻动作不可行；可行的是**程序化步态/基础动作 + 检索复用 + 人工修**。

### F2. 摄像机与空间参考

- 表达：`position / target / up / focal_length / sensor_width / near / far`，必要时加 `focus_distance / fstop`。
- 载体：USD `UsdGeomCamera` 或 glTF `camera`；本报告额外输出 JSON 以便校验与 diff。
- 验证：把主体包围盒投影到 NDC，算**画面覆盖率与居中偏移**，这是可自动化的「构图检查」。
- 价值：下游视频生成模型对相机运动最敏感，**相机参数是控制信号强度最高的非几何资产**。

### F3. 特效 / 破坏占位

- 轻量路径：轨迹点 + 半径/密度场 JSON（烟、尘、火花），CPU 零依赖；USD Volume 或 Alembic 缓存对接 DCC。
- 体积路径：OpenVDB（MPL-2.0，CPU）写 `.vdb`；Windows 上 pip 轮子不稳定，建议 conda/预编译。
- 破坏：pybullet（zlib，CPU）刚体碎裂 → 碎片变换序列 → USD PointInstancer / Alembic。
- 诚实边界：体积代理对下游视频模型的**控制力弱于几何**，通常需转成深度/法线/遮罩图才有效。

### F4. 同步与导出

- **USD 是唯一能同时承载「几何 + 骨骼 + 相机 + 体积 + 时序」的开放格式**（<https://openusd.org/release/api/_usd_skel__intro.html>），且 `usd-core` 在 CPU 上可用（本机实测 26.11）。
- glTF/GLB 作为「单资产交付 + 网页预览」，USD 作为「场景编排 + 时序」，JSON 作为「LLM 可编辑的语义层」。
- 证据：UsdSkel 官方定位就是「跨 DCC 交换蒙皮网格与关节动画，并支撑大规模人群」。

**F 范式结论**：非几何资产不追求网格，追求**确定性格式 + 可验证参数 + 可被下游消费**；其中相机与动作的控制信号最强，特效体积最弱（需转控制图）。

## 7. 必须如实报告的根本性障碍

1. **纯 CPU + 无生成式模型 ⇒ 不可能得到照片级有机细节**（皮肤、毛发、树冠、布料褶皱）。白模参考体系的天花板是「结构正确 + 比例正确 + 运动正确」，不是「好看」。
2. **汽车与服装缺少成熟开源参数化底座**，只能代码 loft + 零件库 / 人体底座 + 壳层，属于「可用但需人工打磨」。
3. **面部、口型、表情**不在 SOMA-X 覆盖范围内（SMPL-X 有表情但许可受限），真人特写对白戏需要额外面部方案。
4. **动物动作不能直接复用人动作**（骨架异构），SMAL 还需要额外的四足步态生成与重定向。
5. **特效体积对下游视频模型的控制信号弱**，必须转成深度/法线/遮罩等 2D 控制图。
6. **LLM 一次成功率低**（BlenderGym/CAD-Coder 均显示需要多轮），因此「验证闭环」的工程量往往大于生成器本身。

## 8. 来源清单

| 主题 | 链接 | 类型 |
|---|---|---|
| SOMA-X Model Card | <https://huggingface.co/nvidia/SOMA-X> | 可运行代码 + 权重 |
| SOMA-X 仓库/文档 | <https://github.com/NVlabs/SOMA-X> · <https://nvlabs.github.io/SOMA-X/stable/> | 可运行代码 |
| BlenderGym | <https://arxiv.org/abs/2504.01786> · CVPR 2025 PDF | 论文 + 基准代码 |
| 3DCodeBench | <https://arxiv.org/pdf/2606.01057> | 论文/基准 |
| CodeGen-3D | <https://xplorestaging.ieee.org/document/11355469/metrics> | 论文/基准 |
| CAD-Coder | <https://arxiv.org/abs/2505.14646> | 论文 + 代码（模型不采用） |
| ShapeAssembly | <https://arxiv.org/pdf/2009.08026v1> | 论文 + 代码 |
| SceneScript | <https://arxiv.org/pdf/2403.13064v1> | 论文 |
| BIMScript | <https://arxiv.org/pdf/2608.21447> | 论文 |
| OpenVSP Python API | <https://openvsp.org/pyapi_docs/latest/> | 可运行工具 |
| SMAL | <https://smal.is.tue.mpg.de/> | 模型（研究许可） |
| SMPL-X | <https://smpl-x.is.tue.mpg.de/> | 模型（研究许可） |
| MakeHuman MPFB2 | <https://static.makehumancommunity.org/mpfb.html> | 可运行插件 |
| IfcOpenShell | <https://ifcopenshell.org/> | 可运行库 |
| OpenUSD UsdSkel | <https://openusd.org/release/api/_usd_skel__intro.html> | 规范/库 |
| Blender MCP server | <https://pypi.org/project/blender-mcp-server/> | 可运行工具 |
| CAD MCP 生态盘点 | <https://buildcad.ai/guides/cad-mcp-servers> | 综述 |
