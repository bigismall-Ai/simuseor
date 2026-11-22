# 条件通道契约 · CONTRACT-conditions

> **所属**：`research/tree-resources-builder` · R0 · 契约统一
> **阶段**：R0（阻塞 R1/R2/R3/R4/R5/R6/R7）
> **可执行副本**：`harness/condition_contract.py`（本文的常量与 sidecar schema 都在那里）
> **硬约束继承**：`plans/PLAN.md` §0 C1–C5（禁 3D 生成式模型｜全 CPU｜LLM 仅云端 API｜白模分几何层/非几何参考层｜交付物含可回读校验的真实生成物）
> **本阶段不做**：不改 PLAN.md / paradigms.md / AUDIT-AB.md 等既有文件；不引入 Blender 渲染；不下载任何模型权重；不做下游 A/B 验证。

---

## 0. 这份契约解决什么

一句话：**把「下游到底要什么」写成机器可校验的东西**，让「图发给下游」不再靠口头约定。

它裁定了三件事：

1. **六通道**是什么：depth / normal / seg / mask / lineart / pose，各自的语义、取值域、编码约定。
2. **两个跨仓库冲突**：深度极性（原来两边相反）、上轴（本项目 Z-up，resources3D Y-up）。
3. **随图 sidecar**：每张图旁边一份 JSON，把下游需要但图里读不出来的元数据（画幅、焦距像素值、near/far、极性、上轴、前景定义）钉死。

**唯一权威实现**：`harness/condition_contract.py`。本文与它不一致时，以代码为准（且必须同步改本文）。

---

## 1. 全局约定

| 项 | 值 | 谁定 | 说明 |
|---|---|---|---|
| 单位 | **米（meter）** | 本契约 | 两仓库一致，无冲突 |
| 手系 | **右手系** | 本契约 | 两仓库一致，无冲突 |
| 上轴 | **Z-up**（世界 +Z 朝上） | 本契约 | 与 `assets/nongeometry/scene_layout.json` 的 up_axis: "Z" 一致 |
| 深度度量 | 相机空间**前向轴**距离（沿光轴的米数），不是欧氏距离 | 本契约 | 两仓库一致 |
| 深度归一化 | **按帧**内前景 min/max 线性拉伸 | 本契约 | 跨帧不可比；跨帧比较必须用度量深度 |
| 投影 | 针孔、方形像素、主点在图像中心 (W/2, H/2) | 本契约 | 见 §5.3 的 sensor-fit 冲突 |
| 焦距 | **以 f_px（焦距像素值）为准** | 本契约 | focal_mm / sensor_mm 只作参考，见 §5.3 |
| 色彩 | PNG sRGB 容器，像素值是**编码值不是光度值** | 本契约 | 条件图是控制信号，不是渲染图 |

### 1.1 世界坐标到相机的换算（两边一致）

~~~
fwd    = normalize(target - eye)
right  = normalize(cross(fwd, up))
upv    = cross(right, fwd)

相机空间:  x = d·right   y = d·upv   z = d·fwd      (z 向前为正)
投影:      px = W/2 + (x/z)·f_px     py = H/2 - (y/z)·f_px
深度:      沿光轴的 z（米），透视校正插值 d = 1 / (w0/z0 + w1/z1 + w2/z2)
~~~

---

## 2. 六通道契约

闭集（`condition_contract.CHANNELS`）：**depth / normal / seg / mask / lineart / pose**。
`harness/shot_spec.py` 的 `SUPPORTED_CONDITIONS` 取的就是这份闭集，不另抄。

### 2.0 总表

| 通道 | 语义 | 取值域 | 背景值 | 位深 | 抗锯齿 | 下游用途 |
|---|---|---|---|---|---|---|
| depth | 相机空间前向轴深度，按帧前景 min/max 归一化 | [0, 1] | **0.0** | 8bit 灰度 | 无 | 空间层次 / 相机位姿反解 |
| normal | 世界空间**面**法线（flat，逐像素常量） | [0, 1]³ | (0, 0, 0) | **16bit** 通道图 ×3 | 无 | 表面朝向 / 几何一致性 |
| seg | 语义分割，固定调色板 | 0–255 | (0, 0, 0) | 8bit RGB | 无 | 部件边界 / 可开关 |
| mask | 前景二值（几何可见性） | {0, 255} | 0 | 8bit 灰度 | 无 | 遮挡结构 / 前景抠取 |
| lineart | 轮廓 + 面边界线稿 | {0, 255} | 0 | 8bit 灰度 | 无 | 线稿系 ControlNet（canny/m-lsd/scribble 家族） |
| pose | 2D 人体骨架叠加图 | 0–255 | (0, 0, 0) | 8bit RGB | 无 | 人体姿态条件化 |

**六通道共享同一个前景集合**（同一帧、同一相机、同一次光栅化），也共享同一个 depth 归一化区间 near/far。

### 2.1 depth —— 深度

~~~
z      = 相机空间前向轴距离（米）
z_min  = 本帧前景 z 的最小值        (= sidecar.near)
z_max  = 本帧前景 z 的最大值        (= sidecar.far)
d      = (z_max - z) / (z_max - z_min)   ∈ [0, 1]
背景   = 0.0
~~~

* **极性：近 = 1，远 = 0。**
* 背景（无几何）= **0.0**：背景等价于无穷远，与「远 = 0」自洽。
* z_max == z_min（整个场景一个深度）时退化为常数，避免除零。
* 归一化是**按帧**的：跨帧比较远近必须用度量深度 z，不能用归一化 d。

#### 极性裁定与迁移说明

| | 旧口径 | 新口径（R0） |
|---|---|---|
| 近处 | 0（黑） | **1（白）** |
| 远处 | 1（白） | **0（黑）** |
| 背景 | 1.0 | **0.0** |
| 与 resources3D | **相反**（混用会静默反相） | **一致** |

裁定的理由：resources3D 的 `wmcore.depth_to_unit()` 一直是「近=1 远=0」，ControlNet 生态的深度图也普遍是「近=白」。保持本项目旧口径的代价是每次跨仓库都要显式翻转，而且**翻错了不会报错**。改到与两者一致后，跨仓库可以直接比较。

### 2.2 normal —— 法线

~~~
n      = 世界空间单位面法线（世界系，与相机朝向无关）
c      = n * 0.5 + 0.5        ∈ [0,1]³
存 16bit: v16 = round(c * 65535)      (R/G/B 三张 16bit 灰度通道图)
反解:      n = normalize(v16 / 65535 * 2 - 1)
背景       = (0, 0, 0)
~~~

* **16bit 通道图才是产物**（cond_normal_r16 / _g16 / _b16）；8bit RGB 只是预览，量化误差 ~3.9e-3，会破坏可逆性。实测 16bit 落盘反解误差 1.5e-5。
* 用**世界空间**而不是视空间：同一个物体在不同镜头下可比，也能直接判断几何一致性。
* 是**面**法线（flat），前景逐像素常量；背景固定 (0,0,0)。

### 2.3 seg —— 语义分割

~~~
seg    = 固定调色板[label]      背景 = (0, 0, 0)
~~~

* 调色板必须**固定**：随机生成的话下游模型/标注工具没法学习类别。当前是 12–16 类固定表（`CATEGORY_COLORS`）+ 未知 label 的黄金比例确定性补色，表内颜色两两不同。
* 类别解析：`resolve_category()` 先查直接名表（body / door_left / wheel_front_left / headlight / windshield …），再按前缀归类（building* → building、tree* → tree、crowd* → crowd …），都不匹配归到固定的 other。**无 label 的几何统一是 other，不是「随便一个类」。**
* 调色板 id：tree_resources_builder_fixed_v1。

### 2.4 mask —— 前景掩码

~~~
mask   = 255 if 该像素 z-buffer 命中任何可见几何 else 0
~~~

* **前景定义**：z-buffer 命中的任何可见几何。hide=True 的几何**完全不参与光栅**，因此不进前景。
* 硬二值，**无抗锯齿、无羽化、无膨胀**。
* 与 depth/normal/seg/lineart 的前景**严格一致**（同一次光栅化）。
* 用途：把「天空/空几何」和「最远的墙」分开——这正是 `plans/AUDIT-AB.md` 提的坑。

### 2.5 lineart —— 线稿

~~~
edges    = face_id 的 4-邻域差异 ∧ 非背景
lineart  = edges 的 1px 膨胀（用**原** edges 作源），255 = 线，0 = 背景
~~~

* 算法 id：face_id_boundary_v1，与 resources3D 的 `wmcore.line_art_from_face_id` **逐行对齐**（两边跑同一场景时线稿通道逐像素一致，交叉比对实测 99.993%）。
* 线宽 **1 px**，无抗锯齿。
* 画的是**轮廓 + 分件边界**（面与面之间的边），不是纹理细节。

### 2.6 pose —— 人体姿态

~~~
关键点 = 21 个具名关节，由 3D 世界坐标经**同一相机**投影得到
骨段   = 20 条父子边
画法   = 骨段画线（线宽 3px）+ 关节点画圆点（半径 2px），无抗锯齿
背景   = (0, 0, 0)
配色   = 左侧肢体 (255,64,64) / 右侧肢体 (64,128,255) / 中轴 (240,240,240)
~~~

* **关键点闭集 human_rig_21**（21 个，闭集，可枚举）：
  Hips, Spine, Chest, Neck, Head, L_Shoulder, L_Elbow, L_Wrist, L_Hand, R_Shoulder, R_Elbow, R_Wrist, R_Hand, L_Hip, L_Knee, L_Ankle, L_Toe, R_Hip, R_Knee, R_Ankle, R_Toe
* 名字取自本项目自己的具名骨架（`generate_assets.HUMAN_JOINTS`，与 `assets/nongeometry/character_rig.json` 同源）。
* **不表达遮挡与深度**：全身关节一律画出（下游姿态条件图的惯例）。
* 精确的 2D 坐标同时写进 sidecar 的 `encoding.keypoints`（name / x / y / depth_m / visible），下游**不必**从像素里反解。
* 本契约**不声称** COCO-17 对齐——那是下游映射的事，这里只保证闭集稳定且可枚举。

> **R1 增补**：本节描述的是 R0 定稿的闭集。R1 把关键点闭集扩成「源 + 视图」两层，
> 规范视图改为 `coco18`，`human_rig_21` 降级为**并列视图**（不删）。
> 完整定义、映射表与理由见 **§2.7**；本节保留作为 R0 的原始记录。

### 2.7 姿态关键点闭集（R1 增补）

R0 只钉住「pose = 2D 骨架叠加图」的**格式**，并把「关键点集不是 COCO-17、映射表留给 R1」
明确记在 §9.2。R1 先核实了源：

* **SOMA 77 公共关节确实可用** —— `assets/nongeometry/shot001_hero.npz` 的 `joints` 是
  `(120, 77, 3)`，`pose_store.load_pose_sequence` 读的也是同一份数（`shot003_pose.npz`）；
* 所以按 ROADMAP §4 R1「SOMA 77 关节 → COCO-18 / OpenPose-25」出图。

#### 2.7.1 三层模型：源 / 视图 / 角色

~~~
源 source : 一组具名 3D 关节
           - soma77 : SOMA 的 77 个公共关节（动画序列）
           - rig21  : 项目自有骨架（静态角色，与 character_rig.json 同源）
视图 view : 面向下游的关键点闭集 —— human_rig_21 / coco18 / openpose25
角色 role : 视图关键点 -> 源关节，取值四种：
           joint(直接取) / midpoint(两关节中点) / centroid(多关节质心) / 不可得
~~~

三个视图是**同一 3D 关节源的三种投影**，走同一相机、同一数值链，所以能机械互验
（这就是「关键点图与 pose_store 关节序列数值一致」可以自动验的原因）。

| 视图 | 关键点数 | 骨段数 | 用途 |
|---|---|---|---|
| `human_rig_21` | 21 | 20 | 项目自有骨架（几何侧事实源，`generate_assets.HUMAN_JOINTS` 同源） |
| `coco18` | 18 | 19 | **规范视图**（pose PNG 画的就是它）；COCO-17 原顺序 + `neck` 追加在末尾 |
| `openpose25` | 25 | 23 | OpenPose BODY_25 标准顺序（下游 openpose 系 ControlNet 常用） |

#### 2.7.2 与 R0 的 human_rig_21 的关系：**并存，不替换**

选择：**并存**。`human_rig_21` 保留为并列视图，`coco18` 成为规范视图。理由三条：

1. **human_rig_21 是几何侧的事实源，删了会让代码与文档分家。**
   `assets/nongeometry/character_rig.json` 与 `harness/generate_assets.py` 的 `HUMAN_JOINTS`
   都按这 21 个名字取点，既有代码照旧能用；删掉闭集等于逼着改一批不属于 R1 的文件。
2. **ROADMAP R1 要的是下游可消费性，不是取代。** R1 的范围写的是「SOMA 77 关节 →
   COCO-18 / OpenPose-25」，要的是**多出**两个下游闭集，不是把项目自己的闭集废掉。
3. **三视图同源、数值一致，可以互相验。** 规范视图取 `coco18` 的理由是：ROADMAP 明写
   COCO-18 / OpenPose-25，且 COCO-18 的前 17 个关键点与 COCO-17 **顺序完全一致**
   （下游按 `[:17]` 取即可兼容 COCO-17 消费方）；而 `human_rig_21` 只有本项目自己用。

代价（说清楚，不藏）：静态角色源（rig21）没有鼻/眼/耳节点，`coco18` 里有 5 个关键点
在该源下**不可得**；`human_rig_21` 视图因此仍然是静态角色最完整的表示，两者的完整坐标都写进
`cond_pose_keypoints.json`，下游按需取。

#### 2.7.3 SOMA 77 → 角色 的映射表

SOMA 的命名是「骨骼起始关节」语义：`LeftArm` 是上臂起点（= 肩关节）、`LeftForeArm` 是
前臂起点（= 肘关节）、`LeftHand` 是手部起点（= 腕关节）；`LeftFoot` = 踝、`LeftToeBase` = 趾根。

| 角色 | 取法 | SOMA 关节 |
|---|---|---|
| `nose` | midpoint | LeftEye + RightEye |
| `neck_base` | joint | Neck1（COCO-18 的 `neck`） |
| `neck_top` | joint | Neck2（OpenPose-25 的 `Neck`） |
| `spine` / `chest` / `head` | joint | Spine1 / Chest / Head |
| `left_eye` / `right_eye` | joint | LeftEye / RightEye |
| `left_ear` / `right_ear` | — | **不可得**（SOMA 与项目 rig 均无耳关节） |
| `left_shoulder` / `right_shoulder` | joint | LeftArm / RightArm |
| `left_elbow` / `right_elbow` | joint | LeftForeArm / RightForeArm |
| `left_wrist` / `right_wrist` | joint | LeftHand / RightHand |
| `left_hand` / `right_hand` | centroid | 同侧 5 个指根关节（Thumb1/Index1/Middle1/Ring1/Pinky1） |
| `mid_hip` | joint | Hips |
| `left_hip` / `right_hip` | joint | LeftLeg / RightLeg |
| `left_knee` / `right_knee` | joint | LeftShin / RightShin |
| `left_ankle` / `right_ankle` | joint | LeftFoot / RightFoot |
| `left_big_toe` / `right_big_toe` | joint | LeftToeBase / RightToeBase |
| `left_small_toe` / `right_small_toe` | — | **不可得**（SOMA 足部只有踝/趾根/趾端三个节点） |
| `left_heel` / `right_heel` | — | **不可得**（SOMA 足部无跟骨节点） |

不可得的关键点**不编造坐标**：JSON 里 `x/y/depth_m = null`、`visible = false`，并带
`reason` 说明为什么没有。下游按 COCO 惯例把这类点当 `v=0`（缺失）处理即可。

#### 2.7.4 一个必须记住的坑：Root 偏移

SOMA 输出的 77 个公共关节**不含 Root**（= `_public_joint_names[1:]`）。于是：

~~~
名字表（含 Root）      LeftFoot = 70   RightFoot = 75
77 关节数组（不含 Root）左踝 = 69    右踝 = 74      70 / 75 是趾根
~~~

本仓库历史上 `pose_store.ANK_L = 70`、`render_shot.ANK_L = 70` 用的其实是**趾根**
（把含 Root 的名字表下标直接套到不含 Root 的数组上，整体差一位）。R1 不改那两个文件
（不在 R1 分工内，且它们是「脚锁式根位移」的近似判据，差一位不影响结论），但把这条
钉死在两处：

* `harness/pose_keypoints.py` 的 `SOMA_INDEX_ANCHORS`：名字与下标对不上就**抛错**；
* `verify_soma_source()`：结构自检（小腿/脚三关节 x 同值、高度递减、左 = +x、髋高区间），
  映射错位会当场判红，而不是悄悄出一张错的骨架图。


---

## 3. up_axis 显式化与 Y-up 换算

* 本项目：**Z-up**（世界 +Z 朝上），右手系，米。与 `scene_layout.json` 的 up_axis: "Z" 一致。
* resources3D：**Y-up**（`wmcore.py` 顶部 Y_UP = True），右手系，米。

### 3.1 换算矩阵

~~~
p_yup = (x, z, -y)     即    p_yup = R · p_zup

R = [ 1  0  0 ]      det(R) = +1（真旋转，右手系不变）
    [ 0  0  1 ]
    [ 0 -1  0 ]

Y-up -> Z-up 用 Rᵀ（正交且 det=+1，转置即逆）
~~~

代码里只有一个定义：`condition_contract.Z_UP_TO_Y_UP` / `Y_UP_TO_Z_UP`，以及 `zup_to_yup()` / `yup_to_zup()` 两个函数。

### 3.2 为什么这个换算能保证「逐像素可比」

R 是 det=+1 的真旋转，所以：

* fwd_yup = R·fwd_zup，right_yup = cross(fwd_yup, up_yup) = R·right_zup，upv_yup = R·upv_zup；
* 相机空间坐标逐项相同：x_yup = d_yup·right_yup = (R·d)·(R·right) = d·right = x_zup（旋转保内积）；
* 于是投影像素与深度**只取决于 f_px**，与上轴无关。

### 3.3 纪律

* **不去改 resources3D**。它由另一条线并行推进，本契约只定义换算。
* 跨边界时：**本项目内部一律 Z-up**；需要喂给 resources3D 的几何/相机，**在边界处一次性换算**，不要让 Y-up 的坐标渗进本项目的任何文件。
* sidecar 里 up_axis 永远写本项目的口径（"Z"），Y-up 只出现在跨边界换算的现场。

---

## 4. sidecar 契约

**每张条件图旁边一份同名 JSON sidecar**（cond_<channel>.json）。图在 cond_depth.png，sidecar 就在 cond_depth.json。

### 4.1 必含七字段（缺一即判不合格）

| 字段 | 类型 | 含义 | 为什么必须有 |
|---|---|---|---|
| resolution | [W, H] | 画幅（像素） | 换了分辨率不能还按旧画幅解释 |
| f_px | float | **焦距像素值（权威）** | 两仓库 sensor-fit 口径不同，只有 f_px 是无歧义的（§5.3） |
| near | float | 深度归一化的近端**度量深度**（米） | 没有它，归一化深度还原不出绝对尺度 |
| far | float | 深度归一化的远端**度量深度**（米） | 同上 |
| encoding | object | 通道语义 + 极性 + 编码约定 | 下游不能靠猜通道是什么 |
| up_axis | string | "Z" | 几何朝向判定的前提 |
| mask_semantics | object | 前景定义 / 前景值 / 背景值 / 抗锯齿 / 后处理 | 「前景」在六通道间必须同义 |

七字段清单由 `condition_contract.SIDECAR_REQUIRED_FIELDS` 定义，**扫描器与本文表格用同一份清单**。

### 4.2 完整 schema（每个 sidecar 都有）

~~~
kind              "condition_sidecar"
contract          "conditions_contract"
contract_version  "1.0.0"
channel           depth | normal | seg | mask | lineart | pose
resolution        [W, H]
f_px              float
near, far         float (米)
near_far_unit     "meter"
encoding          { channel, contract, contract_version, bit_depth, anti_aliasing,
                     semantics, formula, polarity, value_range, background,
                     normalization, metric, color_space, ...通道专有字段 }
up_axis           "Z"
up_axis_vector    [0, 0, 1]
handedness        "right"
units             "meter"
mask_semantics    { definition, source, foreground_value, background_value,
                     anti_aliasing, post_process, note }
principal_point   [W/2, H/2]
generator         "harness/conditions.py::save_condition_pack"
camera            { eye, target, up, fov_y, focal_mm, sensor_mm, f_px, near }
png               { primary, files[], bit_depth, sha256 }
scene             { source, objects, labels[], hidden_meshes[] }
pose_joints       { source, count, keypoint_set }     （仅 pose 通道相关）
frame             { note, near_far_m }
~~~

* encoding 的**字段结构六个通道统一**（值随通道变），机器校验时不用按通道写分支。
* png.sha256 是**产物指纹**：sidecar 和 PNG 一起交付，下游能验「图和 sidecar 是不是同一对」。

### 4.3 静态扫描

`condition_contract.scan_sidecar_dir(dir)` → 逐文件检查七字段是否齐全，输出汇总（n_files / n_ok / n_skipped / all_ok / 逐文件 missing）。
落盘读数见 `assets/validation/condition_pack.json` 的 sidecar_scan。

**R1 增补**：目录里可能还有**不是 sidecar** 的 JSON（例如 `cond_pose_keypoints.json`）。扫描器按
`kind` 字段自我声明的类型区分：非 `condition_sidecar` 的文件**跳过**并计入 `n_skipped`，既不判它
不合格，也不把它算成 sidecar（否则「七字段齐备率」会被不相干的文件稀释）。

---

## 5. 跨边界字段清单与归属表

### 5.1 冲突一：深度极性 —— 已裁定

| | 裁定 |
|---|---|
| 之前 | 本项目 近=0/远=1，resources3D 近=1/远=0 → **相反** |
| R0 之后 | 两边都是 **近=1/远=0** → 一致 |
| 以谁为准 | **本契约**。resources3D 的 `wmcore.depth_to_unit` 本来就是近=1/远=0，**不需要改它**，本项目改过来即可 |
| 遗留 | 本项目内所有历史深度产物（见 §7）口径作废，必须重生成 |

### 5.2 冲突二：上轴 —— 已裁定

| | 裁定 |
|---|---|
| 之前 | 两边各用各的（Z-up vs Y-up），没有写死的换算 |
| R0 之后 | 本项目规范 **Z-up**；resources3D 保持 Y-up；边界处用 R = (x, z, -y) 换算 |
| 以谁为准 | **本契约定义换算**；两仓库各自保留内部约定（不去改 resources3D） |

### 5.3 冲突三：sensor-fit / 焦距口径 —— 已裁定

| | 裁定 |
|---|---|
| 之前 | 本项目：垂直 FOV 驱动，f_px = H / (2·tan(fov_y/2))；resources3D：水平 sensor-fit，f_px = focal_mm / sensor_width_mm · W。同一个 (focal, sensor) 在非方形画幅下两边 f_px **不同** |
| R0 之后 | **以 f_px 为唯一权威**。本项目仍按垂直 FOV 算；跨到 resources3D 时用 focal_mm = f_px · sensor_width_mm / W 反推，保证 f_px 严格相等 |
| 以谁为准 | **sidecar 的 f_px**。focal_mm / sensor_mm 只作参考，不许下游自己重算 |
| 实测 | 512×512、f_px=512：两侧 computed_f_px 都是 **512.0**（严格相等） |

### 5.4 跨边界字段归属表

| 字段 | 谁定义 | 跨仓库时以谁为准 | 冲突? | 备注 |
|---|---|---|---|---|
| 单位（米） | 本契约 | 契约 | 否 | 两边一致 |
| 手系（右手） | 本契约 | 契约 | 否 | 两边一致 |
| up_axis | 本契约（Z） | 契约（Z），Y-up 只在边界换算 | **曾是冲突** | §3 |
| 深度极性 | 本契约（近=1 远=0） | 契约 | **曾是冲突** | §5.1 |
| 深度度量（沿光轴 z） | 本契约 | 契约 | 否 | 两边一致（透视校正插值） |
| 深度归一化区间 | 本契约（按帧前景 min/max） | 契约 | 否 | 靠 sidecar 的 near/far 传递 |
| f_px | 本契约 | **sidecar 的 f_px** | **曾是冲突** | §5.3 |
| focal_mm / sensor_mm | 各自仓库 | **sidecar 的 f_px 优先** | 口径不同 | 只作参考 |
| 主点 | 本契约（图像中心） | 契约 | 否 | 两边一致 |
| 近平面 | 各自相机（0.05 m） | 各自，但**须相等**才可比 | 否（本项目用 0.05） | 交叉比对两侧都是 0.05 |
| 前景定义（mask） | 本契约 | 契约 | 否 | 两侧都是「z-buffer 命中即前景」 |
| 深度背景值 | 本契约（0.0） | 契约 | 否 | 两侧都是 0 |
| 线稿算法 | 本契约（face_id_boundary_v1） | 契约 | 否 | 与 resources3D 逐行对齐 |
| 调色板 / seg 类别 | 本项目（SiMuseor 侧） | **本项目** | 否 | resources3D 不产 seg |
| 法线约定 | 本项目（世界空间 + 16bit 可逆） | **本项目** | 否 | resources3D 不产 normal |
| pose 关键点闭集 | 本项目（human_rig_21） | **本项目** | 否 | resources3D 不产 pose |
| 相机位姿 / 轨迹 | 本项目（shot spec） | 本项目 | 否 | resources3D 不共用镜头库 |

---

## 6. 验收方式与实测读数

ROADMAP §4 R0 的三条验收，逐条对应：

### 验收① 同一场景导出六通道 PNG + sidecar —— **达成**

* 脚本：`harness/condition_pack.py`
* 产物：`assets/conditions/r0_pack/`（12 个 PNG + 6 个 JSON sidecar）
* 场景：`generate_assets.generate_all()` 街景，22 个物体，512×512，相机 eye (4.6, −11.5, 1.35) → target (−1.2, 2.0, 1.10)
* 读数：`assets/validation/condition_pack.json`

### 验收② 静态扫描 sidecar 必含七字段 —— **达成**

* 扫描器：`condition_contract.scan_sidecar_dir()`
* 实测：**6 个 sidecar，7 字段全齐，all_ok = true**（n_files=6, n_ok=6）

### 验收③ 与 resources3D 同相机同场景交叉渲染比对 —— **达成**

* 脚本：`harness/cross_render_compare.py`
* 读数：`assets/validation/cross_render_compare.json`
* resources3D 目录**只读**：import 前设 `sys.dont_write_bytecode = True`，全程不在对方目录写任何文件。

**实测一致率**：

| 指标 | 数值 | 判据 |
|---|---|---|
| **depth 逐像素一致率（主指标，容差 1e-4 归一化）** | **100.00%** | ≥ 99% ✅ |
| depth 一致率 @ 容差 1e-5 | 100.00% | 参考 |
| depth 一致率 @ 容差 1e-6（最严档） | 97.74% | 参考 |
| mask 逐像素一致率 | **100.00%** | 前景集合完全相同（ours-only = 0，r3d-only = 0） |
| lineart 逐像素一致率 | 99.993% | 18 / 262144 px 差（float32/float64 边界舍入） |
| depth 最大绝对差（归一化） | 5.66e-6 | — |
| depth 最大绝对差（度量，米） | **0.209 mm** | — |
| depth 平均绝对差（度量，米） | 2.78 µm | — |

**容差为什么是 1e-4**：两侧光栅器精度不同——本项目 `conditions.py` 光栅化用 float32，resources3D `wmcore.rasterize` 用 float64，残差是**浮点舍入**不是语义差异。1e-4 归一化 = 该帧 37 m 量程的 3.7 mm，比交付产物自身的 8bit PNG 量化（1/255 ≈ 3.9e-3）细 25 倍。最严档 1e-6 也一并报出，不藏。

**比对怎么做的**（保证「同相机同场景」不是空话）：

1. 几何：街景 22 个物体合并成**单一** (V, F)（21 384 顶点 / 40 474 面），两侧用同一份；
2. 相机：用**同一个 f_px = 512.0** 定义，两边各自反推自己的口径（ours 垂直 FOV 53.130102°；r3d 水平 sensor-fit focal 36 / sensor 36），实测两侧 computed_f_px 都等于 512.0；
3. 坐标：ours 用 Z-up，r3d 用 Y-up，边界处 R = (x, z, −y) 换算；
4. 背面剔除：ours 关掉（cull_backfaces=False），对齐 r3d 的「不剔除」；
5. 极性：两边都是近=1/远=0，**比对前不需要任何翻转**。

---

## 7. 因本次裁定而失效并已刷新的既有读数

深度极性一改，**所有深度口径的读数全部作废**。以下逐条重生成并刷新：

| # | 产物 | 失效原因 | 处理 | 刷新后的读数 |
|---|---|---|---|---|
| 1 | `assets/validation/conditions_check.json` | depth.encoding / depth.background_value / 前景 min-max 口径全部反了 | **已重生成** | polarity: near_1_far_0；background_value: 0；前景 min 0 / max 1；near_far_m [2.6165, 40.165]；另补 contract / up_axis / units 字段 |
| 2 | `assets/previews/cond_depth.png` | 图像反相（近黑远白 → 近白远黑） | **已重生成** | 同上口径 |
| 3 | `assets/previews/cond_car_depth.png` | 同上 | **已重生成** | 同上口径 |
| 4 | `assets/previews/cond_pov_depth.png` | 同上 | **已重生成** | 同上口径 |
| 5 | `assets/validation/shot_spec.json` | conditions 列表由 3 通道扩到 6 通道 | **已重生成** | conditions: [depth, normal, seg, mask, lineart, pose]；validation.problems: [] |
| 6 | `harness/test_conditions.py::test_depth_monotonic_with_distance` | 断言写的是旧极性（近 < 远） | **已改并重跑** | 改为断言近 > 远；实测 near 0.997 / far 0.1202 |
| 7 | `harness/test_conditions.py::test_depth_range_and_background` | 背景值断言跟着变 | **已改并重跑** | 背景 0.0，16/16 全绿 |
| 8 | `assets/validation/condition_pack.json`（新增） | — | **新建** | 六通道齐备、sidecar 6/6 全齐 |
| 9 | `assets/validation/cross_render_compare.json`（新增） | — | **新建** | 一致率 100%（容差 1e-4） |

**顺带修好的（非极性导致）**：

* `conditions_check.json` 里 outputs 字段的路径分隔符此前是 Windows 反斜杠，重生成后变成正斜杠。
* 交叉渲染比对**抓出并修掉了一个真 bug**（见 §8）。
* **场景加载器改成真只读**：`conditions.py::_scene_from_generate_assets()` 的 docstring 一直写着「只读调用，不修改那个文件」，但它调的 `generate_all()` 恰恰会重写 assets/geometry/* 与 assets/nongeometry/*（同一份几何在不同 numpy/trimesh 版本下差最后一个 ulp：0.0 vs -0.0）。R0 改成直接调 `street_scene()`（`generate_all()` 的场景段本来就是它，generate_assets.py:925）——**拿到完全相同的场景，一个文件都不写**。实测：改前跑一次 pipeline 就有 11 个资产文件变成「修改」；改后跑完整条 pipeline 后 **0 个**，且 conditions_check.json 的 depth / foreground_px / hidden_test / seg / normal / semantic_map 六个段**逐字节相同**（只有墙钟耗时变）。

**没有改、但口径已陈旧的文档**（按 R0「不改既有文件」纪律，**只标注不修改**）：

| 文件 | 陈旧点 | 处理 |
|---|---|---|
| `plans/AUDIT-AB.md` §「cond_depth.png（8bit 灰度）：近 = 黑，远 = 白」 | 描述的是旧极性 | **保留原文**（审计记录是对当时状态的记录），以本文 §2.1 为准；该文 §「影响面」本身也正是本契约要解决的坑 |
| `plans/ROADMAP-IMAGE-VIDEO.md` §0.2 J2 / §4 R0 | 写的是「深度极性冲突待裁定」 | 保留（R0 执行前写的路线）；裁定结果以本文 §5.1 为准 |
| `plans/ONE-PAGE.md` 决策点 2 | 写的是「建议项」 | 保留（用户已拍板采用建议项，本文是落地） |

---

## 8. R0 过程中发现并修掉的缺陷（不是极性改动引起的）

**`harness/conditions.py::_raster_chunk` 的 z-buffer 会用更远的深度覆盖更近的深度。**

* 症状：同一个像素被多个表面命中时，旧代码按深度排序后用「相邻像素索引不同 = 新的一段」判定每个像素的首次出现——但**按深度排序后同一像素的多次出现并不相邻**（别的像素会插在中间），于是更远的深度被写回 z-buffer。
* 实测偏差：真实街景上最大 **8.08 m**。
* 触发场景：沿视线方向叠一排薄板（每片 0.2 m 厚、间距 0.6 m）——同一像素被多片的前后面命中，深度序列互相穿插。
* 修法：按深度升序排好后用 `np.unique(pix, return_index=True)` 取每个像素的**首次出现**（即最小深度）。
* 影响面：depth **和** normal / seg / lineart（它们都用 face_id 缓冲取面，被覆盖的面法线/类别就是错的）。
* 回归测试：`test_conditions.py::test_zbuffer_keeps_nearest_surface`（薄板阵列场景，旧代码误差 0.6 m → 判红；修好后误差 0.0 m）。
* 探针留证：已用**旧代码副本**跑同一场景，误差 0.600001 m，闸正确判红（证明这道闸不是空转）。

这个 bug 是交叉渲染比对抓到的——**没有比对就发现不了**，也说明「逐像素一致率」这道验收不是走过场。

---

## 9. R0 遗留 / 未决

1. **pose 是静止骨架，不是动作序列**。R0 落盘的 pose 用的是项目具名骨架的 rest pose 放在主角位置。要出真正的动作姿态，下一阶段得接 `pose_store.py` 的关节序列（shot001_hero.npz 等）。R0 的契约只钉住**格式**，不钉住姿态内容。
2. **pose 关键点集不是 COCO-17**。human_rig_21 是本项目自己的闭集。要喂给吃 COCO-17 的下游模型，需要一张映射表——属于 R1 的活。
3. **lineart 只有 1px 轮廓线**，不含材质线/折痕线；跨仓库算法已对齐，但「线够不够下游用」要到 R1 才知道。
4. **mask 没有软边**。要抗锯齿前景得另外出一版 mask（8bit 覆盖率），现在只有硬二值。
5. **sidecar 还没有指纹链**：单个 PNG 有 sha256，但整包（六个通道 + 六份 sidecar）还没有一个总指纹，也没接进 R3 要做的内容寻址台账。
6. **报告侧两条门禁在 R0 之后是红的，根因查清了，R0 不越界修**：

   （补充：`harness/test_repo_state.py` 的 `test_reports_known_real_problems` **在 R0 之前就是红的**，不是 R0 弄坏的。R0 前的基线证据：`git_tracking` 报的是「已跟踪文件 **300** 个」，而断言写的是「已跟踪文件 **0** 个」；且基线时 `retarget_bvh.json` / `public_decimated.json` 与 `report.html` **同 mtime**，`artifact_freshness` 当时判 PASS，断言却要求它 FAIL。R0 只把失败位置从断言①挪到了断言②——**红→红，没变绿，也没变红**。）

   * **report_coverage**（**R0 之前就红**）：report.html 里没有 11 个旧产物的标识（R0 加了 2 个新产物 → 13 个）。根因：`build_report.py` 只内嵌它显式引用的那几份 JSON，**压根没有读 conditions_check.json / shot_spec.json**，所以光重生成也覆盖不到。
   * **artifact_freshness**（**R0 之前是 PASS，现在红**）：这是「按要求重生成读数」的直接后果——4 份读数比 report.html 新。**这是真阳性，不是误报**：报告确实没覆盖这些读数。
   * 为什么 R0 不顺手重生成 report.html：**`build_report.py` 在 macOS 上跑不起来**——`assets/pipeline_data.json` 里存了 **95 处 Windows 反斜杠路径**（如 `assets\previews\soma_native.png`），`Image.open` 直接 FileNotFoundError（实测 rc=1）。修它要改 pipeline_data.json 这个既有跟踪产物，属于报告侧的事。
   * 建议（给报告侧那条线）：① 把 pipeline_data.json 的路径分隔符规范化成 POSIX；② 让 build_report.py 对 `assets/validation/` 做通用扫描，或至少覆盖 conditions_check / shot_spec / condition_pack / cross_render_compare；③ 之后再重生成 report.html 一次。
   * R0 的取舍：**不碰 pipeline_data.json、不碰 report.html、不改 build_report.py**，如实把两条门禁的当前状态报出来。
7. **交叉比对只比了 depth / mask / lineart 三个通道**。normal / seg / pose 在 resources3D 那边没有对应实现，比不了——不是漏做。
8. **深度归一化仍是按帧的**。跨帧的绝对深度比较还没做（需要每帧固定 near/far 的「深度尺度」定义），留给 R2 运镜体系化。

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0.0 | 2026-11-22 | R0 首版：六通道闭集定稿；深度极性裁定为**近=1 远=0**（背景 0.0）；up_axis 显式为 Z-up 并给出 Y-up 换算矩阵；sidecar 七字段定稿；跨边界字段归属表定稿；交叉渲染比对达成 100%（容差 1e-4）。 |
| 1.1.0 | 2026-11-22 | R1 增补：姿态关键点闭集扩成**源 + 视图**两层（SOMA 77 / rig21 源，human_rig_21 / coco18 / openpose25 视图），规范视图改为 `coco18`、`human_rig_21` 保留为并列视图（**并存不替换**，理由见 §2.7.2）；新增 §2.7 映射表与不可得清单；扫描器跳过非 sidecar 的 JSON（`n_skipped`）；pose 通道接真实关节序列（SOMA 77），静态角色源仍走项目 rig。 |

---

## 11. 关联文件

| 文件 | 作用 |
|---|---|
| `harness/condition_contract.py` | **契约的可执行副本**：常量、sidecar 写出器、静态扫描器、Z↔Y 换算、**关键点三视图闭集与角色映射表（R1）** |
| `harness/conditions.py` | 条件渲染器（六通道）+ save_condition_pack() |
| `harness/condition_pack.py` | R0 验收①：六通道 PNG + sidecar + 静态扫描 |
| `harness/cross_render_compare.py` | R0 验收③：与 resources3D 的交叉渲染比对 |
| `harness/pose_keypoints.py` | **R1 新增**：关节源装载 / 三视图投影 / 骨架绘制 / 关键点 JSON / 独立重投影 / 结构自检 |
| `shots/shot_001/conditions/` | **R1 新增**：120 帧 × 6 通道（每帧 6 份 sidecar + 关键点 JSON） |
| `harness/shot_spec.py` | SUPPORTED_CONDITIONS 取契约闭集（6 通道） |
| `assets/conditions/r0_pack/` | 六通道 PNG + 六份 sidecar |
| `assets/validation/condition_pack.json` | 验收①②读数 |
| `assets/validation/cross_render_compare.json` | 验收③读数 |

---

## 12. R1 增补：六通道落地与验收读数

> **所属**：R1 · 条件图六通道落地（含 pose 关键点）
> **对应 ROADMAP**：`plans/ROADMAP-IMAGE-VIDEO.md` §4「R1 · 条件图六通道落地（含 pose 关键点）」
> **契约版本**：1.1.0 · **运行环境**：纯 CPU，零模型权重，零 GPU

### 12.1 R1 做了什么（逐条对 ROADMAP 范围）

| ROADMAP 范围项 | 落地情况 | 落点 |
|---|---|---|
| ① mask（前景显式 PNG） | R0 已有，R1 复核：与 depth/normal/seg/lineart **共享同一次光栅化**的前景集合 | `harness/conditions.py`（`mask` 通道） |
| ② lineart（从 face_id 取轮廓，参考 resources3D `wmcore.line_art_from_face_id`） | R0 已有，R1 复核：算法 `face_id_boundary_v1` 与 resources3D 逐行对齐，交叉渲染实测一致率 **99.993%** | `harness/conditions.py::line_art_from_face_id` |
| ③ pose（SOMA 77 关节 → COCO-18 / OpenPose-25 关键点 JSON + PNG） | **R1 新做**：pose 接**真实关节序列**（SOMA 77 公共关节，不再是静态 rest pose），出 COCO-18（规范视图）与 OpenPose-25 两套 PNG，三视图完整坐标写进 `cond_pose_keypoints.json` | `harness/pose_keypoints.py`（新增）+ `harness/conditions.py` |
| ④ 每个 shot 目录出 `conditions/` 子目录 | **R1 新做**：`shots/shot_001/conditions/frame_XXXX/`，逐帧六通道 + 每通道 sidecar + 关键点 JSON；相机复用 `render_shot.cam_at`（与 `shots/shot_001/frames` 同一套机位） | `harness/conditions.py::run_shot_conditions` |
| ⑤ 条件图指标（按 resources3D `metrics_spec` 口径） | **R1 新做**：a 边缘 / b 结构 / c 构图 / d 机位 / e 综合五项，直接调用 resources3D 的 `eval/metrics.py`（只读引用，不在对方目录写任何文件） | `assets/validation/conditions_check.json` 的 `r1_shot_conditions.metrics_spec` |

### 12.2 验收读数（实测，不是推演）

| ROADMAP 验收项 | 实测 |
|---|---|
| ① 六通道齐备率 **100%** | demo 512×512：**100%**（六个通道全在）；shot_001 **120/120 帧六通道齐备 = 100%**；sidecar 静态扫描 **120/120 帧 all_ok = true**（每帧 7 个 JSON：6 份 sidecar + 1 份关键点 JSON 被扫描器跳过、计入 `n_skipped`） |
| ② 隐藏几何回归仍成立 | 四个口径与 R0 **逐位相同**：贴近车低机位 145017 → 120750（−16.73%）、街景主视角 235824 → 235090（−0.31%）、车载 POV 260284 → 253811（−2.49%）、只渲染车 4681 → **0**（−100%）。判定：仍成立 ✅ |
| ③ 单通道耗时与总耗时可对账，< 1500 ms | 512×512 demo：光栅化 **92.92 ms**（六通道共享）+ depth 0.38 / normal 6.54 / seg 8.63 / mask 0.28 / lineart 0.57 / pose 8.36 → 通道合计 **24.76 ms**，**总计 117.79 ms < 1500 ms** ✅。720×404 shot：光栅化中位 99.06 ms、通道 0.23–9.96 ms、**总计中位 124.05 ms**；整段 120 帧导出墙钟 **20.1 s**（含 PNG 与 sidecar 落盘）。逐次实跑有约 ±10% 波动，以 `conditions_check.json` 里的当次读数为准 |
| ④ 关键点图与 `pose_store.py` 关节序列数值一致（抽样 10 帧逐帧比对） | 交付集（`shot001_hero.npz`）：10 帧抽样 —— 3D 源值 vs npz 关节行最大差 **5.0e-07 m**、独立重投影 vs 落盘像素最大差 **6.7e-04 px**、PNG 圆心像素抽查 **0 处不符** → 全过。`pose_store` 读取路径（`shot003_pose.npz` 经 `load_pose_sequence`）：10 帧、每帧 7 项结构自检全过、2D 最大差 **6.6e-04 px** → 全过 |

**耗时分解（720×404，120 帧中位）**

| 通道 | 中位耗时 | 占比 |
|---|---|---|
| 光栅化（六通道共享） | 99.06 ms | — |
| depth | 0.41 ms | 0.3% |
| normal | 8.82 ms | 7.1% |
| seg | 9.96 ms | 8.0% |
| mask | 0.23 ms | 0.2% |
| lineart | 0.36 ms | 0.3% |
| pose | 3.92 ms | 3.2% |
| **总计** | **124.05 ms** | 100% |

### 12.3 条件图指标（resources3D `metrics_spec` 口径）

12 帧抽样，参考图 = `shots/shot_001/frames/frame_XXXX.jpg`（本机确定性渲染帧）。

| 指标 | 中位读数 | 怎么读 |
|---|---|---|
| a 边缘一致（带容差 IoU / Chamfer） | **0.4363** / 5.787 px | 线稿 vs 参考帧边缘；容差 2 px |
| b 结构一致（Spearman / 分层残差） | **−0.4109** / 0.0359 | 负号来自参考帧是平面着色（远处更亮）；限定到主体掩码时 Spearman = **+0.3422**（过「弱保留 ≥0.25」线） |
| c 构图一致（前景 IoU） | **0.0003**（主体口径 0.0） | 契约 mask 是「全部可见几何」、metrics 的前景估计是「主体」，语义不同；且估计器在整场景帧里选不出主角（`subject_recall_in_estimate = 0`，诊断见 `foreground_estimator_diag`） |
| d 机位一致（俯仰误差） | **0.118°** | 条件深度反解机位 vs 真值相机（Z-up → Y-up 边界换算后），判据 ≤2° 合格 ✅ |
| e 综合评分 | **35.77** | 四个分项等权；其中 camera≈92、edge≈44、structure≈0、composition≈0 |

> **诚实边界**：参考图是本机渲染帧，**不是下游模型输出**，所以这组读数量的是
> 「条件图与同源渲染的结构一致度」，**不是**「下游保留度」（下游 A/B 按 ROADMAP 明确不做）。
> `metrics_spec` 的阈值来自 resources3D 的**主体级合成自检**，对整场景帧不直接适用，
> 这里只报口径与读数，**不做达标判定**。

### 12.4 R1 产物清单

| 路径 | 内容 |
|---|---|
| `harness/pose_keypoints.py`（新增） | 关节源装载（SOMA 77 / rig21）、三视图投影、骨架绘制、关键点 JSON、**独立重投影**（验算用）、结构自检 |
| `harness/conditions.py`（增补） | pose 接 SOMA 源、六通道计时、shot 条件集出口、metrics_spec 指标、一致性自检、`--shot-conditions` CLI |
| `harness/condition_contract.py`（增补） | 三视图闭集 + 角色映射表 + 不可得清单；扫描器跳过非 sidecar 的 JSON |
| `shots/shot_001/conditions/` | 120 帧 × 6 通道，每帧 17 个文件（6 PNG + 3 张 normal 16bit + 2 张 pose PNG + 6 份 sidecar + 1 份关键点 JSON），共 **2040 个文件 / 29 MB** |
| `assets/validation/conditions_check.json` | 新增 `r1_six_channels`（齐备率 + 耗时分解）与 `r1_shot_conditions`（逐帧明细 + 一致性 + metrics） |
| `assets/conditions/r0_pack/` | 按契约 1.1.0 重生成（pose 侧多出 OpenPose-25 PNG 与关键点 JSON） |

### 12.5 R1 遗留与没做到的（说清楚，不藏）

1. **构图指标这条在本场景不成立**（不是条件图的锅）。resources3D 的前景估计器在整场景帧里
   选不出主角：估计前景 950 px / 0.33%，主角 4615 px / 1.59%，`subject_recall_in_estimate = 0`。
   这条指标要「背景干净的主体级渲染」才有意义；本阶段的读数已附诊断字段。
2. **structure_spearman 为负**（−0.41）是参考图口径导致的：previs 是平面着色，远处建筑/天空
   更亮、近处地面更暗，深度与灰阶本就负相关；限定到主体掩码是 **+0.34**。深度通道本身的正确性
   由 R0 的交叉渲染逐像素 100% 一致保证，不由这条指标保证。
3. **指标没有并进 `assets/validation/validation_report.json`**：那份文件由 `harness/run_pipeline.py`
   生成、语义是资产级验证（几何/场景/运动/相机…）。要塞条件图指标，要么改 `run_pipeline.py`
   （不在 R1 分工内），要么手改一个下次 pipeline 就会覆盖的生成物。R1 的取舍：指标落在
   `conditions_check.json`（`r1_shot_conditions.metrics_spec`）与逐帧明细里，**不越界改报告侧**；
   要并进去，需要报告侧那条线在 `run_pipeline.py` 里加一段读 `conditions_check.json`。
4. **lineart 本阶段没动**：R0 的实现已与 resources3D 逐行对齐（实测 99.993%），R1 只复核；
   「线够不够下游用」要等真下游才能判（ROADMAP 明确本阶段不做下游 A/B）。
5. **不做 shade 通道、不下载任何预训练检测器权重（HED/Midas/OpenPose）、不做下游图/视频 A/B、
   不引入 Blender 渲染运行时**：按 ROADMAP R1「明确不做」执行。全程零安装、零 GPU、纯 CPU。
6. **`pose_store.py` / `render_shot.py` 里 70/75 的踝↔趾根偏移没改**（见 §2.7.4）：不在 R1 分工内，
   且不影响它们「脚锁式根位移」的结论；R1 只在自己这边把坑钉死并加结构自检。
7. **mask 仍无软边、lineart 仍只有 1px 轮廓线**（R0 遗留项，本次未动）。
8. **R0 §9.6 的两条报告侧门禁（report_coverage / artifact_freshness）本阶段未碰**：R1 新增了
   产物，报告侧那条线需要重新生成 report.html 才能覆盖到，属报告侧职责。

> **运行环境说明**：本阶段所有实跑都用 `/Users/moc/workspaces/SiMuseor/resources3D/venvs/df/bin/python`
> （本机唯一装了 trimesh 的解释器：Python 3.11.16 / numpy 1.26.4 / trimesh 5.2.1 / scipy 1.17.1），
> 纯 CPU；引用 resources3D 的 `eval/metrics.py` 时设 `sys.dont_write_bytecode = True`，
> **不在对方目录写任何文件**。
