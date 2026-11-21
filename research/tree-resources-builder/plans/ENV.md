# 环境与复现说明（ENV）

> **面向对象**：下一个要接手这个调研目录的人。
> **事实来源**：2026-11-21 本机实测；本文的两张表由 `harness/check_repo_state.py` 机器校验，
> 改了本文就要跑一次门禁（见 §7），否则表和现实会悄悄分叉。
> **定位**：本文是 `plans/PLAN.md` 的环境附录，不替代它。

---

## 0. 一句话结论

这个项目**需要两个 Python 解释器，不是两个项目**：

| 角色 | 路径 | Python | 干什么 |
|---|---|---|---|
| 主环境 | `E:\Projects\model-downloader\.venv\Scripts\python.exe` | 3.13.14 | 几何生成 / 渲染 / 验证 / USD / 报告 —— **绝大多数脚本跑这里** |
| SOMA 环境 | `E:\Projects\model-downloader\var\soma-venv\Scripts\python.exe` | 3.11.15 | 只有 `torch` / `soma` / `scipy` 这一族 —— **人物相关脚本跑这里** |

两个环境的能力**不重叠**，且**没有任何一方是另一方的超集**（主环境没有 torch，SOMA 环境没有 manifold3d / fast_simplification / imageio_ffmpeg）。
拿错解释器的表现是直接 `ImportError`；更隐蔽的是**两个环境都能 import 的包**（`trimesh` / `pxr` / `numpy` / `PIL`）会让脚本「跑起来但行为不同」（见 §6.3）。

---

## 1. 能力矩阵

<!-- table:capabilities -->

| 模块（import 名） | `.venv` (3.13) | `soma-venv` (3.11) | 说明 |
|---|---|---|---|
| `numpy` | ✅ 2.5.4 | ✅ 2.4.6 | 版本不同但 API 兼容；跨环境比较数值时留意 |
| `trimesh` | ✅ 5.2.1 | ✅ 5.2.1 | 同版本；但 `split()` / `body_count()` 在无 scipy 时不可用（§6.3） |
| `manifold3d` | ✅ 3.5.5 | ❌ | trimesh 的布尔运算后端；只在主环境 |
| `pxr` | ✅ 26.11 | ✅ 26.11 | pip 包名 `usd-core`；**两个环境都有**（`soma-venv` 实测可 `from pxr import Usd, UsdSkel`） |
| `fast_simplification` | ✅ 0.2.0 | ❌ | 减面（`decimate_public.py` / `vehicle_parts.py`） |
| `imageio_ffmpeg` | ✅ 0.8.1 | ❌ | MP4 编码（`render_shot.py`） |
| `PIL` | ✅ 13.0.0 | ✅ 13.0.0 | 预览图 / 报告内联 |
| `scipy` | ❌ | ✅ 1.17.1 | `Rotation` 旋转、`trimesh` 连通分量 |
| `torch` | ❌ | ✅ 2.15.0+cpu | CPU 版；`.venv` 里没有 |
| `soma` | ❌ | ✅ 0.3.6 | pip 包名 `py-soma-x`；SOMA-X 人体底座 |
| `networkx` | ✅ 3.7 | ✅ 3.6.1 | 图算法 |

<!-- /table:capabilities -->

> **与口头共识的差异（如实记录）**：此前认为「`soma-venv` 没有 `pxr`」。2026-11-21 实测
> `soma-venv` 里装了 `usd-core 26.11`，`from pxr import Usd, UsdGeom, UsdSkel, Gf, Sdf, Vt` 可用
> （`pxr.__file__` = `var/soma-venv/Lib/site-packages/pxr/__init__.py`）。
> 本文按**实测**写，`check_repo_state.py` 第 4 条会持续核对这一条，声明与现实不符即 FAIL。

---

## 2. 脚本 → 解释器对照表

> 判定规则（与 `check_repo_state.py` 第 3 条一致）：
> **需要 `torch` / `soma` / `scipy` → `soma-venv`；需要 `manifold3d` / `fast_simplification` /
> `imageio_ffmpeg` → `.venv`；两者都要 → 拆分。** 推断走 *import 闭包*：
> 一个脚本真实需要的包 = 它自己 import 的 + 它 import 的本地模块 import 的。

<!-- table:scripts -->

| 脚本 | 解释器 | 依据 |
|---|---|---|
| `geomlib.py` | `.venv` | numpy/trimesh/PIL；trimesh 布尔运算依赖 manifold3d（仅 `.venv` 有） |
| `generate_assets.py` | `.venv` | trimesh + manifold3d + geomlib |
| `validate.py` | `.venv` | trimesh；⚠ `.venv` 无 scipy 时部件数检查会退化（§6.3） |
| `previews.py` | `.venv` | trimesh + geomlib + validate |
| `export_usd.py` | `.venv` | pxr；**库模块，无 `__main__`**，只能被 `run_pipeline.py` 调用 |
| `run_pipeline.py` | `.venv` | generate_assets + validate + previews + export_usd 全栈 |
| `conditions.py` | `.venv` | trimesh + geomlib + generate_assets |
| `vehicle_parts.py` | `.venv` | trimesh + fast_simplification（仅 `.venv` 有） |
| `vehicle_dynamics.py` | `.venv` | 只用 numpy（两环境皆可，约定 `.venv`） |
| `shot_spec.py` | `.venv` | numpy + vehicle_dynamics |
| `fetch_public_assets.py` | `.venv` | trimesh + urllib（走代理下载） |
| `preview_public.py` | `.venv` | trimesh + geomlib + previews |
| `decimate_public.py` | `.venv` | fast_simplification（仅 `.venv` 有） |
| `fetch_source_previews.py` | `.venv` | PIL + urllib（走代理下载） |
| `render_soma.py` | `.venv` | trimesh + geomlib + previews |
| `build_report.py` | `.venv` | PIL（内联 base64 图） |
| `verify_report.py` | `.venv` | 纯标准库 + subprocess；⚠ **会就地改写 `report.html`**（§6.5） |
| `verify_exports.py` | `.venv` | trimesh + pxr + validate |
| `check_repo_state.py` | `.venv` | 纯标准库（两环境皆可；门禁本身不该挑环境） |
| `pose_store.py` | `soma-venv` | 延迟 `import torch` / `import soma` |
| `make_shot_soma.py` | `soma-venv` | torch + scipy + soma + pose_store |
| `retarget_bvh_to_soma.py` | `soma-venv` | torch + scipy + soma；只从 `validate` 取 `parse_bvh`（纯文本解析，不碰 scipy 依赖） |
| `soma_cpu_test.py` | `soma-venv` | torch + soma |
| `soma_anny_adult.py` | `soma-venv` | torch + soma |
| `test_pose_store.py` | `soma-venv` | torch + soma；渲染半段由它自己起 `.venv` 子进程 |
| `render_shot.py` | 拆分：soma-venv → .venv | 自身需 imageio_ffmpeg（仅 `.venv`），经 pose_store 需 torch/soma（仅 `soma-venv`） |
| `rescore_shot.py` | 拆分：soma-venv → .venv | `import render_shot`，继承同一约束 |
| `test_shot_spec.py` | `.venv` | numpy + shot_spec + vehicle_dynamics |
| `test_conditions.py` | `.venv` | numpy + conditions |
| `test_vehicle_parts.py` | `.venv` | fast_simplification（仅 `.venv` 有） |
| `test_repo_state.py` | `.venv` | 纯标准库 + tempfile（两环境皆可；门禁自检不该挑环境） |

<!-- /table:scripts -->

共 **31** 个脚本（`harness/*.py`，含测试）。门禁要求本表 ≥ 20 条且与实际 import 扫描逐项一致。

### 2.1 两个「拆分」脚本的文件边界

`render_shot.py` / `rescore_shot.py` 之所以必须拆，不是设计洁癖，而是**两个环境各缺对方的关键包**：

```
┌ soma-venv (3.11) ─────────────┐        ┌ .venv (3.13) ───────────────┐
│ make_shot_soma.py              │        │ render_shot.py               │
│   torch + soma + scipy         │        │   imageio_ffmpeg（MP4 编码） │
│   ↓ 写                        │        │   trimesh（软光栅）          │
│ assets/nongeometry/shotXXX_pose.npz │   │   ↓ 调 pose_store.ensure_rebuilt │
│   （N×77×3 关节轴角，108 KB）  │──────→ │      └─ 起 soma-venv 子进程 ──┘
│   ↓ 或                        │        │   ↓ 读                   │
│ pose_store.py --rebuild        │←───────│ var/pose_cache/*_verts.npz  │
└───────────────────────────────┘        └────────────────────────────┘
```

**边界就是文件**：`pose.npz`（关节角）跨界过去，顶点 `npz` 跨界回来。
`pose_store.ensure_rebuilt()` 会自动判断当前解释器有没有 torch：有就本地重建，没有就 `subprocess` 起
`var/soma-venv/Scripts/python.exe`，所以**同一个渲染脚本在哪个解释器里都能跑**。

显式跨环境时也可以手动指定：

```powershell
& $MAIN research\tree-resources-builder\harness\render_shot.py --source pose `
    --seq research\tree-resources-builder\assets\nongeometry\shot003_pose.npz `
    --soma-python "E:\Projects\model-downloader\var\soma-venv\Scripts\python.exe"
```

---

## 3. 跨环境为什么可接受：文件边界汇合，不是进程内集成

这套 harness 的设计意图是 **D2 决策的「统一汇合层用 GLB + USDA + JSON + BVH，不用某个 DCC 作为运行时」**
在 Python 层面的落地。两个解释器不共享内存、不共享 `sys.modules`、不共享 site-packages，
**只共享磁盘上的文件契约**：

| 边界文件 | 生产者 | 消费者 | 契约 |
|---|---|---|---|
| `assets/nongeometry/shot*_pose.npz` | `soma-venv` | `.venv` | pose = `(N,77,3)` float32 关节轴角 + `(N,77,3)` 关节世界坐标 + `faces` + `root_y` + `meta` |
| `var/pose_cache/*_verts.npz` | `soma-venv` | `.venv` | 重建出的 `(N,V,3)` 顶点 + joints |
| `assets/geometry/*.glb` | `.venv` | `.venv` / 下游 DCC | 米制、Z-up |
| `assets/geometry/scene_street.usda` | `.venv` | 下游 DCC | 相机时序 + UsdSkel + 体积代理 |
| `assets/validation/*.json` | 两边都写 | `build_report.py` / 报告 | `{"kind": "<契约标识>", ...}` |
| `assets/nongeometry/motion_walk_2s.bvh` | 外部 | `soma-venv` | 标准 BVH（Y-up） |

**为什么这是可接受的**：

1. **汇合层是数据，不是进程。** 下游消费者（Blender / UE / Unity / 报告 / 门禁）只认文件，
   不关心文件是哪个解释器写的。这与 D2「不用某个 DCC 作为运行时」完全一致。
2. **pose 比顶点小 57 倍。** 120 帧 × 4505 顶点 = 6.19 MB 烘焙顶点 vs 120 帧 × 77 关节 = 108 KB pose，
   跨环境传的是小的那份。
3. **重建可无损验证。** `pose_store` 的重建路径与「同参数直接前向」逐点误差 < 1e-6 m
   （`test_pose_store.py` 实测），所以「换个解释器重建」不会让画面漂移。
   代价是**必须逐帧前向**（batch=1）：批量前向与逐帧前向浮点上不等价（实测差 ~3e-5 m，
   来自稀疏蒙皮求和顺序），这个约束写在 `pose_store.py` 的 docstring 里。
4. **进程内整合的收益不抵成本。** 把 torch 装进 `.venv` 会引入 ~2 GB 依赖，
   而 USD/减面/MP4 编码在 `soma-venv` 里又没有；拆开的代价只是多写一个 `subprocess` 调用。

---

## 4. 从零复现

以下命令在 **PowerShell 5.1** 下可直接粘贴（注意：5.1 不支持 `&&`，换行即顺序执行）。

```powershell
cd E:\Projects\model-downloader
$MAIN = "E:\Projects\model-downloader\.venv\Scripts\python.exe"
$SOMA = "E:\Projects\model-downloader\var\soma-venv\Scripts\python.exe"
$HARN = "research\tree-resources-builder\harness"
```

### 4.1 环境探测

```powershell
& $MAIN -c "import sys; print(sys.version)"
& $SOMA -c "import sys; print(sys.version)"
```
预期：`3.13.x` / `3.11.x`。版本不符就重建（§4.2）。

### 4.2 装包

```powershell
# 主环境（几何 / 渲染 / USD / 报告）
& $MAIN -m pip install -i https://pypi.org/simple numpy trimesh manifold3d usd-core fast-simplification imageio-ffmpeg Pillow networkx

# SOMA 环境
uv venv --python 3.11 var\soma-venv
& var\soma-venv\Scripts\python.exe -m pip install -i https://pypi.org/simple numpy trimesh Pillow scipy py-soma-x usd-core
& var\soma-venv\Scripts\python.exe -m pip install -i https://pypi.org/simple torch --extra-index-url https://download.pytorch.org/whl/cpu
```
预期：两个解释器都能 import 各自的关键包；`torch.__version__` 应带 `+cpu` 后缀。

### 4.3 下载资产

```powershell
# SOMA-X 权重 → var/soma-assets（gitignored；SOMA 81 MB + ANNY 3.6 MB + MHR lod6 4 MB）
#   文件来源与许可见 research/somax.md；离线机房直接镜像 var/soma-assets 即可

# 公共资产（9 项 → var/public-assets，gitignored）
& $MAIN $HARN\fetch_public_assets.py
# 来源站官方预览图
& $MAIN $HARN\fetch_source_previews.py
```
预期产物：`var\public-assets\`、`assets\previews\src_*.jpg`(6)、
`assets\validation\public_assets.json`、`assets\validation\source_previews.json`。

### 4.4 生成（几何 + 验证 + 预览 + USD + 清单）

```powershell
& $MAIN $HARN\run_pipeline.py
```
预期产物：`assets\geometry\*.glb/.obj/.stl`（23 个）、`assets\geometry\scene_street.usda`、
`assets\nongeometry\*.json/.bvh`、`assets\previews\*.png`、
`assets\validation\validation_report.json`、`assets\validation\iteration_log.json`、
`assets\manifest.json`、`assets\pipeline_data.json`。

> ⚠ `run_pipeline.py` **没有 argparse**，`--help` 会被当成正常运行并覆写全部共享产物（§6.6）。

### 4.5 验证 / 导出回读

```powershell
& $MAIN $HARN\verify_exports.py
```
预期产物：`assets\validation\exports.json`（回读 GLB / OBJ / STL / USDA / BVH）。

### 4.6 预览

```powershell
& $MAIN $HARN\preview_public.py      # → assets\previews\public_*.png
& $MAIN $HARN\render_soma.py         # → assets\previews\soma_*.png + soma_previews.json
& $MAIN $HARN\conditions.py --demo   # → depth/normal/seg 通道 PNG + 验证 JSON
```

### 4.7 USD

```powershell
# export_usd.py 是库模块，只能随 run_pipeline.py 一起跑（§2 表内已标注）
& $MAIN $HARN\run_pipeline.py
```
预期产物：`assets\geometry\scene_street.usda`（相机 87 关键帧、UsdSkel 22 关节）。

### 4.8 报告

```powershell
& $MAIN $HARN\build_report.py        # → report.html（约 2.4 MB，全内联）
& $MAIN $HARN\verify_report.py       # → assets\validation\report_check.json（⚠ 会改写 report.html）
```
> `build_report.py` **硬编码**了它要加载的 JSON 清单，新产物不会自动进报告（§6.7）。

### 4.9 竖切片（5 秒，120 帧 @ 24fps）

```powershell
# ① SOMA 姿态空间生成 → pose 序列（soma-venv）
& $SOMA $HARN\make_shot_soma.py --store pose --name shot003

# ② 渲染（.venv；内部自动起 soma-venv 子进程重建顶点）
& $MAIN $HARN\render_shot.py --source pose `
    --seq research\tree-resources-builder\assets\nongeometry\shot003_pose.npz `
    --shot shot_001

# ③ 重算脚滑 / 构图指标（.venv）
& $MAIN $HARN\rescore_shot.py --source pose `
    --seq research\tree-resources-builder\assets\nongeometry\shot003_pose.npz `
    --shot shot_001
```
预期产物：`shots\shot_001\frames\frame_*.jpg`、`shots\shot_001\previs.mp4`、
`shots\shot_001\contact_sheet.jpg`、`assets\validation\shot_001.json`。

### 4.10 门禁自检（收尾必跑）

```powershell
& $MAIN $HARN\check_repo_state.py            # 全量结果，退出码 0
& $MAIN $HARN\check_repo_state.py --strict   # 有 FAIL 时退出码 2
& $MAIN $HARN\check_repo_state.py --json     # 机器可读
```

---

## 5. 提交入库：哪些该进、哪些该忽略

`research/` 整个目录目前 **0 文件入库**（`git ls-files research/` 为空），38 MB 成果只存在于本地工作区。
`var/` 被 `.gitignore` 忽略是对的（模型权重 + 原始下载包）。

**该入库**（复现依据，体积小）：

- `research/tree-resources-builder/harness/*.py`（源码）
- `research/tree-resources-builder/plans/*.md`（本文与 PLAN.md）
- `research/tree-resources-builder/research/*.md`（调研笔记）
- `research/tree-resources-builder/assets/validation/*.json`（验证结论）
- `research/tree-resources-builder/assets/nongeometry/*.json`（语义契约）

**该忽略**（体积大且可重建）：

- `research/tree-resources-builder/shots/*/frames/`（帧序列）
- `research/tree-resources-builder/report.html`（2.4 MB，且 `build_report.py` 可重建）
- `research/tree-resources-builder/harness/_tmp_cam/`（渲染中间图）
- `research/tree-resources-builder/harness/__pycache__/`
- `var/`（SOMA 权重 + 原始下载包，**已被仓库根 `.gitignore` 覆盖**）

建议追加到仓库根 `.gitignore`：

```gitignore
research/tree-resources-builder/shots/*/frames/
research/tree-resources-builder/report.html
research/tree-resources-builder/harness/_tmp_cam/
```

---

## 6. 已知坑

### 6.1 pip 必须显式 `-i https://pypi.org/simple`
清华镜像源在本机不可用（2026-11-19 定位）。**所有** pip 命令都要带 `-i https://pypi.org/simple`，
否则会卡住或拉到坏包。

### 6.2 代理 `127.0.0.1:7890`
`fetch_public_assets.py` / `fetch_source_previews.py` 里 **硬编码** `PROXY = "http://127.0.0.1:7890"`。
代理没起时这两个脚本会失败；它们不走 pip 的代理配置，是独立的 `urllib` 代理。

### 6.3 `trimesh` 的 `split()` / `body_count()` 需要 scipy
trimesh 的连通分量实现依赖 `scipy.sparse.csgraph`。实测：

- `.venv`（无 scipy）：多体网格上 `mesh.split()` 抛 `ModuleNotFoundError: No module named 'scipy'`。
- `validate.py::_parts()` 用 `try/except` 兜住了这个异常，**静默退化成 `[mesh]`** ——
  于是「部件数上限」这类检查在 `.venv` 下口径变弱（一个多部件物体被当成 1 个部件）。
  要严格口径的几何验证请在 `soma-venv` 跑。
- `vehicle_parts.py` 已经改成**手写并查集**求连通分量（`connected_components`），不依赖 scipy / networkx，
  所以 `.venv` 下能跑。

### 6.4 `bpy` 绑 Python 3.11，且本机不可装
Blender 未安装；`bpy` 只支持特定 Python 版本，本机 3.13 装不了。
本项目用自研 numpy z-buffer 软光栅替代（D3 决策）。

### 6.5 `verify_report.py` 会就地改写 `report.html`
它把校验结果注入报告正文再写回。跑完之后 `report.html` 的 mtime 一定比 `build_report.py` 产出时新 ——
这会直接影响门禁第 1 条的「新鲜度」判定（报告比产物新 = PASS）。改报告后要重跑 `build_report.py`。

### 6.6 `run_pipeline.py` 没有 argparse
`python run_pipeline.py --help` **不会打印帮助**，而是**真的跑整条流水线**并覆写
`assets/geometry/*`、`assets/nongeometry/*`、`assets/previews/*`、`assets/validation/validation_report.json`、
`assets/manifest.json`、`assets/pipeline_data.json`。
**不要拿它试参数。**（2026-11-21 本人踩过：一次 `--help` 探测跑了约 90 秒的流水线。）

### 6.7 报告不自动收录新产物
`build_report.py` **硬编码**了它要加载的 JSON 清单（exports / soma_cpu_test / soma_previews /
soma_anny_adult / public_assets / public_previews / source_previews / shot_001，共 8 个）。
新增验证产物（如 `retarget_bvh.json` / `public_decimated.json` / `shot_spec.json`）**不会**自动出现在报告里。
门禁第 1、2 条就是盯这件事。

### 6.8 PowerShell 5.1 不支持 `&&` / `||`
换行即顺序执行；需要条件时用 `;` + `$LASTEXITCODE` 判断。

---

## 7. 门禁：`harness/check_repo_state.py`

```powershell
& $MAIN $HARN\check_repo_state.py            # 全量，退出码 0
& $MAIN $HARN\check_repo_state.py --strict   # 有 FAIL -> 退出码 2
& $MAIN $HARN\check_repo_state.py --json     # 机器可读 JSON
```

| # | 检查 | 判据 | 级别 |
|---|---|---|---|
| 1 | 产物新鲜度 | `assets/validation/*.json` 的 mtime 比 `report.html` 新（容差 2 s） | FAIL |
| 2 | 报告覆盖度 | 每个产物的 `kind`（缺省用文件名主干）是否出现在 `report.html` 文本里 | FAIL / WARN |
| 3 | 脚本→解释器一致性 | 静态 import 扫描（走 import 闭包）推断的解释器 vs 本文 §2 表 | FAIL |
| 4 | 解释器能力核对 | `subprocess` 实地探测两个解释器 vs 本文 §1 矩阵 | FAIL / WARN |
| 5 | git 跟踪状态 | `git ls-files --others --exclude-standard research/` 的数量与字节 | WARN |
| 6 | PLAN 回填 | 产物 `kind` 是否在 `plans/PLAN.md` 执行记录里出现 | WARN |

**默认退出码 0**：这个目录本来就有一堆待办，报警是常态而不是失败；
真要卡流程时用 `--strict`。**只读**：门禁不写任何被检查的文件。
自检：`& $MAIN $HARN\test_repo_state.py`。

**改本文后必须重跑门禁** —— 第 3、4 条就是拿本文当基准去核对现实的。

---

## 8. 相关文档

- `plans/PLAN.md` —— 调研与架构计划、决策记录、执行记录（**活文档**）
- `research/somax.md` —— SOMA-X 能力、许可、三后端实测
- `research/paradigms.md` —— 六种技术范式与候选
- `research/public_assets.md` / `research/community_assets.md` —— 公共资产来源与许可
- `harness/check_repo_state.py` —— 本文的机器校验器
