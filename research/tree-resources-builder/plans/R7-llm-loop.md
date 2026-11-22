# R7 · 云端 LLM 接入（把「验证闭环」真实化）

> 对应 `plans/ROADMAP-IMAGE-VIDEO.md` §4 的「### R7 · 云端 LLM 接入（把「验证闭环」真实化）」，
> 同时结掉 `plans/PLAN.md` §6 第 3 条（V5）：**接入云端 LLM，统计首次执行成功率与 3 轮收敛率
> （此前是「参数级修复模拟」）**。
> 本文件只新增，不改 R0–R5 的任何脚本与产物。

---

## 0. 一句话结论

云端 LLM（MiniMax-M3.1-Flash，走 api.minimax.cn）现在**真的在出配方**：105 个任务里
**首过率 94.29%（99/105）、3 轮内收敛率 100%（105/105）**、平均 1.06 轮通过；
共 111 次云端调用、0 次失败、179,066 token、用时 95.5 秒。
判定权全部在机器：模型只负责写 JSON，**对不对由校验器说了算**，模型自评一律不算数。

---

## 1. 云端 LLM 在闭环里承担什么职责

只承担一件事：**把一份「任务规格」翻译成一份 JSON 配方**。别的都不归它。

### 1.1 输入（给模型的东西）

一次调用 = 一条 user 提示词（system 提示词固定），内容全部来自任务库：

| 块 | 内容 |
|---|---|
| 任务头 | 任务 id、类别、用途档位、面数预算、资产命名规则、语义类别要求 |
| 参数表 | 每个字段的名字 / 类型 / 允许区间（或枚举）/ 含义 |
| 结构关系 | 参数之间必须成立的关系（例如「轴距 ≤ 0.40×车长」「冠幅 ≤ 0.70×树高」） |
| 输出格式 | 一份 JSON 骨架（示范结构，**里面的数值是上一族的基准值，不是答案**） |
| 修复轮追加 | 上一轮模型自己写的配方 + 上一轮的错误清单（结构化 hint） |

### 1.2 输出（模型必须给的东西）

一份 `r7-recipe/1` 的 JSON 配方，顶层字段固定 9 个：
`kind / schema / task_id / asset_name / usage_level / category / params / license / notes`。

`params` 按类别不同（五类资产各一套字段声明，**新增字段必须同时在 `r7_contract.py`
的 `CATEGORY_PARAMS` 里声明**，否则形状校验直接判红）：

| 类别 | params 字段 |
|---|---|
| 道具 prop | `scale_factor`、`target_max_dim_m` |
| 植被 tree | `height`、`trunk_r`、`canopy_r`、`canopy_h`、`shape`、`branches`、`levels`、`seed`、`lod{segments,levels,canopy_blobs,canopy_subdiv,branch_ratio}` |
| 载具 vehicle | `length`、`width`、`clearance`、`roof[12]`、`cabin[2]`、`cabin_h`、`wheel_r`、`wheelbase[2]`、`track` |
| 场景 scene | `floors`、`width`、`depth`、`building_count`、`tree_count`、`prop_count`、`vehicle_count`、`char_count`、`seed` |
| 人物 character | `height`、`torso`、`shoulder`、`hip`、`limb`、`head`、`variant` |

### 1.3 模型给完以后发生什么（本机，全 CPU）

```
模型 JSON  →  r7_execute.py 确定性执行  →  r7_judge.py 机器判定  →  hint  →  下一轮提示词
             （配方变几何）               （形状/关系/几何/结构四层）
```

- **执行**：几何一律走仓库既有的确定性生成器（R4 的植被/载具/人物生成器 + R4 的街区块装配）；
  道具走 R4 已落盘的 Kenney/Poly Haven 源件，配方给的是「缩放系数 + 目标最大边长」，
  执行 = 等比缩放既有源件。同一份配方跑两遍哈希必须一样。
- **判定**：四层机器检查，见 §2。
- **修复**：失败项压成 `{code, message, hint}` 三元组进下一轮提示词，**hint 链全程落盘**。

---

## 2. 机器可判定的校验口径（验收口径）

判定分四层，**全部机器判**，模型说「我改好了」不算通过（ROADMAP R7「明确不做」第 3 条）。

### ① 形状层（`r7_contract.check_shape`）

| 检查码 | 判什么 |
|---|---|
| `RECIPE_JSON` | 输出能解析成 JSON 对象 |
| `RECIPE_SCHEMA` | `kind=r7_recipe`、`schema=r7-recipe/1` |
| `RECIPE_FIELDS` | 顶层字段不多不少；`params` 字段不多不少 |
| `RECIPE_TYPES` | 每个字段类型对不对（含 `lod` 子字段齐全） |
| `RECIPE_TASK` / `RECIPE_CATEGORY` / `RECIPE_TIER` | task_id、类别、档位与任务一致 |
| `NAME_CONVENTION` | 资产名匹配 `<类别词>_<名字>_<变体>`（沿用 R4 的词表与正则） |
| `CATEGORY_SEMANTIC` | 名字解析出的语义类别与台账一致（走 `conditions.resolve_category`） |
| `PARAM_RANGE` | 每个参数落在任务给的区间/枚举内（含数组逐元素区间） |
| `LICENSE_PRESENT` | 许可段有 SPDX + 署名文本 |

### ② 关系层（参数之间必须成立，`r7_judge._check_relations`）

| 检查码 | 判什么 |
|---|---|
| `REL_PROP_SCALE` | `scale_factor` = 目标最大边长 ÷ 源件当前最大边长（相对误差 ≤ 2%） |
| `REL_TREE_CANOPY_RATIO` / `REL_TREE_CANOPY_H` / `REL_TREE_TRUNK` | 冠幅 ≤ 0.70×树高、冠厚 ≤ 0.65×树高、主干半径 2%–10% 树高 |
| `REL_TREE_LOD` | LOD 段数 ≥ 4、层数 1–3 |
| `REL_VEHICLE_WHEELBASE` / `REL_VEHICLE_CABIN` / `REL_VEHICLE_ROOF` / `REL_VEHICLE_TRACK` / `REL_VEHICLE_WIDTH` / `REL_VEHICLE_WHEEL` | 轴距 ≤ 0.40×车长、座舱落在站位 1.5–9.5、车顶最低点 ≥ 离地间隙、轮距与车宽相称、整车宽 ≤ 1.12×车宽、车轮半径与车长相称 |
| `REL_SCENE_FIT` / `REL_SCENE_COUNTS` / `REL_SCENE_FLOORS` | 每排楼体排得进 64 m 街区块、混排件数 ≤ 40、层数 2–20 |
| `REL_CHAR_SCALE` / `REL_CHAR_LIMB` | 体格系数偏离基准在容差内、肢体粗细与身长相称 |

### ③ 几何层（直接调用既有 `harness/validate.py`，不另立标准）

`MESH_WATERTIGHT`（各部件水密）、`MESH_VOLUME`（体积显著大于包围盒 0.01%，尺度无关判据）、
`DEGENERATE_FACES`（退化面 0）、`SCALE_X/Y/Z`（包围盒落在期望区间）、
`COMPONENT_LIMIT`（部件数上限：道具 16 / 树 120 / 车 32 / 人 40）、
`FLOATING_PART`（装配体最大部件间隙 ≤ 0.06 m）、`GROUND_CONTACT`（最低点贴地 ≤ 0.05 m）。

> 装配级间隙为什么只判「核心部件」：R4 的口径是逐节点判，装配体层面没人判；
> R7 判装配体，但树的冠层、人的服装壳是**有意**挂在主体外的代理件（棕榈叶本来就悬在
> 树冠顶端、立领本来就比下巴高），所以它们各有专门判据（`REL_TREE_CANOPY_BASE`、
> `CLOTH_FIT`），不放进间隙判据里。

### ④ 结构层（`r7_judge._check_structure`）

| 检查码 | 判什么 |
|---|---|
| `TOPOLOGY_HASH` | 车身顶点拓扑哈希与 R4 台账一致（12 站位 × 24 截面：参数只改坐标不改拓扑） |
| `TARGET_DIM` | 道具缩放后实测最大边长 = 目标值（±3%） |
| `REL_TREE_CANOPY_BASE` | 冠层底面 ≥ 0.18×树高（冠层不压树基） |
| `SCENE_GROUND_ZERO` / `SCENE_NO_INTERPENETRATION` / `SCENE_INSTANCE_COUNT` | 地面层顶面统一 z=0、地上件无穿插、摆件数达标 |
| `CLOTH_FIT` | 服装壳 Z 覆盖率 > 85% 且中心水平偏移 < 0.05 m（口径与 R4 的 CLOTH_FIT 一致） |
| `FACE_BUDGET` | 总面数 ≤ 档位预算（low ≤ 500 / mid ≤ 5000 / hero ≤ 50000；场景档 150,000） |
| `EXECUTE_ERROR` | 配方喂不进确定性执行器（这条会带着异常信息进 hint） |

---

## 3. 实际调用记录（模型名 / 次数 / token / 可复现性）

| 项 | 实测值 |
|---|---|
| 模型 | `MiniMax-M3.1-Flash` |
| provider | `minimax-direct`（本机 `~/.minimax/config.yaml` 的 `custom_provider` 段） |
| 端点 / 协议 | `https://api.minimax.cn/v1` · OpenAI `chat/completions`（云端 API） |
| 调用次数 | **111**（105 次首轮 + 6 次修复轮），HTTP 200 × 111，**失败 0** |
| token 用量 | prompt **112,452** + completion **66,614** = **179,066** |
| 单次延迟 | 最短 1.1 s · 中位 2.8 s · p90 6.6 s · 最长 40.8 s |
| 整批用时 | 95.5 s（6 并发） |
| 凭据来源 | 只从 provider 配置读进内存；**不打印、不写仓库、不进任何读数文件**（用配置里的真实 apiKey/accessToken 全文扫过 5 个读数文件与 7 个脚本：0 命中；唯一命中是客户端里用来识别占位符的字面量 sk-xxx，它不是凭据） |

**可复现性怎么理解**：

- **判定可复现**：配方、每一轮的检查结果、hint 链都落盘（`r7_llm_loop.json`），
  拿这些记录可以离线重放判定，不依赖再调一次 API。
- **模型输出不逐字可复现**：云端模型带随机性，同一提示词再跑一次数值可能不同，
  所以首过率是**统计量**，不是常数。要复现这一轮的**数字**请重跑下面的命令，
  要复现**判定**请直接用落盘记录。

**复现命令**（本机没有系统级 trimesh，用 uv 起同样的代码路径）：

```bash
cd research/tree-resources-builder

# ① 判据自检（不调云端）：用 R4 台账中心值当参考配方，跑执行器+判定器
uv run --with trimesh --with scipy --with pillow --with pyyaml --with httpx \
  python harness/r7_loop.py --selftest

# ② 真实闭环（105 个任务 × 最多 3 轮）
uv run --with trimesh --with scipy --with pillow --with pyyaml --with httpx \
  python harness/r7_loop.py --workers 6 --model minimax-direct/MiniMax-M3.1-Flash

# ③ 只重算统计（不重新调云端）
uv run python harness/r7_report.py
```

---

## 4. 统计结果（PLAN.md §6 的 V5）

**总体：样本 105，LLM 调用失败 0**

| 指标 | 值 |
|---|---|
| 首过率（第 1 次执行就通过机器判定） | **94.29%**（99/105） |
| 3 轮内收敛率 | **100%**（105/105） |
| 平均通过轮数 | 1.057 |
| 收敛曲线 | 第 1 轮 94.29% → 第 2 轮 100% → 第 3 轮 100% |

**按类别分档**（每档样本 ≥ 20）：

| 类别 | 样本 | 首过率 | 3 轮内收敛率 | 平均轮数 |
|---|---|---|---|---|
| 道具 prop | 20 | 100.0% | 100.0% | 1.00 |
| 植被 tree | 24 | 83.3% | 100.0% | 1.17 |
| 载具 vehicle | 20 | 100.0% | 100.0% | 1.00 |
| 场景 scene | 21 | 100.0% | 100.0% | 1.00 |
| 人物 character | 20 | 90.0% | 100.0% | 1.10 |

**按用途档位分档**（每档样本 ≥ 20）：

| 档位 | 样本 | 首过率 | 3 轮内收敛率 | 平均轮数 |
|---|---|---|---|---|
| low | 21 | 85.7% | 100.0% | 1.14 |
| mid | 45 | 97.8% | 100.0% | 1.02 |
| hero | 39 | 94.9% | 100.0% | 1.05 |

**首轮失败码分布**（6 个首轮失败）：`PARAM_RANGE` 4、`RECIPE_TYPES` 2、
`REL_TREE_CANOPY_BASE` 1、`FACE_BUDGET` 1。
即：6 次首轮失败**全部**来自「规格/关系/预算」类判断，没有一次来自「几何跑不起来」。

> 这些数字是**对 R7 这份契约**的首过率，不是「对真实美术需求」的首过率：
> 任务规格是我从 R4 台账派生出来的（见 §7 遗留第 1 条）。

---

## 5. 失败案例与 hint 链（真实记录，不是编的）

首轮失败 → hint → 修复，三个真实例子（均在 `r7_llm_loop.json` 里可查）：

**例 1 · `r7-tree-oak_broad-low-i02`（枚举取错）**

```
round 0  RECIPE_TYPES | 类型不符：shape(取值须在 ['round'])
         PARAM_RANGE  | 区间违规：shape='wide' 不在 ['round']
         hint: 每个参数都必须落在任务给定的区间/枚举内
round 1  ✅ 通过（shape 改回 'round'，其余参数保持稳定）
```

**例 2 · `r7-tree-maple_wide-low-i02`（结构关系不成立）**

```
round 0  REL_TREE_CANOPY_BASE | 冠层底面 z=0.932 m（要求 ≥ 0.18×height=1.044）
         hint: 冠层不能压到树基：抬高树高或收小冠幅
round 1  ✅ 通过（树高从 5.4 提到 6.16，冠层随之抬高）
```

**例 3 · `r7-tree-dead_bare-low-i02`（面数超预算）**

```
round 0  FACE_BUDGET | 总面数 640，预算 500（low 档）
         hint: 面数预算：low≤500 / mid≤5000 / hero≤50000
round 1  ✅ 通过（LOD 降档：canopy_blobs 7→1、branch_ratio 0.45→0.30）
```

**hint 链是完整的**：每个任务在 `r7_llm_loop.json` 里都带 `rounds[].hint`（本轮失败项）
与 `hint_chain`（跨轮累计），成功任务的 hint 链也保留，不只留失败的。

---

## 6. 凭据与纪律边界（PLAN.md C1–C5）

| 纪律 | 本轮怎么守的 |
|---|---|
| LLM 只走云端 API | 只调 `https://api.minimax.cn/v1`（OpenAI 协议）。本机不做推理、不加载模型、不下权重 |
| 不用生成式 3D 模型 | 几何全部来自仓库既有确定性生成器 + R4 已落盘源件；无扩散/SDS/原生 3D 生成器 |
| 纯 CPU | 只用 numpy/trimesh/scipy/PIL/httpx/yaml；无 torch、无 Blender 渲染运行时 |
| 不做下游图/视频 A/B | 没做（本轮只做 CPU 侧闭环与统计） |
| 密钥不落盘 | 凭据只在内存里；落盘前还有一道 redact()；用真实凭据全文扫过 5 个读数文件 + 7 个脚本，0 命中 |
| 只动自己的文件 | 新增 `harness/r7_*.py`（7 个）、`assets/validation/r7_*.json`（5 个）、`plans/R7-llm-loop.md`；R0–R5 脚本与产物、`boards/shot_board.html` 一律未改 |
| 不提交不推送 | 未 commit、未 push、未建 PR、未切分支 |

---

## 7. 遗留与没做到的（明确说清）

1. **任务规格是我派生的，不是业务方签发的需求**。区间与关系由我从 R4 台账（55 件资产的
   真实配方）按固定倍率档位派生。所以本文的首过率衡量的是「模型能否满足 R7 这份契约」，
   不能直接当成「模型能否满足真实美术需求」。
2. **只跑了一个模型、一个 provider**。本机可用的云端配置里 `minimax-direct` 只挂了
   MiniMax-M3.1-Flash；MCode 自带的 `provider.minimax` 段 apiKey 是占位符（`sk-xxx`），
   走 Mavis 网关的直连脚本调用返回 401（网关要登录态 token），所以没做多模型/多 provider 对比。
3. **判据里有一部分是 R7 新定的口径**，不是 R4 现成的：场景类的 `SCENE_INSTANCE_COUNT`、
   `REL_SCENE_FIT`，人物装配体间隙（只判核心部件），载具整车宽上限（1.12×width，
   与 `REL_VEHICLE_TRACK` 对齐后才不打架）。这些口径本阶段只对 R4 参考配方做过自检
   （105/105 通过），还没有独立交叉验证。
4. **场景类的任务信息量偏低**：摆件数量（树/公共件/车/人）在规格里是常量，模型基本只决定
   层数与面宽，所以场景的首过率 100% 不太说明问题。
5. **没有做「模型自评 vs 机器判定」的对照实验**：ROADMAP 明确不做下游 A/B，本轮也没顺手做
   这个对照，所以「模型自评会高估多少」没有数字。
6. **hint 质量只在小样本上验证过**：首轮失败只有 6 个，其中出现过一次「尺度超差但 hint 没说
   该动哪个参数」的无效提示（已改成可执行提示并重跑整批），样本太小，不足以说 hint 质量
   已经稳定。
7. **失败案例只保留在本轮读数里**，没有做跨批次的错误类型趋势分析。
8. **任务库与判定口径没有纳入 `check_repo_state.py` 门禁**：R7 的脚本目前不在既有门禁的
   import 扫描表里，换机器复现时不会被自动检查。

---

## 8. 文件清单

| 文件 | 是什么 |
|---|---|
| `harness/r7_llm_client.py` | 云端 LLM 客户端：读 provider 配置、拼协议请求、记非敏感调用账；凭据只在内存 |
| `harness/r7_contract.py` | 配方契约：`r7-recipe/1` 字段声明、形状/类型/区间校验、提示词与 hint 构造 |
| `harness/r7_tasks.py` | 任务库：从 R4 台账派生 105 个任务（区间、关系、来源、参考配方） |
| `harness/r7_execute.py` | 确定性执行器：配方 → 几何（复用 R4 生成器；同配方两遍哈希一致） |
| `harness/r7_judge.py` | 机器判定：形状/关系/几何/结构四层检查与可执行 hint |
| `harness/r7_loop.py` | 闭环驱动：出配方 → 执行 → 判定 → hint → 修复；写任务库/闭环记录/调用账 |
| `harness/r7_report.py` | 统计：首过率、3 轮内收敛率、分档样本数核对 |
| `assets/validation/r7_llm_tasks.json` | 任务库读数（105 个任务的规格、关系、来源、参考配方） |
| `assets/validation/r7_llm_loop.json` | 逐任务闭环记录（配方、每轮检查、hint 链、调用信息） |
| `assets/validation/r7_llm_calls.json` | 云端调用账（模型、次数、token、耗时、HTTP 状态；无凭据） |
| `assets/validation/r7_llm_stats.json` | 统计读数（首过率、3 轮内收敛率、分档样本数） |
| `assets/validation/r7_llm_selftest.json` | 判据自检读数：参考配方 105/105 通过（证明判据可满足） |
| `plans/R7-llm-loop.md` | 本文件 |

