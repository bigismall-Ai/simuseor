# 公开 3D 资产可用性：服装 / 生物 / 植被 / 道具 / 载具

> 结论先行：**可以下载，而且多数类别有 CC0 来源**；但「下载」不等于「可直接用于白模管线」。
> 需要做许可登记、尺度/朝向归一化、材质剥离、非流形修复，才能进入本项目的验证与导出流程。
> 商用链路只允许 CC0 / CC-BY（保留署名），禁止 CC-BY-NC 与 Sketchfab Standard License。

## 1. 推荐来源（按许可安全性排序）

| 来源 | 许可 | 覆盖类别 | 格式 | 备注 |
|---|---|---|---|---|
| **Poly Haven**（polyhaven.com/models） | CC0 | 道具、家具、部分植被/建筑构件 | blend / glTF / FBX | 扫描级质量，面数偏高；适合近景主道具 |
| **Quaternius**（quaternius.com） | CC0 | 动物、植被、载具、建筑模块、角色 | glTF / OBJ / FBX | 低模、风格统一，适合中远景与代理 |
| **Kenney**（kenney.nl/assets） | CC0 | 家具、自然、车辆、角色 | glTF / OBJ / FBX | 极低模，适合 blockout 与人群 |
| **Google Scanned Objects** | CC-BY 4.0 | 家居道具 | OBJ/GLB | 扫描网格，需重拓扑/减面 |
| **Khronos glTF-Sample-Assets** | 逐模型（多为 CC-BY 4.0 / CC0） | 道具、载具、场景 | glTF/GLB | 每次使用必须单独核对 LICENSE |
| **Sketchfab** | CC0 / CC-BY（需筛选） | 全类别 | 多格式 | 需账号；大量 NC/Standard 许可混在一起，必须过滤 |
| **Objaverse**（objaverse.allenai.org） | 逐模型（CC-BY / CC-BY-NC / 其他） | 全类别 | GLB | 80 万+，需按 license 字段过滤；不适合直接批量商用 |
| **MakeHuman / MPFB2 资产** | CC0（导出资产） | 服装、发型、人体 | MHCLO / OBJ | 服装可直接套到人体底座；代码 AGPL |
| **SMAL** | 非商用研究许可 | 四足动物 | 模型文件 | 不可商用；与人体骨架异构 |

## 2. 分类判断

| 类别 | 能否下载 | 推荐做法 | 主要风险 |
|---|---|---|---|
| **服装布料** | ✅（MakeHuman / Quaternius / Sketchfab CC0） | 下载服装壳 → 重拓扑/偏移 → 贴合 SOMA/ANNY 体型；褶皱用 Blender Cloth（CPU）或直接代理 | 现成服装的拓扑与目标人体不匹配；布料模拟耗时；扫描服装许可复杂 |
| **生物代理** | ✅（Quaternius / Kenney / Sketchfab CC0） | 低模四足可直接作代理；需要动作时优先选带骨架的 CC0 资产 | 骨架命名与 SOMA 不同；大多没有四足步态动画 |
| **植被** | ✅（Poly Haven / Quaternius / Kenney CC0） | 近景主树用 Poly Haven；背景/人群尺度用 L-system 或 Quaternius | 扫描树面数极高（十万级）；alpha 卡片不适合白模 |
| **道具** | ✅（Poly Haven / Kenney / GSO） | 近景主道具用 Poly Haven；重复件用程序化布尔或 Kenney | 扫描件非流形、尺度不一；贴图需剥离 |
| **载具** | ✅（Kenney / Quaternius / Sketchfab CC0） | 需要「门/窗/内饰」可读时，下载 CC0 低模或按本项目方式程序化开窗、抽壳、加内饰；碰撞与尺寸用参数化版本 | 公开车模常为高模/带材质；轴距与门位不统一；CAD 件许可各异 |
| **建筑** | ✅（Kenney / Quaternius 模块包） | 体量用程序化，近景立面用 CC0 模块拼装；BIM 精度走 IfcOpenShell | 公开建筑多为外观壳，缺楼层/构件语义 |

## 3. 接入管线的最小步骤

1. **许可登记**：记录来源 URL、作者、许可、下载时间、SHA256；NC 资产单独隔离。
2. **归一化**：统一米制、Z-up、脚底/底面 z=0；按类别先验做尺度校验。
3. **材质剥离**：删除贴图/材质，只保留几何（白模）。
4. **修复与验证**：非流形修复、减面、水密/自交/部件间隙检查，复用 `harness/validate.py`。
5. **语义标注**：给部件命名（门/窗/轮/树干/树冠），否则下游无法做程序化替换。

## 4. 与程序化资产的分工建议

- **程序化**：需要大量变体、严格尺度、确定性复现、批量场景（人群、街区、背景植被、道具重复件）。
- **下载资产**：近景主角道具、载具、主树、需要真实结构细节的服装与生物。
- **混合**：下载资产做「形」，程序化做「变体/布局/验证」；两者共用 GLB/USD 汇合层。

## 5. 本项目当前状态

- 已实际下载 9 项公共资产到 `var/public-assets`（原始文件，gitignored）：
  Poly Haven 军用箱/扶手椅/岛屿树（CC0）、MakeHuman 服装包（CC0）、Kenney 车包/自然包（CC0）、
  Poly Pizza 跑车（CC-BY）、Khronos Fox（CC-BY 4.0）、Khronos ToyCar（CC0）。
- 清单与哈希见 `assets/validation/public_assets.json`；白模预览见 `assets/previews/public_*.png`；
  社区扩展来源汇总见 `research/community_assets.md`。
- 下载件已做 Y-up→Z-up 与按类别缩放的预览归一化；进入正式管线前仍需减面、修复非流形并剥离材质。
- 载具已升级：车身/座舱抽壳、侧窗/前后风挡开口、车门分缝、门把手、后视镜、前灯、座椅/仪表台/方向盘代理。
