# SOMA-X 调研：参数化人体底座在「CPU 白模管线」中的定位

抓取证据：`research/somax_readme.md`（Hugging Face Model Card）、`research/somax_repo_readme.md`（GitHub README）。
抓取时间：2026-11-19。上游链接：<https://huggingface.co/nvidia/SOMA-X> 、<https://github.com/NVlabs/SOMA-X> 、文档 <https://nvlabs.github.io/SOMA-X/stable/>

## 1. 它是什么

SOMA（Unifying Parametric Human Body Models）是 NVIDIA 的参数化人体统一层：把多个「身份模型」（体型空间）映射到**统一的规范拓扑 + 77 关节骨架**上，从而让同一套 LBS（线性混合蒙皮）、同一套姿态参数、同一套动画重定向流程跨后端复用。

- 核心管线**没有可学习的网络**：重心坐标网格迁移（稀疏矩阵乘）、RBF 骨架拟合（单次线性求解）、LBS 三段闭式解析。
- 可选一个浅层 MLP 做姿态相关表面修正（约 1e8 参数），属于可关闭项。
- 版本 v0.3.0，新增左右手 `SOMAHandLayer`（25 关节、三档 LOD）与 MANO 互操作。

## 2. 支持的内容（身份后端与 LOD）

| 身份后端 | 说明 | 对本项目的意义 |
|---|---|---|
| SOMA-shape（原生） | SizeUSA + TripleGangers 体扫拟合的 128 维 PCA 体型空间 | 无第三方许可负担，Apache-2.0，可直接商用 |
| SMPL / SMPL-X | 经典参数化人体，需**另行获取**模型文件，许可为研究/商用需授权 | 与现有动画生态兼容，但许可风险高 |
| MHR（Momentum Human Rig） | Meta 的人体绑定，需核对许可 | 新生态，暂不主推 |
| ANNY | 覆盖全年龄段的体型模型 | 儿童/老年角色体型覆盖 |
| GarmentMeasurements | 由服装测量参数驱动的体型 | 服装白模的体型适配 |
| MANO（手） | 用户自备模型文件 | 手部精细动作 |

LOD：`mid` 18,056 / `low` 4,505 / `xlo` 612 顶点；手部 mid 2,859 / low 718 / xlo 134。
CPU 延迟（官方口径）：**12.1 ms/mesh（32 核 CPU，batch=1）**；GPU Warp 路径 2.1 ms。核心管线 0 个学习参数，因此在 CPU 上属于「确定性解析执行」，不违反「无 GPU / 无生成式模型」约束。

## 3. 输入 / 输出（接口契约）

输入：

| 参数 | 形状 | 说明 |
|---|---|---|
| identity | `(B, K)`，K=128（原生）或后端维度 | 体型 PCA 系数 |
| pose | `(B, 77, 3)` axis-angle 或 `(B, 77, 3, 3)` 旋转矩阵 | 77 关节，排除根虚拟关节 |
| root translation | `(B, 3)` 米 | 根位移 |
| hand pose | `(B, 25, 3)` | 腕部局部坐标，0 号为腕 |
| hand identity | `(B, 20)`（原生）或 MANO 维度 | 手型 |

输出：

| 输出 | 形状 | 用途 |
|---|---|---|
| posed vertices | `(B, N_h, 3)`，米制 | 直接进入渲染 / 白模导出 |
| joints | `(B, 77, 3)` | 空间关系校验、BVH 对齐、视锥检查 |
| rest vertices | `(B, N_h, 3)` | 绑定态参考 |
| hand vertices / joints / transforms | `(B, V_h, 3)` / `(B, 25, 3)` / `(B, 25, 4, 4)` | 手部白模与抓握 |

官方提供 **USD / NPZ I/O**、姿态反解、程序化绑定控制、平滑与转换工具——USD 输出这一点很关键，它意味着 SOMA-X 可以直接成为「统一场景层」的一个节点，而不只是一个孤立脚本。

## 4. 上下游关系

```text
上游数据/资产
  ├─ 体扫数据集(SizeUSA/TripleGangers) → 原生 PCA 体型空间（离线拟合，不参与推理）
  ├─ 动作捕捉 (BVH/AMASS/FBX) ──┐
  ├─ LLM 生成的姿态/步态参数 ───┤→ SOMA 姿态参数 (77×3 axis-angle)
  ├─ CV 姿态估计 (SMPL-X 参数) ─┘
  └─ 可选：SMPL / SMPL-X / MHR / ANNY / MANO 模型文件（各自许可）

SOMA-X 运行时（CPU：PyTorch fallback；可选 Warp GPU 加速）
  ├─ 身份迁移 → 统一拓扑
  ├─ RBF 骨架拟合 → 77 关节
  └─ LBS → 顶点 / 关节 / 手部变换

下游
  ├─ USD / NPZ / glTF 导出 → DCC（Blender/Maya）、引擎（UE/Unity）
  ├─ 深度图 / 法线图 / 骨架图渲染 → 下游视频/图像生成模型的空间控制
  ├─ 机器人仿真、人体工学分析
  └─ 服装白模的贴合底座（GarmentMeasurements 后端）
```

## 5. 对「白模参考资产」的价值判断

**结论：SOMA-X 是人物与服装白模的最佳「参数化底座」，属于范式 C，且是本项目唯一同时满足「CPU 可跑 + 商用许可 + 结构化关节输出」的人体方案。**

优势：

1. 输出是**纯几何匿名人体**，没有纹理/材质，天然就是白模。
2. 77 关节统一骨架 + 关节位置输出，让「动作数据」与「几何白模」在同一坐标系下天然对齐，可直接做 BVH 重定向与关节限位校验。
3. 三档 LOD 让「远景人群代理」与「近景人体白模」共用一套参数，解决人群系统的尺度一致性。
4. USD/NPZ I/O 为统一场景编排层提供了官方接口。

边界与风险（必须如实写进报告）：

1. **不是全类别方案**：服装、道具、载具、建筑、植被、生物、特效均不覆盖。
2. 首次使用需从 Hugging Face 下载权重并缓存；离线机房需预先做资产镜像（`huggingface_hub` 缓存目录）。
3. 依赖 PyTorch（CPU wheel 体积大），但仍是纯 CPU 数值计算，不触发生成式模型。
4. 手部/表情不覆盖面部肌肉与口型，真人电影若需对白特写，仍需面部绑定方案（诚实边界）。
5. 可选 MLP 修正项是学习参数，若坚持「零学习参数」可关闭，代价是关节处表面瑕疵。
6. 官方基准是 32 核；本机低模实测见第 7 节（数值不可与官方 A100/32 核基准直接比较）。

## 6. 与「非几何参考」的衔接

- 姿态参数 `(77,3)` 是**可直接被 LLM 编辑的语义层**：LLM 输出关节角关键帧/步态参数，CPU 侧用 SOMA 前向计算得到网格与关节，再烘成 BVH。
- 关节位置输出可用于：脚部滑步检测（支撑相脚趾位移）、关节限位校验、与摄像机视锥的交集检查。
- 与 SOMA-X 的集成成本：一个 `SOMALayer(device="cpu")` 调用 + 一次 USD 导出，属于低集成成本；真正的成本在体型资产库管理与许可合规。

## 7. 本机 CPU 实测（2026-11-19）

环境：`uv` 创建的 Python 3.11 venv（`var/soma-venv`），`py-soma-x 0.3.6`、`torch 2.15.0+cpu`、`warp-lang 1.19.0`；
`SOMALayer(device="cpu", mode="dense", lod="low")`，单位米、T-pose（全零姿态与体型系数），预热后取 5 次中位数。
权重放在 `var/soma-assets`（gitignored），仅下载所需后端文件。

| 后端 | 顶点 / 面 | 水密 | 身高（米） | 前向耗时（中位数） | 产物 |
|---|---|---|---|---|---|
| SOMA 原生（128 PCA） | 4,505 / 9,006 | 是 | 1.697 | **10.3 ms** | `assets/geometry/soma_native_low.glb` |
| MHR（45 体型 + 68 尺度） | 4,505 / 9,006 | 是 | 1.736 | **12.9 ms** | `assets/geometry/soma_mhr_low.glb` |
| ANNY（6 表型） | 4,505 / 9,006 | 是 | 0.444 | **31.0 ms** | `assets/geometry/soma_anny_low.glb` |
| ANNY 成人（A-pose） | 4,505 / 9,006 | 是 | 1.776 | **37.6 ms** | `assets/geometry/soma_anny_adult.glb` |

说明：
- ANNY 传入零表型得到 0.44 m 的儿童体型，正好验证其「全年龄」覆盖能力；成人用 `gender/age/muscle/weight/height/proportions` 六个表型，按身高搜索取 `height=0.45`（其余 0.5），得到 1.776 m。
- **街景主角已替换为 ANNY 成人 A-pose 白模**（`assets/geometry/scene_street.glb` 与 `assets/previews/scene_hero.png`），不再使用早期体块人偶。
- A-pose 的实现要点：SOMA 原始输出为 **Y-up**，绕 Y 轴旋转只会让手臂前后摆；要放下手臂必须绕 **Z 轴**旋转（左臂 −58°、右臂 +58°），导出时再统一转 Z-up。
- 三个后端输出同一套 SOMA 拓扑与 77 关节，因此可以共享后续的动画、白模与验证管线。
- MHR 只下载了 lod6（2 MB）；完整 lod1 权重为 **663.9 MB**，在 HF 上可直接下载（Apache-2.0），本次未下载。
  MHR 自身有 **7 档 LOD（0–6）**，SOMA 只接线了 lod1（高模，配合 SOMA `lod="mid"`，输出 18,056 顶点）与 lod6（低模，配合 `lod="low"`，输出 4,505 顶点）；
  「MHR 高模」指高细节身份模型 lod1，不是指生成式大模型。
- 原始输出为 Y-up、髋部在原点；导出时统一转为 **Z-up 并平移至脚底 z=0**，转换标记记录在 `assets/validation/soma_cpu_test.json`。

## 8. 五类引用资产：能否下载复用

| 资产 | 在 SOMA-X 中的形态 | 获取方式 | 许可 | 本机结论 |
|---|---|---|---|---|
| SOMA（原生） | `SOMA_neutral.npz`（25.4 MB）+ 模板（27 MB）+ 修正模型（28.4 MB） | HF 直链 / 自动缓存 | Apache-2.0 | ✅ 已跑通 |
| MHR | `MHR/mhr_model_lod1.pt`（663.9 MB）、`lod6`（2 MB）+ 对应网格 | HF 直链 | Apache-2.0（上游仓库） | ✅ lod6 已跑通；lod1 需再下 664 MB |
| ANNY | `pip install anny`（45.5 MB，内含模型）+ `Anny/*.obj` | PyPI | Apache-2.0 | ✅ 已跑通 |
| SMPL | 仅对应网格（`base_body.obj` / `SOMA_wrap.obj`），**不含模型文件** | 需在 MPI 站点注册登录下载 | 非商用研究许可；商用走 Meshcapade | ⛔ 未下载（需账号） |
| SMPL-X | 同上 | 同上 | 非商用研究许可 | ⛔ 未下载（需账号） |
| MANO（手） | 仅 wrap 网格，不含 `MANO_*.pkl` | 需在 MPI 站点注册下载 | 非商用研究许可 | ⛔ 未下载（需账号） |

工程建议：
1. 商用链路只用 **SOMA / MHR / ANNY** 三个 Apache-2.0 后端；SMPL 家族仅用于研究对比，且在 CI 中做许可白名单。
2. 离线部署时把 `var/soma-assets` 或 HF 缓存目录整体镜像，`SOMALayer(data_root=...)` 指向本地目录即可，运行期不再联网。
3. 若必须使用 SMPL/SMPL-X，模型文件按官方要求放在版本库之外，通过 `identity_model_kwargs={"model_path": ...}` 传入。
