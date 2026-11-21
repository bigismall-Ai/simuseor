# A/B 两包独立验收报告（AUDIT-AB）

- 审计人：Verifier（独立复算，不采信实现者自述）
- 审计日期：2026-11-21
- 审计对象：
  - **A 包**：`harness/shot_spec.py`、`harness/vehicle_dynamics.py`、`harness/test_shot_spec.py`、
    `assets/nongeometry/vehicle_dynamics.json`、`assets/validation/shot_spec.json`
  - **B 包**：`harness/conditions.py`、`harness/test_conditions.py`、
    `assets/validation/conditions_check.json`、`assets/previews/cond_*.png`
- 审计方式：读源码 → 从**实际落盘产物**（GLB / JSON / PNG）反推约定 → 自己重写一份独立实现复算 →
  实跑被审代码 → 看图。临时产物全部写在 `E:\Projects\model-downloader\var\audit\`。
  **未修改任何项目文件**（`git status` 确认 `research/` 仍为未跟踪状态，无本审计产生的改动）。

> **审计期间的并发变更说明**：审计中途（22:01:24）`assets/geometry/*` 被**并行子代理**重新生成了一次
> （本审计**未**调用 `generate_all()`：跑 `test_conditions.py` 时我把 `_scene_from_generate_assets` 打桩成抛异常以规避该副作用）。
> 事后复测确认：`car_a` 节点矩阵、20 个车辆部件名与关键坐标、调色板缺陷、隐藏实验的前景像素数
> （235824→235090 / 260284→253811 / 145017→120750）**与本报告数字完全一致**，结论不受该次重生成影响。
> 被审的 5 个源码文件（`shot_spec.py` 21:46:57、`vehicle_dynamics.py` 21:45:21、`conditions.py` 21:53:27、
> `test_shot_spec.py` 21:46:29、`test_conditions.py` 21:52:32）在审计全程**未发生变化**。

---

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| A 包（镜头描述 + 载具动力学） | **核心正确，可进集成波次**；1 处高危接线问题 + 1 处中危边界不一致需先修 |
| B 包（条件通道渲染器） | **渲染内核正确**；1 处高危调色板缺陷 + 1 处中危副作用 + 1 处中危产物信息丢失需先修 |
| 矩阵约定（本次最关键一条） | **✅ 独立确认正确**，不采信自述：从 `geomlib.R_axis` / `scene_layout.json` / `scene_street.glb` 节点变换 / `validate.py:326` 四条独立证据链反推，行主序 + 列向量 `p_world = M @ p_local`，A 包实现与之一致（误差 0.0 m；行向量假设下误差 7.0 m） |
| 车辆前向 = local +X | **✅ 从落盘 GLB 独立确认**（前灯 x=+2.100 / 尾灯 x=-2.150） |
| yaw 增大 = 左转 | **✅ 独立确认**（yaw 0→90°，相机水平朝向有符号夹角 = +90.000000°） |
| 实测问题数 | **2 高 / 3 中 / 3 低**（含 1 条测试设计缺陷） |
| 总评 | **暂不建议直接进集成波次**，需先修 §3 的 H1/H2/M1/M2/M3 |

---

## 1. 逐项验收表

### A 包

| # | 断言 | 我的独立实测结果 | 结论 |
|---|---|---|---|
| A1 | `resolve_camera(spec, t, asset_transforms) -> {"eye","target","focal_mm"}` | `inspect.signature` → `(spec: 'dict', t: 'float', asset_transforms: 'dict') -> 'dict'`；3 个位置参数、无默认值；返回键恰为 `{eye, target, focal_mm}`，`eye`/`target` 是 `ndarray(3,)`，`focal_mm` 是 `float` | **PASS** |
| A2 | 矩阵约定 = 行主序 JSON + 列向量 `p_world = M @ p_local` | 四条独立证据：① `geomlib.R_axis("z",d)` 写的是 `m[0:2,0:2]=[[c,-s],[s,c]]`、`geomlib.T` 写 `m[:3,3]` → 列向量；② `scene_layout.json` 的 car_a = `[0,-1,0,-5.6, 1,0,0,-1.4, 0,0,1,0.04, 0,0,0,1]`，与手写列向量矩阵差 **6.12e-17**，与转置差 **5.6**；平移在**最后一列**（最后一行为 False）；③ 落盘 `scene_street.glb` 的 car_a 节点矩阵与 `scene_layout.json` **逐位相同**；④ `validate.py:326` 显式 `m[:3,:3] @ v + m[:3,3]`。A 包侧：`track_to_matrix` 与我手写列向量矩阵误差 **0.0**；`resolve_camera` 的 mounted 分支与 `M @ p_local` 误差 **0.0**（eye/target 均是），行向量假设下误差 **7.0 m** | **PASS** |
| A3 | 车辆前向 = local **+X** | 从落盘 `vehicle_car.glb` 逐部件包围盒中心读出：前灯 `+2.100`、尾灯 `-2.150`、前轮 `+1.360`、后轮 `-1.360`、仪表台 `+0.580`、方向盘 `+0.400` → 前向确为 **+X**。左/右：`seat_left.y=+0.330`、`door_front_left.y=+0.783` → 左为 **+Y** | **PASS** |
| A4 | `yaw=0` → local +X 指向世界 +X；**yaw 增大 = 左转** | yaw 0→90° 的合成轨迹：相机水平朝向有符号夹角 = **+90.000000°**（左）；`track_to_matrix(0)` 的 local+X → 世界 `(1,0,0)`，`yaw=90` → `(0,1,0)`；右手系推导 `right = fwd×up = -Y` ⇒ 左 = +Y，自洽。demo 轨迹 yaw 0→270（即 -90°）时相机朝向旋转 **-90.000000°**（右转） | **PASS** |
| A5 | 动力学派生信号正确 | **自己重写一遍** `derive_dynamics`（不 import 其公式）：<br>• 直线 49 帧：speed 误差 **6.4e-14**、accel **2.3e-12**、yaw_rate **0.0**、wheel_angle **4.9e-7**、刹车灯/转向灯 **0 处不一致**<br>• demo 193 帧：实现 vs 我的 speed **3.9e-7**、accel **5.0e-7**、yaw_rate **3.6e-7**、wheel **5.0e-7**、刹车/转向 **0 处不一致**<br>• 解析闭式复核：转弯段圆弧终点与闭式解差 **2.21e-10 m**；刹车 59 帧、转向灯 21 帧、末速 0.0、最小 accel -2.600004、最大 \|yaw_rate\| 45.000001 | **PASS**（另见 L2 观察） |
| A6 | 跨文件同源 / 采样对齐 | `vehicle_dynamics.json` 与 `shot_spec.json` 的 track **逐点完全相同**（193 == 193，`tracks_identical=True`）；dynamics 帧时间序列与 camera_samples 时间序列在重叠区 **逐点相等**；`camera_samples[0].actor_transforms` 与 `track_to_matrix` 一致；`camera_samples[0].eye` 与 `resolve_camera` 重算一致 | **PASS** |
| A7 | 尾巴①：演示轨迹未注册到场景 `car_a` | 场景 car_a = `(-5.6,-1.4,0.04)` yaw=+90°；demo 起点 `(0,0,0)` yaw=0 → **位置差 5.7723 m、航向差 90°**。把 demo spec 挂到**真实街景**上渲染：8 个采样时刻 **0 帧**的相机在 car_a 包围盒内，与 car_a 中心距离从 **6.12 m 涨到 36.61 m**；t≈3.5 s 后相机驶出路面（road x∈[-22,22]）与人行道区域 | **FAIL**（详见 §3-H2、§5） |
| A8 | 尾巴②：193 vs 192 差一行 | dynamics 193 帧（t=0…8.0）、camera_samples 192 帧（t=0…7.958）。第 193 个轨迹点 t=8.0 **不被任何相机采样使用**；轨迹覆盖闭区间 [0, 8.0]（`validate_spec` 强制要求），故是**刻意多一个端点**；按下标对齐在重叠区**完全正确** | **PASS（无害）**，但下游需处理长度差（详见 §5） |
| A9 | 公开接口契约 / world 模式复用 | `resolve_camera` 的 world 模式喂入真实 `camera_path.json` 的 4 个关键帧，误差 **0.0**；`actor_transforms_at` 轨迹插值误差 **0.0** | **PASS** |
| A10 | 同名 asset 的一致性（我追加的边界检查） | `actors` 里两条同名 `car_a` 时：`resolve_camera(spec,t,{})` 取**第一条**（eye `[0,0,1]`），`resolve_camera(spec,t,actor_transforms_at(spec,t))` 取**最后一条**（eye `[100,0,1]`）→ **相差 100 m** | **FAIL**（详见 §3-M2） |

### B 包

| # | 断言 | 我的独立实测结果 | 结论 |
|---|---|---|---|
| B1 | depth 前景归一化 ∈[0,1]、背景统一 | 前景 min=0.0 max=1.0；背景**只有 1.0 一个取值**；`zbuf` 最近/最远 = 2.6165 / 40.165 m；depth 对 z **单调**；我自己按文档公式重算整幅图，与实现差 **0.0** | **PASS**（歧义见 M3） |
| B2 | normal 可逆（平面法线） | **我自己写反解**（`v=c*2-1` 后归一化）：最大误差 **6.673608765606076e-08**（与实现自报一致）；单位长度偏差 2.2e-16；16bit PNG 路径 **1.8649e-05**（自报 1.8458e-05，同量级）；8bit PNG **9.746e-3**（不可逆，与文档声明一致）；前景逐像素常量 ⇒ 确为**面法线**；背景唯一 `(0,0,0)` | **PASS** |
| B3 | normal 几何正确性（我追加） | 地面像素 **95.53%** 在 1° 内等于 +Z，平均法线 `(0, -0.0447, 0.9553)`；把像素反投影回世界后比较法线与"指向相机"方向：street 视角 **100%** ≤90°、POV **99.26%**、close **90.4%**，**>120° 的翻转像素 0 个** ⇒ 法线既未镜像也未反号 | **PASS** |
| B4 | seg 语义 | 街景 9 个 label、调色板颜色**两两不同**；同一 label 的像素颜色**全部一致**（0 个不一致）；`body` 裂成 2 个连通分量**同色**（3076 + 1528 px）——seg 是按 label 而非按连通分量，**可接受** | **PASS** |
| B5 | **调色板固定**（实现者设计目标 #4） | **❌ 不成立**：同一个 label 的颜色**随本次渲染的 label 集合而变**。例：`wheel_rear_left` 单独渲染 = `[40,40,46]`（= wheel 类色），与 `wheel_front_left` 同时渲染 = `[30,88,230]`（黄金比例补色）。把整车 20 个部件按部件名做 label 渲染时，**20 个里有 10 个没用上自己的类别色**：`door_front_left=[236,176,64]` vs `door_front_right=[30,88,230]`（同一语义类别却是两种颜色）、`wheel_front_left=[40,40,46]` vs `wheel_rear_left=[30,155,230]` | **FAIL**（详见 §3-H1） |
| B6 | 隐藏能力在真实场景生效 | **是场景几何，不是逻辑问题**。真实街景（从磁盘 GLB 重建）下：<br>• street 机位：前景 235824 → 235090（**-0.311%**，复现自报的 0.31%）；可见帧中车的像素 **4681**，隐藏后仍为车像素的 **0**；其中 734 变成背景、3947 变成路面；这些像素深度中位数 **+11.93 m**<br>• POV 机位：260284 → 253811（**-2.487%**，复现自报 2.5%）；车像素 **198283**（相机确实在车壳内部），隐藏后仍为车像素 **0**，191810 px 变成外部世界，深度中位数 **+7.27 m**<br>• closeup 机位：145017 → 120750（**-16.73%**）<br>• 隔离场景（只留车 + 真实 POV 机位）：**198792 → 0**<br>⇒ **隐藏逻辑在真实场景里完全生效**，百分比低是因为车后面就是路面/人群/建筑（前景换前景），不是隐藏失效 | **PASS** |
| B7 | 性能 512×512 三通道 | 真实街景（20996 三角面）连测 5 次，**两轮独立连测：最好 80.6 ms / 中位 82.0~83.8 ms / 最差 87.7 ms**（光栅 67.5 ms；depth 1.1 / normal 5.8 / seg 5.2 ms）——落在自报 83~90 ms 区间内 | **PASS** |
| B8 | 接口可用性（裸 trimesh 与 dict 两种形态） | 裸 `trimesh.Trimesh` → label 自动落 `other`、正常出图；`{"mesh","label","hide"}` → label 生效、`hide=True` 后前景 **0**；两者 mask **完全相同**；返回键包含 `depth/normal/seg/mask/zbuf/facebuf`（另有 `face_normals/depth_range_m/resolution/meta`） | **PASS** |
| B9 | 语义表能否覆盖 C 的部件拆分 | 从落盘 `vehicle_car.glb` 取全部 20 个部件名逐一过 `resolve_category`：**20/20 全部命中，无 `other`**；落到 10 个类别（body/cabin/door/wheel/headlight/taillight/mirror/seat/dashboard/steering_wheel） | **PASS**（但颜色分配有洞，见 H1） |
| B10 | 与既有管线兼容性 | `conditions.py` **只** `from geomlib import Camera`，**未** import `geomlib.render` ✔；模块导入期**不**触发 `generate_assets`（我打桩验证：`generate_assets_imported_on_module_import = []`）；但 `_scene_from_generate_assets()` 会调用 `generate_all()`，**重写 `assets/geometry/*`** | **部分 FAIL**（详见 §3-M1） |
| B11 | 调色板跨进程确定性 | 3 个独立进程跑 `build_palette` → 输出**完全一致** ✔（黄金比例路径确定；`hash()` 兜底分支未触发，但见 L3） | **PASS** |

### 跨包

| # | 断言 | 实测 | 结论 |
|---|---|---|---|
| X1 | B 的语义表覆盖 A/C 的几何名 | 20/20 覆盖（见 B9）。缺口不在**归类**，在**配色**（H1）：一旦 C 按部件名给 label，同类部件会被涂成不同颜色 | **PASS（归类）/ FAIL（配色）** |
| X2 | A 与 B 的接口能否对接 | `resolve_camera` 返回世界坐标 `eye/target/focal_mm`；`conditions.render_conditions(meshes, camera, ...)` 需要一个带 `eye/target/up/fov_y/width/height/focal_mm/sensor_mm` 的 camera 对象 ⇒ 需要一层 `focal_mm → fov_y` 的转换（`fov_y = 2·atan(sensor/(2·focal))`，`validate.py:166` 已有同样算法）。**该转换在两包里都不存在**，集成时必须补 | **WARN**（缺胶水层） |

---

## 2. 我实际看到的图（不是复述 JSON）

> 全部 PNG 为 512×512，用 Read 工具直接看图。

**`cond_depth.png`（8bit 灰度）**：**近 = 黑，远 = 白**（与文档「0=最近、1=最远」一致，**与常见深度图"近=白"相反**）。
画面下半是近处路面/地面 → **几乎纯黑**；两个建筑立面是**浅灰**并带轻微竖向渐变（越远越亮）；远处人群/主角是**中灰**；左侧那辆车是**深灰**；两条建筑之间的缝隙以及画面上缘是**纯白**（= 背景 1.0 = 无几何）。
→ 空间层次读得出，但**「无几何」和「最远的几何」在像素上是同一个白**。

**`cond_normal.png`（世界空间法线，c = n·0.5+0.5）**：
- 地面/马路是**淡紫蓝（periwinkle ≈ 128,128,255）** → 反解为 **n = (0,0,+1) 朝上** ✔
- 左侧建筑正面是**紫（128,0,128）** → n = (0,−1,0) 朝南（面向相机）✔；其右缘一条**鲑红竖条** → n = (+1,0,0) 朝东 ✔（相机在该建筑以东）
- 右侧建筑是**鲑红** → 朝东的立面 ✔；POV 版里右侧建筑则是**青绿（0,128,128）** → n = (−1,0,0) 朝西，**与"相机在 building_b 以西"吻合** ✔
- 树冠是**橙红/黄绿相间的团块**、树干是**橙红** → 曲面法线随角度连续变化 ✔
- 人群是**带彩色刻面条纹**的细条（胶囊体 8 面法线交替）✔
- 左侧那辆车呈现**顶部偏鲑红、侧面偏淡**的车身轮廓（俯视 +X/-Y 朝向的车顶应为 +Z 淡紫蓝；数值统计显示车像素主轴为 +X 2327 / +Y 1522 / −X 832，与"相机看到的是车身右侧面（世界 +X）与车尾（世界 −Y）"一致）

**`cond_seg.png`（语义分割）**：背景纯黑；两栋建筑**砖橙**；前景地面**橄榄绿**、马路**深灰**、人行道**浅灰**；左侧那辆车**饱和蓝**（= `vehicle` 52,108,214）；树冠**亮绿**、树干**墨绿**；一排人群**浅棕**；正中的主角**洋红**（= `character`），从人群里一眼能分开。
→ 9 类颜色**两两可辨**，主角/人群/车/树/建筑/地面层次清楚 ✔

**`cond_car_seg.png`（贴近车、机位低，车在天空剪影上）**：整车是**一整块饱和蓝**，车顶/车门/轮子**没有分色**（因为场景里 car_a 是**合并网格**、只有一个 label=vehicle）；车身上两个**黑色矩形 = 车窗镂空透出的背景**（从低机位透过近侧窗洞看到对侧窗洞外的天空）——这说明**空腔车壳的镂空被正确渲染成背景**，不是黑洞。左侧露出一棵树。

**`cond_pov_seg.png`（车载 POV + 隐藏车壳）**：画面里**完全找不到车的像素**，只剩**砖橙建筑、绿色树、浅棕人群、橄榄绿地、深灰马路**，上方两栋楼之间一条**纯黑竖缝 = 天空**。
→ **隐藏后确实只剩外部世界**，这是"隐藏生效"最直观的证据。

**`cond_pov_normal.png`（POV 法线）**：地面**淡紫蓝（+Z）**、左楼**紫（−Y 朝南）**、右楼**青绿（−X 朝西）**、树冠**橙红渐变**、人群**多色刻面**。
→ 法线是**世界空间**的、方向与相机位置自洽 ✔

---

## 3. 发现的问题清单（按严重度）

### H1（高）— seg 调色板**不是**按 label 固定的：同一 label 在不同渲染里颜色会变
- **位置**：`harness/conditions.py:337-388` `build_palette()`
- **成因**：每个 label 先去取 `CATEGORY_COLORS[类别]`，但只要该类别色**已被本轮更靠前的 label 占用**（`if col is None or col in used: col = None`），
  就退到**按本轮 label 集合顺序推进的黄金比例补色**。因此颜色取决于**本次渲染里还有哪些别的 label**，而不是 label 自身。
- **复现**：
  ```python
  build_palette(["wheel_front_left"])["wheel_front_left"]            # -> (40,40,46)  = wheel 类色
  build_palette(["wheel_front_left","wheel_rear_left"])["wheel_rear_left"]  # -> (30,88,230) 黄金比例补色
  build_palette(["wheel_rear_left"])["wheel_rear_left"]              # -> (40,40,46)  = wheel 类色
  ```
  把整车 20 部件按部件名当 label 渲染 → **10/20 个 label 没拿到自己的类别色**：
  `door_front_right=[30,88,230]` vs `door_front_left=[236,176,64]`；`wheel_rear_left=[30,155,230]` vs `wheel_front_left=[40,40,46]`。
- **影响面**：直接违反模块自己的设计目标 #4「调色板必须固定：调色板若每次随机生成，模型/标注工具就没法学习类别」。
  **对 C 包是阻塞项**：C 正在把 `vehicle_car` 拆成 body/door_left/door_right/wheel_*/headlight/taillight 等独立部件，
  一旦按部件名给 label，同语义类别的左右件/前后件会拿到完全不同的颜色，"颜色 ↔ 类别"的可学习性就没了。
- **建议修法**：颜色按 **CATEGORY** 分配——同一类别的所有 label 共用 `CATEGORY_COLORS[类别]`；
  若确实需要 label 级唯一，改成**类别色 + label 哈希派生**的确定性扰动（例如 `color = clamp(cat_color ± (hash(label)%16 - 8))`），
  而不是依赖"本轮 label 集合"的全局序列。

### H2（高）— 演示轨迹与场景里的 `car_a` **完全不是一回事**，但产物自称是 `car_a`
- **位置**：`harness/shot_spec.py:328-358` `build_demo_spec()`；`harness/vehicle_dynamics.py:210-274` `build_demo_trajectory()`
- **证据**：场景 `car_a` = `(-5.6,-1.4,0.04)` yaw=+90°（`scene_layout.json`）；demo 起点 `(0,0,0)` yaw=0 → **位置差 5.7723 m、航向差 90°**。
  把 `assets/validation/shot_spec.json` 挂到**真实街景**上渲染：8 个采样时刻 **0 帧**相机在 car_a 包围盒内，
  与 car_a 中心距离 **6.12 m → 36.61 m**；demo 终点 `(27.776,-16.401)` 已驶出路面（road x∈[-22,22]）。
  同时 `vehicle_dynamics.json` 写着 `"asset": "car_a"`，`shot_spec.json` 写着 `"mount": {"asset": "car_a"}`。
- **影响面**：任何按字面把该产物当作「car_a 车载 POV」消费的下游，拿到的相机在街上空飞、
  **永远看不到自己的车**、也**永远不在车里**（B 包的"车载 POV 隐藏车壳"工作流在这条轨迹上没有可隐藏的对象）。
  t=0 那一帧画面里 9.0% 的前景像素是车——那是**对面的 car_b**（camera 在 x=0.36 朝 +X 看，car_b 在 x=9.0），不是它自称的 car_a。
- **定性**：**不是"仅 demo 未接线"的良性尾巴**——产物字段本身是**错的**（asset 绑定不成立），会被下游当真。
- **建议修法**（二选一）：
  1. 用场景真值生成轨迹：`start_pos=(-5.6,-1.4,0.04)`、`start_yaw_deg=90`，并把路径约束在 road 走廊内
     （现在的直行段沿 +X 走 19.5 m，落在路的延长线上但不在路面上）；
  2. 若 demo 本就不该绑定场景：把 asset 改名为 `demo_car`，加 `"scene_binding": null` 与
     `"note": "本轨迹未注册到场景任何载具，不可直接当车载 POV 使用"`。

### M1（中）— `conditions.py --demo` 会对**共享资产**产生写副作用
- **位置**：`harness/conditions.py:886-896` `_scene_from_generate_assets()` → `generate_assets.generate_all()`
- **证据**：`generate_assets.py:817` 起的 `generate_all()` 会 `export_glb/export_obj/export_stl` **重写 `assets/geometry/*`** 与
  `assets/nongeometry/*`；`assets/validation/conditions_check.json` 里 `"scene_source": "generate_assets.generate_all()"`
  即证明产物就是这么生成的（磁盘上 `assets/geometry/*.glb` 的 mtime 21:54:18 与之吻合）。
- **影响面**：跑一次 `conditions.py --demo` 就会覆盖别人刚生成/刚修好的几何资产；当前 `generate_assets.py` 正在被并行修改，
  一旦它抛异常还会**静默降级**到 `_fallback_scene()`（622 三角面的玩具场景），产物看起来仍然"成功"。
- **建议修法**：主路径改为**只读**加载 `assets/geometry/scene_street.glb` + `scene_layout.json`（我已验证这条路径可完整重建 22 个场景件、
  且节点矩阵与 `scene_layout.json` 逐位一致）；把 `generate_all()` 降级为显式 opt-in（`--regen`）或干脆去掉。

### M2（中）— 同名 asset 时，`resolve_camera` 的两条调用路径结果**不一致**
- **位置**：`harness/shot_spec.py:80-93`（`actor_transforms_at`：**同名取最后一条**）vs `shot_spec.py:96-109`（`_mount_matrix`：**取第一条**）
- **复现**：`actors` 里放两条同名 `car_a` →
  `resolve_camera(spec, 0.5, {})` → eye `[0,0,1]`；`resolve_camera(spec, 0.5, actor_transforms_at(spec,0.5))` → eye `[100,0,1]`。
  **相差 100 m**，且两者都是文档里写的合法调用姿势。
- **影响面**：正是任务里担心的「静默错位」族；spec 里出现同名 asset（例如想给同一部件两条分镜轨迹）时，
  走哪条调用路径决定镜头在哪。
- **建议修法**：`_mount_matrix` 与 `actor_transforms_at` 统一为"同名取最后一条"；并在 `validate_spec` 里**直接拒绝**同名 asset 重复。

### M3（中）— 8bit 深度 PNG 丢失了「背景 vs 最远几何」的区别
- **位置**：`harness/conditions.py:854-882` `save_condition_pngs()`；编码约定见 `conditions.py:302-305`
- **证据**：`DEPTH_BACKGROUND = 1.0`，而**最远的前景像素恰好也是 1.0**（实测 `fg.max()==1.0`），
  PNG 又是 `mode="L"` 单通道、**没有 mask 通道**（`save_condition_pngs` 不输出 mask）。
- **影响面**：下游若直接吃 `cond_depth.png`，无法区分「天空/空几何」与「最远的墙」。这是"参考图喂给图生图模型"的典型坑。
  （文档 `DEPTH_ENCODING` 写了"背景像素固定为 1.0"，**没有**明说"与最远前景不可区分、必须配 mask"。）
- **建议修法**：额外输出 `cond_depth16.png`（16bit）+ `cond_mask.png`，或在文档里显式加一句
  「depth 的 1.0 有二义性，必须与 `mask` 联用；PNG 产物请用带 alpha 的版本」。

### L1（低）— demo 轨迹把 yaw 存成 `0 → 270`（-90°）
- **位置**：`harness/vehicle_dynamics.py:273` `math.degrees(yaw) % 360.0`
- **证据**：`shot_spec.json` 的 track 里 yaw 为 `0.0 … 270.0`。
- **影响面**：模块自身的插值用 `wrap180` 处理得**完全正确**（实测相机旋转 -90.000000°，右转无误）；
  但任何"yaw 变大 ⇒ 左转"的朴素下游读 JSON 会把右转误读成左转。
- **建议修法**：统一存 `(-180, 180]` 区间的有符号 yaw，并在 JSON 里加 `"yaw_convention": "signed_deg, CCW=+ (left), range (-180,180]"`。

### L2（低）— 速度/加速度在**转弯段**有系统性偏差（弦长 vs 弧长）
- **证据**：直行段速度波动 **恰为 0.0**（docstring 声称的 "1e-8 量级" 成立甚至更好）；
  但 45°/s 的右转段里报告速度从 6.5 降到 **6.4458 m/s（-0.83%）**，转弯→刹车的交界帧加速度报 **-1.293 m/s²**
  （真值 -2.6，中央差分在加加速度阶跃处的固有半步偏差），刹车灯因此**晚 1 帧（42 ms）**点亮。
- **影响面**：不构成错误（刹车阈值 -2.0 未被误触发，最小 accel 仍是 -2.600004）；但 docstring 的
  「位移 ↔ 速度 ↔ 加速度三者**严格自洽**」应改成"与**弦长**度量严格自洽"。
- **建议修法**：速度改用**弧长**（相邻采样点间用航向积分）而非弦长，或在文档里注明该偏差量级。

### L3（低）— 调色板兜底分支用了**跨进程不确定**的 `hash()`
- **位置**：`harness/conditions.py:383` `cand = (17 + (abs(hash(lab)) % 200), 17, 17)`
- **证据**：Python 字符串 hash 默认按进程随机化 → 该分支的输出**跨进程不可复现**，与
  「同一组 label 每次得到同一套颜色」的承诺冲突。实测 3 个进程走黄金比例分支结果一致（该分支未触发）。
- **建议修法**：改用 `hashlib.md5(lab.encode()).hexdigest()` 取稳定哈希。

### T1（低，测试设计缺陷）— `test_perf_512` 在 `generate_assets` 失效时**静默降级**，性能护栏失效
- **位置**：`harness/test_conditions.py:269-291`
- **证据**：我把 `_scene_from_generate_assets` 打桩成抛异常后，测试改用 `_fallback_scene()`（**622 三角面**），
  耗时 **58.4 ms**，预算断言 `best < 1500 ms` 依然 PASS；真实街景是 20996 三角面。
- **影响面**：`generate_assets.py` 一旦坏掉，这个"性能护栏"根本不会报警。
- **建议修法**：断言 `source` 必须是真实场景，否则 fail（或按场景规模缩放预算）。

---

## 4. 两个自述"尾巴"的判断结论

### 尾巴①：演示轨迹未注册到场景 `car_a` 实际位置 (-5.6,-1.4)
**结论：是真问题，不是"仅 demo 未接线"的良性项。**
理由：(a) 产物字段本身宣称绑定了 `car_a`（`vehicle_dynamics.json.asset="car_a"`、`shot_spec.json.camera.mount.asset="car_a"`），
**绑定在事实上不成立**；(b) 实测 8/8 采样帧相机都在 car_a 包围盒外，距离 6.1→36.6 m，**车载 POV 根本不存在**；
(c) 轨迹后半段驶出路面/人行道，落到空地平面上；(d) 由此 B 包"车载 POV 隐藏车壳"的能力在这条轨迹上**无对象可隐藏**。
→ 必须在进集成波次前处理（见 H2）。性质上属于**交付物的语义错误**，不是代码 bug。

### 尾巴②：`vehicle_dynamics.json` 193 帧 vs `shot_spec.json` 192 采样
**结论：是无害的、刻意为之的尾部差一行，不是索引错位 bug。**
理由：(a) `build_demo_trajectory` 用 `np.arange(n+1)/fps` 造 **含终点**的轨迹，而 `sample_shot` 按 `n = round(fps*duration)` 造帧
（t = 0…(n-1)/fps = 7.958），两者的差就是**闭区间端点**那一行；
(b) `validate_spec` **强制**要求 actor 轨迹覆盖 `[0, duration_s]`（`shot_spec.py:313-315`），端点缺失反而会报错；
(c) 实测两边的**时间序列在重叠区逐点相等**（`ts_aligned_overlap=True`），按下标对齐完全正确；
(d) 末尾多出的第 193 帧（t=8.0，speed=0，brake=false）**不被任何相机采样使用**，它只是让"轨迹覆盖到 duration"成立。
**唯一要提醒下游的**：动力学帧 193 与相机采样 192 长度不等，按下标 zip 会**丢掉最后一帧动力学**（无害，因为那一帧没有对应镜头），
若下游要用"最后一帧速度=0 表示停车"，需要显式按 `t` 对齐而不是按 index。

---

## 5. 测试质量评估

### `test_shot_spec.py`（实测 10/10 通过）

| 用例 | 质量判定 | 说明 |
|---|---|---|
| 验收1 mounted 矩阵一致性 | **有效但半盲** | `manual_matrix` 独立手写、与实现分离 → 确实钉住了"乘法顺序 = `M @ p_local`"（误差 0.0）。
  但它**无法发现行/列约定搞错**——因为实现与测试用的是**同一套**约定假设。
  **约定正确性是我在包外用 `geomlib`/`scene_layout.json`/`scene_street.glb`/`validate.py` 四条证据独立钉死的**，测试没覆盖这一层。 |
| 验收2 静止载具相机恒定 | 有效 | 漂移 0.0；是真实行为断言（但强度一般，恒等实现也能过） |
| 验收3 右转 90° | **有效** | 有符号角 `ang<0` 的符号断言是真的在钉方向。
  ⚠️ 同一函数里 demo 子断言写成 `signed_angle_deg(cd1-dir, cd0-dir)`——**参数顺序反了，符号被翻正**；
  因为只断言了 `abs()` 所以没暴露。若日后收紧成符号断言会直接写错。 |
| 验收4 匀速段动力学 | 有效 | 用字面量 6.5 校验速度、yaw_rate 恒 0、无刹车灯 |
| 验收5 减速段刹车灯 | 有效（略弱） | 检查了"至少有一帧"+"静止段速度严格为 0"；**没有**断言"刹车灯在转弯段/静止段必须为 false" |
| 验收6 依赖纯 numpy | 有效 | 源码扫描 + `sys.modules` 双查 |
| 附加 公开接口契约 | 有效 | 签名逐参断言 |
| 附加 validate_spec | 有效 | 4 种定向变异（挂载 asset 不存在 / 眼点超高 / 轨迹不覆盖 / 不支持的通道）都被抓 |
| 附加 world 模式复用相机路径 | 有效 | 直接吃真实 `camera_path.json`，关键帧误差 0.0 |
| 附加 交付产物落盘 | 有效但覆盖面窄 | 抓到"两个 JSON 的 track 必须逐点相同"（很好） |
| **未覆盖** | — | ① demo 的 car_a 轨迹**是否等于场景里 car_a**（H2 就是从这里漏过去的）；② 同名 asset 的两条路径不一致（M2）；③ yaw 符号**相对场景约定**（`R_axis("z",90)`）是否一致；④ 动力学帧与相机采样是否**按时间**对齐（只查了 track 相同，没查时间序列）；⑤ mounted 相机的眼点**是否真的在车包围盒内** |

### `test_conditions.py`（实测 14/14 通过）

| 用例 | 质量判定 | 说明 |
|---|---|---|
| depth 范围/背景统一 | 有效 | 前景 ∈[0,1]、背景单值、且与 `zbuf` 自洽 |
| normal 浮点往返 | **有效** | 参考值取 `face_normals[facebuf[mask]]`（几何真值，不是把编码再解一遍），我独立复算误差一致 |
| normal 16bit PNG 往返 | 有效 | 文件级可逆性；8bit 只记录不断言（正确） |
| seg 颜色唯一 / 连通区域一致 | 有效 | 但**只在自造最小场景**上跑 |
| 隐藏减少前景 | **有效且设计得好** | 有"隔离场景：隐藏后前景必须归零"的最强判据（我复现 23080→2389、隔离 22714→0） |
| 隐藏不是空转 | 有效 | 反证式断言 |
| 性能 512 | **弱（T1）** | 会静默降级到 622 面的玩具场景 |
| 语义映射 | 有效（只测了**归类**） | **没测配色** → H1 就是从这里漏过去的 |
| 调色板固定且唯一 | **空洞（H1 漏网点）** | 只校验"同一 label **集合**换个顺序结果一样"与"表内不重复"；
  **从不校验"同一 label 在不同集合里颜色相同"**，也**从不校验"label 颜色 == 其类别颜色"**。 |
| 其余（分辨率独立 / 便捷函数 / 近平面裁剪 / 深度单调） | 有效 | 行为断言扎实 |
| **未覆盖** | — | ① **真实街景从未被断言**（真实场景只在 `conditions_check.json` 里"记录"，不在测试里"断言"）；
  ② 调色板跨 label 集合稳定性；③ 真实场景的隐藏效果（真实场景下"隐藏后车像素必须为 0"这条最强判据没有进测试）；
  ④ depth PNG 的背景/最远二义性 |

**总评**：两套测试**都不是空洞测试**（断言大多在独立验证行为，关键矩阵与法线真值都没有同义反复），
但它们**恰好绕开了两个真问题**：B 的调色板稳定性与 A 的场景绑定。这两处是"测试看着在测、其实没测到"的典型。

---

## 6. 机器可读结果

`E:\Projects\model-downloader\var\audit\audit_ab.json`（含 `audit_a.json` / `audit_a2.json` /
`audit_b.json` / `audit_b2.json` / `audit_b3.json` 的全部原始数字 + `verdict` 汇总）。

## 7. 复现方式

```powershell
$py = "E:\Projects\model-downloader\.venv\Scripts\python.exe"
& $py "E:\Projects\model-downloader\var\audit\audit_a.py"     # A 包：约定 / 前后向 / 动力学 / 产物一致性
& $py "E:\Projects\model-downloader\var\audit\audit_a2.py"    # A 包：demo 轨迹 vs 场景 car_a 的后果
& $py "E:\Projects\model-downloader\var\audit\audit_b.py"     # B 包：depth/normal/seg/隐藏/性能/接口
& $py "E:\Projects\model-downloader\var\audit\audit_b2.py"    # B 包：法线几何方向 + 调色板分配
& $py "E:\Projects\model-downloader\var\audit\audit_b3.py"    # B 包：法线正面性全局判据 + A 包附加检查
```
（全部只读项目文件，临时产物只写 `var\audit\`；B 包场景从磁盘 `assets/geometry/scene_street.glb` 重建，
**未调用** `generate_all()`，以免重写共享几何资产。）

---

## 8. 总评

**A+B 这两包现在还不能直接进集成波次。**
底层算法是可信的：A 包的矩阵约定、朝向语义、动力学派生经我独立复算全部正确（误差 ≤ 1e-7，闭式解对到 1e-10 m）；
B 包的 z-buffer 光栅、深度归一化、世界空间法线编码与可逆性、隐藏逻辑在真实街景里**确实生效**，
性能 82 ms 也站得住。**真正挡路的是三个"契约层"问题**，而且都会被下游静默继承：

1. **H1（B）seg 调色板不是按 label 固定的** —— 同一 label 换个渲染集合就换色，直接废掉"颜色↔类别"的可学习性，
   并且**正好卡住 C 包的部件拆分**（20 个部件里 10 个拿不到自己的类别色）。
2. **H2（A）演示产物自称 `car_a` 却与场景里的 `car_a` 无关** —— 车载 POV 根本不存在（0/8 帧在车内，距离 6→37 m），
   下游会拿到一条"在街上空飞、看不到自己的车"的镜头，并误以为隐藏车壳流程可用。
3. **M1（B）`conditions.py --demo` 会重写 `assets/geometry/*`** —— 在多人并行的环境里这是数据破坏型副作用。

**必须先修的最小集**：H1、H2、M1（阻断级）；建议同波次修掉 M2、M3（各 10 行内）；L1~L3、T1 可随后。
修完这两包即可进集成波次 —— 但**还需要一层胶水**：两包之间缺 `focal_mm → fov_y` 的转换与"载具部件 → label"的绑定规则（X2）。
