# 社区公开资产扩展调研（子代理并行结果汇总）

> 三个子代理分别调研「服装/角色」「生物/植被」「载具/道具/建筑」，以下为去重后的结论。
> 本项目只自动下载了其中 9 项（见第 4 节），其余保留为候选，按需接入。

## 1. 服装 / 角色

| 来源 | 许可 | 下载方式 | 覆盖 | 风险 |
|---|---|---|---|---|
| MakeHuman / MPFB 资产包 | 逐件 CC0（Shirts01/Pants01/Dress01/Shoes01）；部分发型 CC-BY | 官网 zip 直链，免登录 | 上衣、裤、裙、鞋、发型 | 需贴合目标人体；衣物多为未绑定衣片 |
| Quaternius Universal Base Characters / Modular Outfits | CC0 | 官网/itch 免费下载 | 6 人体 + 20 发型 + 多套服装，带绑定 | 风格化比例；模块件易穿模 |
| KayKit Adventurers | CC0 | itch 免费（12MB） | 5 角色 + 25 配件，绑定动画 | 衣物与身体一体，不能单独取衣 |
| Poly Pizza | 逐件 CC0/CC-BY | 网页直下 GLB/FBX | 角色、服装、道具聚合 | 同包许可混标，需逐条核对 |
| Sketchfab（CC0 过滤） | 逐件 CC0/CC-BY | 需免费账号 | 单件服装、鞋帽 | 近年大量 AI 生成件；多为静态 |
| Renderpeople 免费样例 | 自有免费商用许可（非 CC） | 官网直下 | 真人扫描（含穿着） | 高模 + 8K 贴图，需重拓扑 |

## 2. 生物 / 植被

| 来源 | 许可 | 下载方式 | 覆盖 | 风险 |
|---|---|---|---|---|
| Quaternius Ultimate Animated Animals | CC0 | 官网/itch | 12 种四足动物，各 12+ 动画 | 骨架命名/尺度需统一 |
| Quaternius Ultimate Nature | CC0 | 官网/itch | 150 个低模树/植物 | 风格化，近景细节不足 |
| Poly Haven（nature） | CC0 | API/网页直下 | 树、灌木、岩石 | 扫描高模（本次 fir_tree 达 700 万面 / 465MB，已弃用） |
| Grab3D（animals/nature） | CC0 | 网页直下 | 动物、鸟、树 | 40–80 万面，无骨骼，需强减面 |
| Kenney Nature Kit | CC0 | 网页/签名链接 | 330 件低模自然道具 | 极低模，适合占位 |
| Poly Pizza | 逐件 CC0/CC-BY | 直下 GLB | 鸟、四足、树 | 尺度/朝向混乱 |
| Objaverse | 逐件 CC0/CC-BY（数据集 ODC-By） | 脚本 | 80 万+ 模型 | 未策展，重复/破面多 |

## 3. 载具 / 道具 / 建筑

| 来源 | 许可 | 下载方式 | 覆盖 | 风险 |
|---|---|---|---|---|
| Kenney Car Kit / Furniture / City | CC0 | 网页签名链接（可脚本） | 汽车 40+、家具 140、城市模块 | 风格化；无内饰/门窗语义；尺度非真实 |
| Quaternius（车/船/建筑/城市） | CC0 | 官网/itch（Google Drive） | 车 8、船 6、建筑 9、模块 300+ | 低模；假窗/假内饰 |
| Poly Haven（models） | CC0 | API | 521 件道具/家具/工业/建筑 | 高模、PBR，需减面 |
| Khronos glTF Sample Assets | 逐件（ToyCar 为 CC0；Fox 为 CC-BY 4.0） | GitHub raw | 载具、道具、角色、动画 | 逐件核对 README；单位不一 |
| Poly Pizza | 逐件 CC0/CC-BY | 直下 GLB | 车 138、建筑、道具 | 来源杂、拓扑不一 |
| Google Scanned Objects | CC-BY 4.0 | Gazebo Fuel API | 1032 件家居扫描 | 高模、破洞/非流形 |
| FreeCAD-library | CC-BY 3.0 | GitHub（约 5GB） | 建筑构件、HVAC、机械 | B-Rep，需网格化与逐件署名 |
| GrabCAD | 逐件（默认非商用） | 需注册 | 汽车/飞机/船/工业件 | 许可不清、登录、高模 |

## 4. 本项目已下载（可复现）

原始文件在 `var/public-assets`（gitignored），清单 `assets/validation/public_assets.json`。

| 资产 | 类别 | 许可 | 面数 | 用途 |
|---|---|---|---|---|
| Poly Haven `old_military_crate` | 道具 | CC0 | 20,952 | 近景道具参考 |
| Poly Haven `ArmChair_01` | 道具/家具 | CC0 | 5,626 | 室内道具 |
| Poly Haven `island_tree_01` | 植被 | CC0 | ~100 万级 | 近景主树（高模，需减面） |
| MakeHuman `shirts01` | 服装 | CC0 | 2,068/件 | 服装壳，配合人体底座 |
| Kenney `car-kit` | 载具 | CC0 | 2,000–5,000/件 | 快速载具白模 |
| Kenney `nature-kit` | 植被/道具 | CC0 | < 1,000/件 | 背景占位 |
| Poly Pizza 跑车（Ignition Labs） | 载具 | CC-BY | 10,252 | 高保真载具参考 |
| Khronos `Fox` | 生物 | CC-BY 4.0 | 576 | 四足动画参考（tomkranis/AsoboStudio/scurest） |
| Khronos `ToyCar` | 载具 | CC0 | 108,936 | 材质/相机测试，已转白模 |

## 5. 选择建议

1. **量产/变体**继续用程序化；**近景主资产**用 CC0 下载件（Poly Haven / Kenney / MakeHuman）。
2. **Quaternius** 覆盖动物/植被/服装最全，但下载走 Google Drive，需人工或浏览器自动化，不适合无人值守。
3. **Poly Pizza** 适合快速补件，但必须逐件核对许可；CC-BY 资产需在交付物中署名。
4. **Grab3D / Renderpeople / GSO** 都是高模扫描，进入白模管线前必须减面与修复。
5. 禁用清单：CC-BY-NC、CC-BY-ND、Sketchfab Standard、GrabCAD 默认许可。

## 6. 来源

- <https://static.makehumancommunity.org/assets/assetpacks.html>
- <https://quaternius.com/> · <https://quaternius.com/packs/ultimateanimatedanimals.html>
- <https://kenney.nl/assets/car-kit> · <https://kenney.nl/assets/nature-kit>
- <https://polyhaven.com/models> · <https://api.polyhaven.com/>
- <https://poly.pizza/>
- <https://github.com/KhronosGroup/glTF-Sample-Assets>
- <https://objaverse.allenai.org/> · <https://app.gazebosim.org/GoogleResearch>
- <https://github.com/FreeCAD/FreeCAD-library> · <https://grabcad.com/library>
- <https://renderpeople.com/free-3d-people> · <https://kaylousberg.itch.io/kaykit-adventurers>
