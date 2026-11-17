# 蝉形 / 低多边形品牌标识 · 外部参照调研

> **文档性质**：纯外部调研（不含本项目设计决策）。所有结论附来源 URL。
> **调研者**：brand-researcher ｜ **日期**：2026-11-13（**v2 修订：2026-11-13，定位口径更新**）
> **调研对象**：SiMuseor VIS v2.0 蝉形辅助图形（品红→橙渐变 + 白色发丝接缝线，三帧 MIN/MID/MAX）
> **品牌定位（v2 口径，已更新）**：SiMuseor / **司梦** = **剧集（电影）AI 导演台**（原「AIGC 模型社区 / 创作工作台」口径**已作废**，见 §0 说明与 §6 前置声明）
> **用户既定定位**：字标是主视觉，蝉形是辅助图形，一般与字标共存；蝉形单独出现当前仅用于网站 favicon。

> ⚠️ **v2 修订说明（定位变更对结论的影响）**
> 本报告初版基于「AIGC 模型社区 / 创作工作台」定位撰写，其中 §1.1 蝉镜 AI 竞品判定、推论 1.2 / 1.3、建议 5、§6 风险清单 P0 条均**绑定旧定位**，已在 v2 中逐条更新并留痕。技术性结论（低多边形小尺寸失效、发丝线归零、favicon 独立重画、mono 版必需、组合标排布口径）**不受定位变更影响，全部继续有效**。
> 定位变更同时**增强**了 §1.4 的实证基础：新定位「剧集（电影）AI 导演台」与影视/动画/舞台领域「以昆虫为核心意象」的既有案例**高度同频**，比通用创作平台的契合度更高。

**阅读约定**：
- 🟩 **有来源的事实** — 可直接引用的业界案例、数字、规则，附 URL
- 🟨 **推论** — 我的分析判断，附推理依据（依据本身可追溯）

---

## 0. 一页速览：5 条关键发现

| # | 关键发现 | 来源 |
|---|---|---|
| **1** | 「低多边形几乎从不在小尺寸下工作」是行业共识：**< 32px 面片必然糊成一团**，且每个低多边形 logo 都必须**从第一天就配一版 flat backup**（纯剪影 / 少面片 / 1–2 色）。 | [inkyy — 16 Low Poly Logo Designs](https://www.inkyy.com/low-poly-logo-design) |
| **2** | **白色发丝线在 favicon 尺寸必然消失**——这是硬物理不是审美问题：低于目标尺寸 1px 的描边「渲染为空白或光学伪影」。团队自测数据（接缝线 2px@1536 → 16px 时 **0.021px**）与行业规则完全吻合。 | [brainy.ink — Logo Simplification Rules](https://brainy.ink/paper/glossary/logo-simplification-rules)｜[utilokit — Favicon Generator](https://utilokit.com/vi/tools/favicon-generator)｜[ikagency](https://www.ikagency.com?p=14900/) ｜ 团队实测 `assets/cicada-preview/favicon-legibility.png` |
| **3** | **favicon 必须是独立设计的第四层资产，不能是第三层的缩放**。业界标杆：Google 的 G、Mailchimp 的 Freddie、Slack 的井号、Notion 的 N、Vercel 的三角 —— 全部是为 16px 单独画的。 | [brainy.ink — Responsive Logo Systems](https://brainy.ink/paper/responsive-logo-systems) |
| **4** | **「图形在左、字标在右」是西方横版组合标默认**（阅读方向 + 重量平衡双重理由）；权威间距口径是 **X 单位的倍数**，X 取自字标 cap-height 或符号内部稳定宽度，GOV.UK 甚至用「皇冠点」当尺子。 | [Unfold — Logomark on the Right?](https://unfold.co/journal/logomark-layout-proportions)｜[Kukoo — Logo Lockups: X Method](https://kukoocreative.com/blog/logo-lockups)｜[GOV.UK Brand Guidelines](https://brand.design-system.service.gov.uk/logo-system/logo-elements/) |
| **5** | ⚠️ **中文 AIGC 赛道已有「蝉」占位者**：**蝉镜 AI**（chanjing.cc）是 AI 数字人内容创作平台，其 favicon 主色 `#ff5a25` 橙红 + 抽象环形标，与 SiMuseor 的橙色极 `#f04c3e` 直接撞色。**［v2 更新：该 P0 风险已由用户裁决解除 —— 品类不重叠，详见 §6.1；风险事实本身仍成立并留档］** | 蝉镜官网 http://www.chanjing.cc/ ｜（favicon 实测采样 `#ff5a25`）｜[Utter Design — Cicada8](https://utter.design/project/cicada8)｜[Behance — CICADA Branding](https://be.net/gallery/242096259/CICADA-Branding) |

---

## 1. 蝉 / 蝉形在品牌标识中的真实用法

### 1.1 直接以「蝉」为核心意象的品牌案例

#### 🟩 Cicada Hui（知了汇）— 2022 A' Design Award 铁奖，教育品牌
- 🟩 「The logotype is based on the cicada's basic form, an insect that traditionally symbolizes persistence, dreams, determination and good reputation. The cicada's spread wings express the intent to aim high.」
- 🟩 配色：黄、绿、蓝（表达年轻与活力）；配套木质 + 铝框 + LED 灯管招牌实体
- 🟩 图形语义被明确框定为「展翅 = 志在高远」
- 来源：https://designers.org/134386 ｜ https://www.designradiant.com/134386

#### 🟩 CICADA Branding（Behance, 2024）— crypto / Web3 做市公司
- 🟩 品牌名释义：「cyclicity, renewal and constant change」——与加密市场的周期性与品牌哲学同源
- 🟩 关键做法：**logo 基于字体（lettering-based）**，强调 typography / geometry / minimalism；图形化的蝉**只在 mascot（吉祥物）与周边中登场**，主体标识系统靠排版撑起
- 🟩 merch 设计原则：「Clothing and accessories are not overloaded with graphics and work through typography and signs」
- 来源：https://be.net/gallery/242096259/CICADA-Branding

#### 🟩 Cicada8（Utter Design）— 网络安全 / 漏洞管理
- 🟩 官方说明：「users, i.e. hackers and developers, love puzzles, so we took the image of a cicada, embedded it into the brand logo, and extended the brand identity into the app design and merch」
- 🟩 交付范围：Brand Identity / Design / Web Design / Infographics / Illustrations / Merch
- 来源：https://utter.design/project/cicada8

#### 🟩 蝉镜 AI — 中文 AI 内容创作平台（**同赛道观察对象；v2 定位下判定为「品类不重叠」，见 §6.1**）
- 🟩 定位：「一站式 AI 内容创作工作台」，提供数字人视频、AI 创作、无限画布、智能拉片、PPT/PDF 转视频
- 🟩 favicon 实测（我下载并采样）：**主色 `#ff5a25`**，形为**圆角三角形环状回路**（近似蝉翼/身体抽象），与 SiMuseor 橙色极 `#f04c3e` 属同色系区间
- 🟩 **v2 定位判定**：蝉镜 = 数字人营销 / 一站式内容生产；SiMuseor / 司梦 = **剧集（电影）AI 导演台**。二者**品类不重叠**，且命名不冲突（司梦 ≠ 蝉镜）→ 用户裁决：**蝉形保留原样，不做任何更改**。上表中的色域邻近事实仍然成立并留档（作为将来另出色板时的锚点依据）。
- 来源：http://www.chanjing.cc/ ｜ https://doc.chanjing.cc/help-center/

### 1.2 开发者工具 / AI / 创意软件领域的昆虫标识

| 品牌 | 昆虫 | 风格 | 标识用途 | 配色 | 来源 |
|---|---|---|---|---|---|
| **Apache Ant** | 蚂蚁 | 写实单色剪影 | 主标 | **`#A81C7D` 品红紫** | [iconcreator](https://iconcreator.co/icons/brands/apacheant) / [simple-icons](https://github.com/PeterShaggyNoble/simple-icons) |
| **Apache Hive** | 蜜蜂（+ Hadoop 象鼻杂交） | 扁平插画 | 主标 | 蜜黄 `#FDEE21` | [hive.apache.org](https://hive.apache.org/) |
| **MantisBT** | 螳螂 | 插画 | 主标 | — | [mantisbt.org/manual](https://mantisbt.org/manual/) |
| **Ant Design（蚂蚁集团）** | 蚂蚁 | 单色几何 | 主标 | 蓝 `#1A8FFE` + 红 `#F74955` | [ant.design](https://ant.design/) / [logo.dev](https://www.logo.dev/search/brands/ant.design) |
| **IBM BeeAI** | 蜜蜂（agent 叫 "bees"） | 文字隐喻为主 | 无独立昆虫标 | — | [IBM Think](https://www.ibm.com/think/news/beeai-open-source-multiagent) |
| **CloudBees** | 蜜蜂（紫外视觉隐喻） | 无穷符号 + 紫外渐变 | 主标 = ∞ 符号 | 紫外渐变 + 黑/白/蓝 | [The Brand Identity](https://the-brandidentity.com/project/seeing-the-unseen-mottos-luminous-rebrand-for-cloudbees-finds-inspiration-in-the-vision-of-bees) |
| **Honeycomb.io** | 蜂巢 | 几何 | 主标 | — | [honeycomb.io](https://www.honeycomb.io/) |
| **KDAN** | 蝴蝶（七巧板拼成） | 几何分面 | 主标 | 绿松石 + 莱姆绿 | [KDAN 品牌故事](https://www.kdan.com/blog/kdan-rebranding-2024-2) |

#### 🟩 关键反例：Adobe Firefly —— **「名中有虫，标中无虫」**
- 🟩 Adobe Firefly 的视觉身份**不是**一只萤火虫，而是 Adobe 产品图标系统里的**双字母助记符「Fi」**（红色圆角方块 + 白字 + 一点闪光）
- 🟩 官方定位：Firefly 没有「传统意义上的独立公司 logo」，视觉身份通过「Fi」助记符 + Adobe 字标表达
- 🟩 交付：官方 SVG 资产在产品页；2025 年 MAX 大会起由 Adobe Brand & Icons 团队重绘（配合自研定制字体 Adobe Clean Display Mnemonic）
- 🟩 价值：**当「虫」的名字已经足够强时，图形反而可以完全不画虫**——把稀缺的小尺寸预算全留给字/符号
- 来源：https://logo-index.com/software/adobe-firefly ｜ https://devicons.io/icons/adobe-firefly ｜ https://zonalogo.com/adobe-firefly-logo-png-svg

> 🟨 **推论 1.1**：SiMuseor 选「蝉形 + 低多边形渐变」而非「字内嵌虫」，与 Firefly 的「名实分离」是同一决策树的两个分支。SiMuseor 走的是「图形辅助」路线，成本是**图形必须独立承担小尺寸可读性**，收益是**字标保持绝对主导**。这条路线成立的前提是：图形在 16px 必须有独立的 fallback 形态——而低多边形天然做不到（见 §2）。

#### 🟩 技术圈「昆虫动物园」的整体观察
- 🟩 开源基金会项目普遍用动物做 mascot：Twitter 小鸟 Larry、PHP 大象 ElePHPant、GIMP 的 Wilber、Apache Hadoop 小象、PostgreSQL 小象 Slonik、Perl/Rakudo 蝴蝶、Bower 鸟、Pidgin 信鸽、LLVM 飞龙、Flink 红松鼠
- 🟩 昆虫类在这个动物园里占比不高但存在（Ant、Hive、Mantis），且**几乎全部是「扁平 / 写实剪影」风格，而非低多边形分面**——因为它们要在文档站、构建日志、控制台里以 16–24px 长期存活
- 来源：https://csdnnews.blog.csdn.net/article/details/112386559 ｜ https://m.bilibili.com/opus/479774643267889523 ｜ https://www.iruanshi.com/news2/47651.html

### 1.3 蝉的东西方文化语义差异与品牌风险

#### 🟩 东方（中文语境）—— 主线是「蜕变 / 高洁 / 重生」
| 意象 | 释义 | 出处 |
|---|---|---|
| **金蝉脱壳** | 蝉羽化蜕变时褪去外壳、本体悄然飞走 → 后演化为「三十六计」第二十一计，指制造假象脱身自保 | [易有料](https://h5detail.yiyouliao.com/rivers/newsfeed/1536235174142947329/ID3G5VC6DHQF0H1.html) |
| **成蟬驚人 / 一鸣惊人** | 蝉最终开口发声，比喻突然的成功 | [头条·蝉文化](https://www.toutiao.com/article/6326760437392539906/) |
| **居高声自远**（虞世南） | 蝉栖高枝、餐风饮露 → 清高自守，不借外力 | [红网](https://wh.rednet.cn/m/content/646742/75/13004789.html) |
| **玉蝉口含** | 汉代丧葬礼俗，玉蝉置死者口中，象征**精神不死、重生** | [路桥数字报](http://paper.lqnews.cn/html/2014-10/29/content_6_2.htm) |
| **蝉蜕** | 空壳是灵魂离身的具象，象征蜕变新我 | [DCMP](https://www.dcmp.org/media/15361-emily-graslie-s-art-lab-cicada-mania) |
| **蝉联** | 连续接续、屡获殊荣 | [头条](https://www.toutiao.com/article/6326760437392539906/) |

#### 🟩 东方（中文语境）—— 负面/风险联想（有实据）
- 🟩 **「蝉噪」＝ 讥讽诗文多浮辞滥调、无病呻吟**（南朝梁王籍《入若耶溪》「蝉噪林逾静」本为写景，后被引申为贬义；唐韩愈《荐士》「齐梁及陈隋，众作等蝉噪」）
  - 来源：https://www.hao86.com/ciyu_view_9bf2b043ac9bf2b0/ ｜ https://suinian.com/book/1884/1217461.html
- 🟩 **「蛙鸣蝉噪」＝ 比喻庸俗低劣的文章或言论**，明确「△贬义」
  - 来源：https://www.guoxuedashi.com/dangu/67032x/ ｜ http://suinian.com/book/1884/1217461.html
- 🟩 **「噤若寒蝉」＝ 形容人畏惧权势、沉默不敢言**（负面）
- 🟩 **「寒蝉凄切」＝ 凄清冷落、伤神叹息**（柳永《雨霖铃》）
- 🟩 **生物学层面的负面**：蝉是**吸食树汁的农业害虫**，雌蝉产卵刺孔使树木枯萎；幼虫刺吸植物根部汁液。「这又是一地地道道的害虫」
  - 来源：http://paper.lqnews.cn/html/2014-10/29/content_6_2.htm
- 🟩 **「地下」联想**：蝉幼虫在地下蛰伏 3–17 年，黑暗中以树根汁液为生 —— 在品牌叙事里既可读作「沉淀」，也可被读作「蛰伏 / 不可见 / 慢」
  - 来源：https://www.knowmastery.com/cicada-symbolism

#### 🟩 西方语境
- 🟩 **圣经传统中昆虫整体偏负面**：「In Western cultures and those rooted in Biblical tradition, insects have had negative connotations as detestable, creepy, swarming creatures」；**东亚传统对昆虫的评价则远为正面**
  - 来源：https://www.dcmp.org/media/15361-emily-graslie-s-art-lab-cicada-mania
- 🟩 西方/古希腊：蝉 = 不死 / 艺术灵感 / 阿波罗 / 缪斯；柏拉图神话中人被缪斯赐予永恒歌声后化为蝉
  - 来源：https://speritualmeaning.com?p=391/
- 🟩 西方现代：蝉主要联想 = 夏日 / 声音记忆 / 无常（Japanese haiku 强调短暂）
  - 来源：https://iere.org/what-do-cicadas-symbolize

#### 🟩 法律与符号占用风险
- 🟩 **CICADA 3301**（2012–2014 匿名密码谜题组织）曾有一枚美国文字商标注册（Registration #5678319，PRIMUS HOLDINGS, LLC，2019-02-19 注册，**2025-08-29 因 Section 8 取消**）；**其同名图案作为原创艺术作品几乎必然受版权保护**，且与「解密 / 神秘 / 黑客」语义强绑定
  - 来源：https://www.trademarkia.com/cicada-3301-87913185 ｜ https://trademarks.justia.com/879/13/cicada-87913185.html ｜ https://www.sortmymark.com/trademark-insights/is-the-cicada-3301-cicada-drawing-trademarked
- 🟩 **Cicada3301 勒索软件家族**（2024 年 6 月首次观测，RaaS 模式，Rust 编写）已活跃 —— 「Cicada + 技术/安全」语境在 2024 年后带有安全事件色彩
  - 来源：https://hackread.com/cicada3301-ransomware-french-peugeot-dealership/
- 🟩 **学界对「蝉 = 神秘/圣洁灵物」的评价同时存在**：在先民眼中「游于太清，轻举独往，忽然入冥」，被视为纯洁、清高、通灵的象征 —— 与 §1.3 的负面项是同一枚硬币的两面
  - 来源：http://paper.lqnews.cn/html/2014-10/29/content_6_2.htm

> 🟨 **推论 1.2（v2 已按新定位重写）**：SiMuseor / 司梦的中文品牌叙事在**剧集（电影）AI 导演台**语境下有**专属**素材可用 —— 蝉的**生产周期**（地下蛰伏 → 破土 → 蜕壳 → 羽化 → 居高而鸣）恰好映射一部剧集从剧本开发到成片上线的完整链路（详见 §1.4 实证）。旧定位只能映射到「迭代 / 再生成」，那是任何生成式工具的通例；新定位映射到**影视专属**的完整周期。
> 仍需主动回避的**贬义线**（「蝉噪 / 蛙鸣蝉噪 / 寒蝉凄切 / 噤若寒蝉」）在 v2 定位下**更加必要**，理由从「安静的工作台气质」升级为「导演台是叙事与声音的核心场景，『聒噪』是直接的业务负面」——文案层禁用「知了」「叫不停」「聒噪」「鸣」等直指声音的词。
> ⚠️ **v2 新增一条边界（须写死）**：**禁止「蝉 = 梦」类文案**（如「让梦成蝉」「蝉梦」）。用户明确「我们是司梦，不是蝉」——**品牌名与图形是两个独立命题**；「梦」是用户的想象，蝉是蜕变 / 羽化 / 鸣，语言不重叠，强行等同会造成「名字被图形吃掉」的反向风险。

> 🟨 **推论 1.3（v2 已按新定位重写）**：CICADA 3301 商标已于 2025 年取消，**法律障碍低**；「Cicada + crypto / 安全 / 神秘」的**语义先占**仍存在。v2 定位下，SiMuseor 落在**影视制作 / 剧集 AI**赛道，与 CICADA 3301 的密码学 / 黑客语汇**品类距离更远**（比旧定位的「AIGC 创作平台」更远），风险进一步可控。仍建议避免视觉上做成「黑色剪影 + 加密感 + 神秘符号」这一 Cicada 3301 的视觉语汇——在影视语境下该语汇会被读作「黑客工具」而非「影视工业」。

---

### 1.4 影视 / 动画 / 舞台语境中的蝉与昆虫意象（v2 新增 · 实证补强）

> **本节目的**：为「剧集（电影）AI 导演台」这一新定位提供**影视领域内的直接实证**——证明「蝉 / 昆虫 × 影视制作」不是类比修辞，而是**已存在的行业实践**。以下案例全部来自公开可查的影视作品与制作公司。

### 🟩 A. 影视作品中以「蝉 / 蜕壳」为核心的意象

#### 🟩 电影《蝉衣》（导演罗灵，2025–2026 上映）— **中文影视，最直接的同构案例**
- 🟩 **以「蝉蜕」为核心意象**的剧情长片：「影片以粤北归侨群体真实历史为蓝本，以 **『蝉蜕新生』作为核心意象**，讲述普通人冲破生活桎梏、完成自我觉醒与生命蜕变的故事」
- 🟩 导演自述：「**蝉褪去旧壳，方能迎来新生**，这一隐喻贯穿全片」「影片是从一个女人的沉默与出走切入，从而让观众看见千千万万乡村女性的影子」
- 🟩 影片「历经三版拍摄、两度推翻重制」，前后打磨十年 —— **「十年」正对应蝉的地下蛰伏期**
- 来源：https://m.toutiao.com/article/7687294810297762346 ｜ https://yy.voc.com.cn/news/202609/33860774.html

#### 🟩 动画短片《663114》（Isamu Hirabayashi, 2011）— **蝉 = 生命循环本身的载体**
- 🟩 主角是一只**66 岁的蝉**，沿垂直表面（树的象征）持续攀升，**破壳而出后遭遇地震**；影片主题是福岛核灾与「生命循环的延续」
- 🟩 导演阐释蝉的选择理由：「Cicadas are among the special signifiers of summer and appear metaphorically as **a symbol of rebirth in many great works of literature such as The Tale of Genji**. They are also **one of the longest living insects and spend much of their life cycle underground**」
- 🟩 媒介：剪纸 / 和纸拼贴 + 墨的手绘质感 —— **低面数、低色彩层级的视觉语言**
- 来源：http://madfilm.org/review-663114-at-rooftop-cinema-fri-jun-30-930pm/

#### 🟩 电影《Cicada》（Dean Yamada, 2015）— 蝉壳作为「蜕变的实物道具」
- 🟩 主角在婚前体检中发现不育症、妹妹之子被霸凌，**故事线索是「蝉壳（cicada shells）」**；评论原文：「Cicada uses the discarded insect exoskeleton to **propose a metamorphosis for the adult who has forgotten he was also once a child**」
- 🟩 主题句：「when we **shed another layer of our former selves** and take on a more mature form」
- 来源：https://stage.asamnews.com/2015/03/12/review-cicada-is-visually-awe-inspiring-emotionally-inspirational/

#### 🟩 定格动画《Cicada》（Swoon, 2020）— **蝉 = 蜕变与自我疗愈的完整叙事**
- 🟩 官方项目描述：「Cicada, Swoon's first major stop-motion animation, is a **meditation and celebration of emergence, growth, and transformation**」
- 🟩 关键论证：「As an insect, the cicada is notable for **spending much of its life underground, only emerging into adulthood after thirteen to seventeen years**. In Cicada the artist expresses a similar ability, one shared by all of us, **to molt and burst through one's former self in a cycle of self-realization and self-healing**」
- 来源：https://swoonstudio.org/projects-1#/swimming-cities-of-serenissima/ ｜ https://www.turnercarrollgallery.com/?p=61044

#### 🟩 电影《Silence》（马丁·斯科塞斯, 2016）— 蝉在叙事中的**结构位**
- 🟩 蝉的叫声是全片的关键**转场与情绪标记**：「the cicada sings at key moments」——开篇黑屏即闻蝉鸣，结尾黑屏再现；原著中「Just as before, the cicadas kept on singing their song, dry and hoarse」
- 🟩 评论中的语义辨析：「**the cicada's song, then, may announce Rodrigues' vainglorious mission**」——蝉鸣被读作「宣告 / 出发」，而不仅是环境音
- 🟩 佛教语汇的转述：「the natural history of the cicada has furnished Buddhism with similitudes and parables… Man sheds his body only as the semi sheds its skin」
- 来源：https://linnetmoss.com/2017/01/12/shusaku-endos-silence-on-page-and-screen

### 🟩 B. 影视 / 舞台制作机构的昆虫标识（**对 SiMuseor 最直接的可比案例**）

#### 🟩 Wētā Workshop / Wētā FX（新西兰，彼得·杰克逊 1987/1993 创立）— **影视视效工业的标志性昆虫标**
- 🟩 **公司 logo 就是一只昆虫**（沙螽 Wētā），且**大楼里立有该昆虫的雕像**；沙螽是新西兰本土昆虫，「早在恐龙时代就已经出现在地球上」
- 🟩 命名理由的自我定位：「Our daily work is making all kinds of monsters」「要让公司成为**世界上最酷的小怪兽**」——**把「丑 / 怪」转化为工业美学的自信**
- 🟩 行业地位：8 次奥斯卡最佳视效（《指环王》三部曲、《金刚》、《阿凡达》、《丛林书》、《阿凡达：水之道》）
- 🟩 关键点：**这是一家影视视效公司，选择了昆虫作为品牌核心意象** —— 与 SiMuseor「剧集（电影）AI 导演台」的品类完全同类
- 来源：https://wiki.teamfortress.com/wiki/Weta_Workshop/zh-hans ｜ https://news.ifeng.com/c/7fbCDwQf4lz ｜ https://en.namu.wiki/w/W%C4%93t%C4%81%20FX

#### 🟩 Cirque du Soleil《OVO》（2009）— **把昆虫嵌进字标本身**
- 🟩 官方设定：整台演出「inspired by the world of insects」，但重点不是昆虫表演本身，而是**运动（movement）与生命的能量**
- 🟩 **logo 手法**：「**The logo of Ovo features an insect within the text, with the two O's representing the eyes and the V forming the nose and antennas.**」—— 字母 O = 眼睛，字母 V = 触角，**昆虫轮廓由字形本身构成**
- 🟩 角色表几乎是一份昆虫名录：蜻蜓（Dragonfly）、瓢虫（Ladybug）、蚂蚁、蝴蝶、萤火虫、蚊子、圣甲虫、跳蚤、蜘蛛
- 来源：https://wiki2.org/en/Ovo_(Cirque_du_Soleil) ｜ https://www.designingsound.com/project/ovo

#### 🟩 Dragonfly Film and Television Productions（原 Firefly, 2004–）— **影视制作公司的蜻蜓标**
- 🟩 影视制作公司的 logo 以**蜻蜓**为主体，且**蜻蜓从文字中生成**（streaks form the text → a coloured dragonfly forms from the text）—— 与 SiMuseor「字标主导 + 图形辅助」是同一类「字 + 形」关系
- 来源：https://avid.miraheze.org/Dragonfly?oldid=1481425

#### 🟩 Cheyenne Enterprises（2003–）— 蜻蜓符号的**跨文化语义**
- 🟩 logo 视觉：「a glowing red runic figure (**a Cheyenne dragonfly symbol**)… and a cloud of flame envelops it, and vanishes to reveal a dragonfly」
- 🟩 符号语义来源：「The dragonfly symbol in this logo is used in Cheyenne art… In these cultures, **the dragonfly symbolizes protection from death**」
- 来源：https://avid.miraheze.org/Cheyenne_Enterprises

#### 🟩 Huhu Studios（新西兰动画工作室, 1996）— **昆虫作为动画厂牌 mascot**
- 🟩 第一版 logo：**一只黄黑色甲虫「飞入并爬到公司名旁边」**（fly in and slightly scuttle up next to the company name）—— **图形位于字标左侧**，与 SiMuseor 现行排布同向
- 🟩 mascot 名：「Hubert The Huhu Beetle」；厂牌 slogan「animation with character」
- 来源：https://avid.miraheze.org/Huhu_Studios

#### 🟩 Kestrop Studio — 独立创作者工作室的蝉标（**小体量亦可行**）
- 🟩 2021 年把一只**17 年周期蝉（Magicicada septendecim, "Pharaoh Cicada"）**放进了工作室 logo
- 🟩 作者自述理由是「screaming chorus of Neotibicen pruinosus pruinosus: Scissor Grinder Cicadas」与童年的夏日记忆 —— **蝉 = 声音记忆 + 周期**
- 来源：https://kateestrop.com?p=87/

#### 🟩 歌剧《Imago》（Glyndebourne, 2012）— **「羽化」作为歌剧品牌的核心概念**
- 🟩 「Imago」是**蝴蝶生命的最后阶段**，即羽化/成虫；歌剧主题是 aging and transformation（衰老与蜕变）
- 🟩 品牌手法：**蝴蝶形框架 + 由彩色「像素」格栅构成的双翼**，并把两位主角的剪影嵌入翅膀轮廓内 —— **低多边形 / 像素化 + 具象自然形态**的组合
- 🟩 动画版 logo：「pixels shift, pulse, and coalesce, mimicking the delicate unfolding of a butterfly's wings」
- 来源：https://www.toopstudio.com/portfolio/glyndebourne-imago-identity/

### 🟩 C. 影视作品中的「剧集 logo 本身承载叙事」的方法论

#### 🟩 《Cats》音乐剧 — **logo 即作品门面**（musical theatre 史上第一个全球推广的 logo）
- 🟩 「the **cat's-eyes logo** was the first globally marketed logo in **musical theatre history**」；「branding the show itself as the star」
- 🟩 设计者 Anthony Pye-Jeary 自述：「We had four letters, a black background and nothing else. **It seems so simple, but it took some time to come up with.**」；并且**主动否定具象猫的方案**：「we had logos with ginger cats and black cats and white cats. But it felt old-fashioned. **None of the ideas matched the show**, which was going to be new and different.」
- 🟩 衍生效应：logo 被用于整个周边体系（T 恤、马克杯、钥匙扣），成为全球可识别的资产
- 来源：https://nypost.com/2016/08/02/thanks-to-cats-theater-souvenirs-are-now-and-forever/ ｜ https://www.wikiwand.com/en/Cats_(Musical)

> 🟨 **推论 1.4（v2 核心论证）**：以上 A/B 两组案例共同证明了一件事 —— **「蝉 / 昆虫 × 影视制作」在欧美与中文影视界都是已落地的品牌与叙事实践**，而非生造类比：
> - **命名层**：蝉的意象天然对应「地下蛰伏（开发期）→ 破土（定稿）→ 蜕壳（每一版迭代都留下壳）→ 羽化（成片）→ 居高而鸣（上线 / 发行）」。**旧定位只能映射「迭代 / 再生成」（任何生成式工具的通例），新定位映射的是「一部剧集从开发到上线的完整周期」—— 专属。**
> - **品类层**：Wētā Workshop（视效）、Dragonfly（影视制作）、Huhu Studios（动画）、OVO（舞台）**四家机构都用昆虫做了主标识** —— 影视制作方接受「非人类 / 非写实生物」作为品牌核心意象，这为 SiMuseor 用蝉形提供了**品类内的合法性**，而非跨品类的冒险。
> - **方法层**：《Cats》的教训直接可用 —— **具象画一只猫（蝉）不如提取一个能成立的形**。SiMuseor 蝉形的价值不在「画得像蝉」，而在「展翅的 V 形剪影在缩到 16px 时仍成立」（见 §2.3 的实体优先原则）。
>
> 🟨 **推论 1.5（v2 附带的边界提醒）**：影视语境同时放大了「蝉鸣」的**负面声学联想**（聒噪、干扰录音、干扰同期声）—— 而这恰是影视制作现场的**真实痛点**（现场噪音）。因此 §1.3 推论 1.2 的「文案层回避鸣叫」在新定位下从「气质建议」升级为**语义安全线**。

---

## 2. 低多边形（Low-Poly）风格在品牌标识中的成败案例

### 2.1 成功案例

#### 🟩 完美日记 PERFECT DIARY — 中文语境下最接近的正面参照
- 🟩 论文明确记录其低多边形海报策略：「以极简的几何线条重构中英双语标识『PERFECT DIARY』与『完美日记』，通过扁平化设计与棱角分明的色块分割，形成高辨识度的视觉符号系统」
- 🟩 动物意象低多边形化：虎 / 狼 / 熊猫的几何抽象处理，「老虎的锐利条纹隐喻眼妆显色度」「狼的冷峻轮廓暗示底妆持久」——**即：面片要承载产品语义，不是纯装饰**
- 🟩 论文称「由 12 个多边形构成的狼头形象」——**面片数量克制**
- 🟩 视觉架构：「高饱和度色块的对比运用与负空间留白形成动态平衡」
- 来源：郭姝宏、段嵘《低多边形风格动态图形在电商品牌中的应用》，《电子商务评论》2025, 14(6): 3404-3411，DOI: 10.12677/ecl.2025.1462126（https://pdf.hanspub.org/ecl_2315074.pdf）

#### 🟩 瑞幸咖啡 × MINE「像素奇妙世界」
- 🟩 「将品牌核心符号——**鹿角 Logo** 与中英文字体**解构为三角形、菱形等几何单元**，以折线化锐角重塑标识，既保留原始辨识度，又注入赛博朋克式的数字锐利感」
- 🟩 关键：**保留原始符号辨识度** —— 分面化后仍须能还原出原符号
- 来源：同上论文，§3.1

#### 🟩 Fenty Beauty — 低多边形的「系统化」用法
- 🟩 「通过低多边形风格的抽象符号化设计，系统性构建了兼具功能传达与文化共鸣的品牌认知范式」；模块化彩妆盘「MONTAKES」六边形拼接；「高饱和度渐变多边形抽象化呈现 50 种粉底色号」
- 来源：同上论文，§2.2.3

#### 🟩 具体低多边形 logo 作品（Inkyy 精选 16 例中的高质量样本）
- 🟩 **Polycat**（Barış Onay）：「a few large red and orange facets」—— **低面片数是聪明之处**，小尺寸仍可辨
- 🟩 **Ram head**（Alex Tass）：**单一橙色到红色区间**，让面片像折纸而非杂乱马赛克
- 🟩 **Havsule**（M Vog）：展翅海鸟形成 V 形，**即使没有面片剪影也成立**
- 🟩 **Crystal C**（Alex Tass）：蓝紫双色，**粗壮字母形，小尺寸比多数低多边形更耐用**
- 🟩 **D monogram**（Alex Tass）：「a handful of coloured triangles… proves that a geometric logo does not need hundreds of facets to feel three-dimensional」
- 来源：https://www.inkyy.com/low-poly-logo-design

#### 🟩 低多边形的其他成熟商业应用
- 🟩 Okta 2022 品牌重塑（Athletics 事务所）：Aura 符号由多个纵向切面汇聚而成，「each spoke representing a facet of who we are」—— 身份管理 SaaS，蓝色 `#3E59E4`
  - 来源：https://brandkit.pro/brand/okta
- 🟩 Unity 2021 重塑：等距立方体由三个汇聚箭头构成，**纯黑白**、加粗笔画、无渐变
  - 来源：https://brandkit.pro/brand/unity
- 🟩 MYOB（Peter Borg Studio）：核心几何形状「from flat 2D to bold 3D」，紫色提亮
  - 来源：https://worldbranddesign.com/peter-borg-studio-redefines-the-identity-of-myob-as-a-modern-tech-platform/

### 2.2 失败案例与风格失效场景

#### 🟩 风格本身的失效（低多边形 logo 的四个陷阱）
Inkyy 的原话（**这一段是本调研最重要的单条来源**）：
> 🟩「**The main trap is size. A low poly logo rarely works small. Below about 32 pixels the facets blur into a muddy shape, and fine colour shifts disappear on a favicon, a stamp or an embroidered shirt. The fix is to design a flat version from day one: a solid silhouette or a simplified shape with a handful of facets, in one or two colours.**」
> 🟩「Other traps are using too many colours, copying stock "polygon animal" art, and choosing the style for a brand that needs to feel calm or traditional, such as a law firm.」
- 来源：https://www.inkyy.com/low-poly-logo-design

#### 🟩 六条低多边形设计原则（Inkyy，可直接转成 VIS 条目）
1. **Start with a flat silhouette.**「If the shape does not work as a solid black form, the facets will not save it.」
2. **Use fewer facets than you think.**「Big triangles look deliberate. Hundreds of tiny ones look like a filter.」
3. **Limit the palette.**「One hue in light and dark tones… looks cleaner than a rainbow.」
4. **Make the facets mean something.**
5. **Plan a flat version.**「Build a one-colour or two-tone version for favicons, stamps, embroidery and low-quality print.」
6. **Test it small.**「Check the mark at 32px and 16px before you present it to a client.」
- 来源：https://www.inkyy.com/low-poly-logo-design

#### 🟩 论文给出的量化约束（中文语境的行业口径）
- 🟩「在面数控制，单个模型面数**不超过 200 面**，关键部件压缩至 **50 面以内**」
- 🟩 在色彩上极简，采用「**3 + 1**」配色法则，**色相环角度差限制在 30° 以内**，避免视觉噪点
- 🟩 低多边形设计原理：「**Color transitions should happen across groups of facets, never within a single polygon face**」（Chris Lemke, Low Poly Design Reference）——即渐变应在面片**之间**发生，而非面片**内部**
  - 来源：https://chrislemke.github.io/website_designs/designs/Low_Poly.html
- 🟩 论文阐述的认知机制：视觉系统会自动将复杂形状感知为简单规则图形；「当用户注视由 12 个多边形构成的狼头形象时，视觉皮层会自动将断裂的边缘连接为流畅的剪影」——**格式塔完形 / 认知补全**，这是低多边形能「少即是多」的根本原因
  - 来源：https://pdf.hanspub.org/ecl_2315074.pdf

#### 🟩 「去标识化过度」的失败（与低多边形同源的扁平化浪潮）
- 🟩 **Cracker Barrel（2025-08）**：删除 Uncle Herschel 老爷爷 + 木桶的经典 logo，改为纯文字字标 + 平坦黄色多边形 → 一周内回滚，股价下跌；后被描述为「brand suicide」
  - 来源：https://www.studiokalex.com/blog/rebrand-backlash-how-to-rebrand-without-losing-customers ｜ https://hillsdalecollegian.com/?p=9004111222238267
- 🟩 **Gap（2010）**：Helvetica 纯文字 + 蓝色小方块 → 消费者激烈反弹，约一周回滚
  - 来源：https://graphicfolks.com/blog/iconic-logo-design-fails ｜ http://sh.huanqiu.com/top/2011-04/47701.html
- 🟩 **Tropicana（2009）**：包装去掉「带吸管的橙子」→ 两个月内销量约跌 20%，回滚
  - 来源：https://www.studiokalex.com/blog/rebrand-backlash-how-to-rebrand-without-losing-customers
- 🟩 **Animal Planet（2008 / 2018）**：两次简化大象 logo → 被批「失去动物连接」；**Yahoo!（2019）** 极简无衬线化 → 品牌个性丧失；**Jaguar（2024）** 发光霓虹 J + 迷幻广告 → 老用户迷失
  - 来源：https://onlykutts.com/2024/11/26/will-too-much-minimalism-kill-brands/
- 🟩 **London 2012 奥运会（2007）**：锯齿状高饱和 2012 字标被批「难辨、小尺寸失效」
  - 来源：https://graphicfolks.com/blog/iconic-logo-design-fails
- 🟩 **Burberry（2018）**：砍掉骑士纹章 → 2023 年被迫恢复
  - 来源：https://marketingmind.in/when-rebranding-goes-too-far-strips-the-soul-of-a-brand/

> 🟨 **推论 2.1**：以上失败案例的共同机制**不是**「太简」，而是**「拿走了用户用来认出你的那个特征，却没给出替代品」**。SiMuseor 的蝉形恰好是这个「特征」，所以问题不在「要不要有蝉形」，而在**蝉形在哪个尺寸还能不能被认出**（见 §2.3）。若蝉形在 16px 就塌了，用户实际「被拿走的特征」是空转的——规范必须保证它不掉链子。

### 2.3 缩小到 16–32px favicon 时的失效模式与业界解法

#### 🟩 失效模式一：面片糊成泥块（低多边形专属）
- 🟩 「Below about 32 pixels the facets blur into a muddy shape, and fine colour shifts disappear」
- 🟩 渐变在 16px 的行为：「**Gradients, drop shadows, inner glows and bevels average into a single dull tone in a 256 pixel area**」（16×16 只有 256 个像素）
  - 来源：https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/
- 🟩 「A three-color gradient becomes one flat colour」
  - 来源：https://beconfidency.agency/insights/logo-for-small-sizes

#### 🟩 失效模式二：细描边 / 发丝线消失（本项目的核心风险）
四份独立来源给出同一物理规律：
- 🟩 **brainy.ink —「Drop hairlines」**：「Any stroke below 1px at the target size will render as **nothing or as an optical artifact**. Remove it or convert it to a filled shape with a **minimum 2px optical weight** at the target size.」
  - 来源：https://brainy.ink/paper/glossary/logo-simplification-rules ｜ https://brainy.ink/paper/responsive-logo-systems
- 🟩 **utilokit**：「a 1px line in a 512×512 source becomes a fraction of a pixel at 16px and either **vanishes** or turns into an ugly anti-aliased smear. Keep stroke widths at a minimum of 2-3px relative to the 512px canvas」
  - 来源：https://utilokit.com/vi/tools/favicon-generator
- 🟩 **ikagency**：「**Minimum readable stroke weight at 16px is 2 pixels.** If your logo has 1px strokes, it will vanish on mobile devices.」
  - 来源：https://www.ikagency.com?p=14900/
- 🟩 **dev.to 实测**：「At 32 and 48 the bird is clear. At 16 the **thin feather tips turn into grey specks**. Nothing is wrong with the file: 16 pixels cannot hold a line that thin.」
  - 来源：https://dev.to/usman_basheers/making-a-favicon-from-an-svg-measured-what-breaks-at-16-pixels-16om

> 🟩 **团队自测数据（内部实测，与上述规律完全吻合）**：
> `assets/cicada-preview/favicon-legibility.png` 标注：接缝线 2px @1536px → **16px 时 0.021px / 32px 时 0.042px / 48px 时 0.062px**，全部标注「**invisible below 1px**」。
> 🟩 **结论**：SiMuseor 的白色发丝接缝线**在任何 favicon 尺寸（16/32/48）下都不可能可见**。它不是「缩小后变弱」，而是**归零**。

#### 🟩 失效模式三：负空间闭合 / 轮廓粘连
- 🟩 「The negative space inside enclosed letterforms **closes at small sizes**」
- 🟩「Thin gaps between shapes close up at 16 pixels and the mark fills into a blob. Give the shapes room, or thicken them so the gaps stay open.」
- 🟩 中文字腔需「加大 25–50%」
  - 来源：https://brainy.ink/paper/responsive-logo-systems ｜ https://favicontools.com/zh/blog/favicon-from-logo

#### 🟩 失效模式四：颜色依赖失效
- 🟩 「Check the mark in one colour, reversed on dark, and in greyscale. **If it only works in the brand gradient it will fail** on an embroidered shirt, a stamp, a fax and half the places it ends up.」
  - 来源：https://webdigitalmantra.com/blog/why-most-logos-fail-at-16-pixels
- 🟩 「**色彩可以作为辅助，不能作为识别的全部**」；小尺寸下颜色可能被压缩、偏色、压暗
  - 来源：https://www.3wen.cn/jijianbiaozhibushiyuexiaoyuehao.html

#### 🟩 业界解法（可直接转成规范的四条）
| 解法 | 具体规则 | 来源 |
|---|---|---|
| **① 从最小尺寸倒推** | 「Design at 16×16, then scale up… Designing small and scaling up forces simplification.」 | [brandedwebdesign](https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/) |
| **② 分层裁切，不等比缩放** | 「If the symbol is detailed, **crop to its most recognisable fragment** rather than reducing the whole thing.」 | 同上 |
| **③ 实体优先于描边** | 「Prefer mass over outline. An outlined shape at small sizes becomes a thin ring.」 | [brainy.ink](https://brainy.ink/paper/glossary/logo-simplification-rules) |
| **④ 配色压到 2–3 色、去渐变** | 「Limit yourself to two colours and kill the gradients.」「颜色愈少愈好认…压到两到三色以内」 | [brandedwebdesign](https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/) ｜ [pongo](https://www.pongo.com.tw/favicon-logo-simplification) |
| **⑤ 容器法（最稳）** | 「A solid rounded square or circle filled with brand colour, with the glyph knocked out in white, is the most reliable favicon pattern in existence.」 | [brandedwebdesign](https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/) |

#### 🟩 行业对「轮廓剪影」的唯一硬测试
- 🟩 「**Start with a flat silhouette.** If the shape does not work as a solid black form, the facets will not save it.」
- 🟩 中文的等价表述：「把标志转成纯黑剪影，缩小到 16px 看一眼。如果这时轮廓还认得出来，说明外形的节奏是对的；如果糊了，说明细节太多、间距太窄。这一步能筛掉 80% 的『只在 800px 预览里好看』的方案。」
  - 来源：https://hajiarui.com/html/news/1418.html

### 2.4 「低多边形 + 高饱和渐变 + 白色发丝线」组合在业界的常见度

#### 🟩 组合本身**是**低多边形美学的原生表达
- 🟩 低多边形定义：「the visible polygon structure itself is the decoration; **wireframe edges and facet boundaries are features, not flaws**」；渐变是「**across facets**」而非「within a face」，形成「stained-glass mosaic effect」
  - 来源：https://chrislemke.github.io/website_designs/designs/Low_Poly.html
- 🟩 风格解剖：「**Gradient Across Surface** — Color often shifts gradually over the whole form, adding richness while the facets stay crisp」；「**Soft Ambient Light** — Gentle lighting differentiates each plane」
  - 来源：https://www.designstylebook.com/graphic-design/low-poly
- 🟩 存在专门的「crystallize / stained glass」工具把照片碎成多边形并**加 wireframe stroke**（「Adds a border around the crystals. Perfect for stained glass aesthetics… especially when paired with bold, highly saturated photographs」）—— 印证「高饱和 + 白色边线」正是 low-poly 的标准配伍
  - 来源：https://edittheimage.app/?p=1784/
- 🟩 Inkyy 16 例中，**Foxy**（Stevan Rodic）明确使用「warm orange and red + **white planes** for the cheek and chest」—— 白色作为**面片**而非线条出现

#### 🟩 但「白色发丝线」在**品牌标识**语境中几乎绝迹
- 🟩 对比 Inkyy 全部 16 例：**没有任何一个把细白描边作为识别特征**；白色只以**大块面片**（Foxy 的脸颊/胸腔）出现
- 🟩 对比技术圈昆虫标识（Ant / Hive / Mantis / Ant Design / KDAN）：**全部为单色剪影或扁平插画，零发丝线**
- 🟩 对比标杆级低多边形/几何标识（Slack # / Unity 立方 / Okta Aura / Google G / Vercel △ / Linear L）：**全部无描边**——Slack 品牌规范明确写「The new octothorpe can **scale up or down to optimize legibility** at various sizes」，Pentagram 亦强调「no outlines anywhere」
  - 来源：https://www.pentagram.com/work/slack ｜ https://a.slack-edge.com/3f2ae/marketing/img/media-kit/Slack-Brand-Guidelines.pdf ｜ https://brainy.ink/paper/glossary/logo-simplification-rules

> 🟨 **推论 2.2**：**「低多边形 + 高饱和渐变」在插画/海报/大图语境是成熟且被广泛认可的表达（完美日记、瑞幸、Fenty、低多边形美学定义本身）；但「+ 白色发丝接缝线」作为**标识**的识别特征，在业界几乎无先例**。原因正是 §2.3 的物理规律：发丝线在 16–48px 归零，等于把最有辨识度的部分放进了一个永远不会被看到的地方。
>
> 🟨 **推论 2.3**：因此 SiMuseor 的资产**不应二选一**，而应**分尺寸分层**：发丝线属于「≥64px 的大尺寸层」；favicon 层需要一枚**重新绘制**的、无发丝线的降级资产。这与 Inkyy 第 5 条原则（「Plan a flat version」）与 brainy.ink 的 tier-3 规则（simplified mark 是重画不是缩放）完全同构。

#### 🟩 L3 favicon 层的「低多边形 + 描边」参考实现（**v2 补充：给 S-L3 验收口径找现成的可读性先例**）

我复核了 Inkyy 全部 16 例与开源图标库中的低多边形动物标，得到的结论是：**业界几乎没有「低多边形 + 描边 + 16px 可辨」的成品先例** —— 因为这正是 §2.3 的失效模式本身。但找到了**四条可迁移的构造规则**，以及**两个最接近的形态参照**：

**（a）可直接对标的形态参照 —— 「展翅 V 形剪影」路线**
- 🟩 **Havsule（M Vog）**：展翅海鸟形成 V 形，Inkyy 的原话是「**the raised wings form a V, so the silhouette works even without the facets**」—— 这是「facet 是加分项、剪影才是本体」的最强表述
  - 来源：https://www.inkyy.com/low-poly-logo-design
- 🟩 **Polycat（Barış Onay）**：「**a few large red and orange facets**」+「**the low facet count is the smart part: the shape still reads when it is small**」—— **少面片 + 暖色区间**是「小尺寸仍可读」的正面样本
  - 来源：同上
- 🟩 **Ram head（Alex Tass）**：「coloured in a **single orange-to-red range**。Keeping to one hue makes the facets feel like folded paper rather than a busy mosaic」—— **单一色相区间**是低多边形能小尺寸存活的色彩学原因，与 SiMuseor plum→orange 的暖色带方向一致
  - 来源：同上

> 🟨 **推论 2.4（对 S-L3 的具体建议）**：SiMuseor 的 L3 层可采用**「Havsule 路线 + Polycat 面片数」**的组合口径 —— 即**以 MAX 帧的展翅 V 形剪影为本体**，只保留 **4–6 个大面片**、**色相锁在 plum→orange 单一暖色带内**、用**深色描边或实色容器**定义外轮廓。**这与 visual-architect 已定的 L3「4–6 大面片 + 深紫描边 + 面片间隙 ≥1px」完全同向**，且现在有 Inkyy 的 Havsule / Polycat / Ram head 三个正面样本作为先例支撑。

**（b）描边方案的行业口径（支持「描边可行」的规则）**
- 🟩 **描边最小光学粗细**：「At 16×16, **no stroke or gap thinner than 2 pixels**」；「Delete strokes thinner than a couple of pixels at final size」
  - 来源：https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/
- 🟩 **实体优先**：「**Prefer mass over outline.** An outlined shape at small sizes becomes a thin ring.」
  - 来源：https://brainy.ink/paper/glossary/logo-simplification-rules
- 🟩 **容器法是「最可靠的 favicon 模式」**：「A solid rounded square or circle filled with brand colour, with the glyph knocked out in white, is **the most reliable favicon pattern in existence**. Reasons: It guarantees contrast against light and dark tab bars; It defines a clear outer silhouette」
  - 来源：https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/

> 🟨 **推论 2.5（对 S-L3 描边色的一点技术提醒）**：visual-architect 已正确指出**深紫描边 `#2a0a2e`/`#3a0a3a` 在深色底上仅 1.02:1 不可见**。我补一条行业侧的佐证：brandedwebdesign 明确「Pair a saturated background with a **white or near-black foreground** (or vice versa)」「keep counters and gaps generous」「High contrast 4.5:1 minimum」，且**容器 + 反白**是「existence 中最可靠的模式」。因此**深色底 favicon 走「实色容器 + 反白剪影」比「深色描边」更稳** —— 这条与 visual-architect 的两条路径建议（深底用 `#ffffff` 描边 18.20:1，或用容器反白）一致，并给出了第三方来源。
> 来源：https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/ ｜ https://faviconbuilder.com/guides/favicon-design-best-practices/

---

## 3. 「辅助图形 + 字标共存」的排布规范参照

### 3.1 图形放左还是放右

#### 🟩 默认：图形在左，字标在右
- 🟩 「Most logo usage guides show the logomark on the left. It's the default.」—— 理由是「In left-to-right reading cultures, the eye enters a composition from the left. Placing the symbol there means it's the first thing seen — **an anchor that establishes brand recognition before the name is even read**.」
- 🟩 「In horizontal layouts, the symbol **almost always** appears to the left of the wordmark. This is because Western readers scan left to right — the symbol creates the first impression, the wordmark confirms the identity.」
  - 来源：https://unfold.co/journal/logomark-layout-proportions ｜ https://madebyevoke.com/blog/combination-mark-logo-design

#### 🟩 放在右的条件与代价
- 🟩 适用场景：导航栏左上角（避免与浏览器边缘碰撞）；非对称编辑版式；**RTL 语言（阿拉伯语、希伯来语）** —— 「This isn't just a design preference — it's a functional requirement」
- 🟩 **重量分布问题**：「A dense, filled symbol carries more visual mass than lightweight typography. When that heavy element sits on the left, it creates a natural reading flow — **heavy to light**. Move it to the right, and you get the opposite: light to heavy. This can feel like the composition is falling off the edge.」
- 🟩 「A logomark on the right typically needs **slightly more padding** between it and the wordmark to feel balanced.」
  - 来源：https://unfold.co/journal/logomark-layout-proportions
- 🟩 反例警示：CHASE（首字母大写 + 右侧符号）因「E」与符号相邻形成更整体的构造；Walmart 同理
  - 来源：https://medium.com/unfoldco/logomark-on-the-right-what-designers-should-know-about-logo-layout-a50c74a9553d

> 🟨 **推论 3.1**：SiMuseor 现状「蝉形在左、字标在右」**与西方惯例一致**，且重量方向（重的图形在左 → 轻的字标在右 → 视线终结于品牌名）恰好**强化了「字标是主视觉」**这一既定定位。**无需改动。** 这也意味着 SiMuseor 不必为 RTL 做镜像设计（若未来出海，也应保持蝉形在左，仅翻转文字方向）。

### 3.2 间距规则（gap）与 X 单位体系

#### 🟩 权威做法：定义一个从标志自身解剖出的单位 X，所有间距写成 X 的倍数
- 🟩 「The standard practice is to define a unit, usually written as **X**, derived from something inside the logo itself: the **cap-height of the wordmark**, the **x-height** of the lower-case letters, or a **stable width inside the symbol**. Every spacing rule then gets written as a multiple of that unit.」
- 🟩 「the GOV.UK brand design system sets out exactly this approach: clear space and the gap between symbol and wordmark are both **expressed in multiples of X**」
  - 来源：https://kukoocreative.com/blog/logo-lockups

#### 🟩 GOV.UK —— 最清晰的「辅助元素」范本
GOV.UK 的皇冠（crown）与字标的关系，几乎就是 SiMuseor「蝉形 + 字标」的同构案例：
- 🟩 「Our wordmark… should be used in **all applications of the logo**.」← **字标是主标识**
- 🟩 「The crown should be used as **a supporting element** that indicates trust and reassurance. It should **always appear in close proximity to the wordmark**.」← **辅助元素 + 必须贴近**
- 🟩 间距：「The spacing between the crown and the wordmark is **3 dots**, and the dot within the wordmark is **2 dots** in width.」← **用字标内部的一个特征（圆点）当尺子**
- 🟩 留白：「The clear space area is defined by the **dot size** within our wordmark.」
- 🟩 **比例缩放双档**：标准态「Wordmark dot = 2× crown dot」；**放大态「Wordmark dot = 1× crown dot」** —— 并说明「when being used at smaller sizes such as within the app icon, the **enlarged** crown should be used to aid accessibility and legibility」
- 🟩 **最小尺寸**：wordmark **50px** / crown **16px**；「**Use the small crown version for anything below the crown's minimum size, such as web favicons.**」
  - 来源：https://brand.design-system.service.gov.uk/logo-system/logo-elements/ ｜ https://assets.publishing.service.gov.uk/media/685a8a32454906840a44d5e8/GOV.UK_brand_guidelines.pdf

> 🟩 **GOV.UK 的做法直接回答了 SiMuseor 的一个悬置问题**：辅助图形在**小尺寸时不但可以省略，还可以被「放大」**（相对字标）。SiMuseor 现有规范若沿用「蝉高 = 1.5 × cap-height」这一**固定比例**，那么在小尺寸时蝉会同步缩小到不可辨；而 GOV.UK 的做法是**小尺寸时把辅助元素相对放大**。

#### 🟩 其他可引用的间距口径

| 来源 | 间距 / 比例规则 | 原文要点 |
|---|---|---|
| **opengfx LOCKUPS** | 水平锁版：icon 左、wordmark 右、**垂直居中**；**icon–wordmark 间距 = 0.5×–1× icon 宽度**；1 unit = icon 宽 / 8；最小留白 = 2U；安全区 10%；**wordmark 宽 ≤ 1.5× icon 宽**（防失衡）；尖端图标需光学上移；密集图标需减重 | https://github.com/modbender/skill-library-mcp/blob/main/data/opengfx/references/LOCKUPS.md |
| **Evoke Studio** | 组合标间距「roughly **equal to the cap height** of the wordmark」；符号高度 ≈ **1–1.5× cap-height**（「Larger symbols risk making the mark look like a labelled icon; smaller symbols risk becoming decorative noise」） | https://madebyevoke.com/blog/combination-mark-logo-design |
| **Digital Polo** | 符号高度三选一：cap-height / x-height / 全高 ascender-to-descender，**必须选定一条并写进规范** | https://www.digitalpolo.com/combination-mark-logo |
| **SelectStar** | 留白单位 = 字标小写「l」；**组合标内星标与字标间距 = 2 个「l」**；四周留白 = 3 个「l」；<8rem 宽改用独立 logo mark，<1.5rem 只用 mark | http://www.selectstar.org/brand/logo |
| **Elemento** | 留白 = 2× logo 高度（规则版与 symbol-only 版同）；symbol 尊重区 = 1× 符号高的网格 | https://www.elemento.cloud/brand-guidelines.html |
| **scenta 案例（Chris Alexander）** | 水平锁版：火焰宽 = 字标字母 c 的宽；**icon–wordmark 间距 = 字母 t 的一半**；堆叠版：火焰高 = 2× 字标高 | http://www.chrisalexander.design/work/scenta |
| **Kukoo** | 三个版本一起交付：水平 / 堆叠 / 独立符号；X 取自 cap-height 或符号内部稳定宽度 | https://kukoocreative.com/blog/logo-lockups |
| **中国本地口径** | 「标志与文字之间的最小安全距离——通常**不小于字高的 1/2**」 | https://hajiarui.com/html/news/1418.html |

> 🟨 **推论 3.2**：业界间距口径的**共识区间是「0.5× cap-height ~ 1× cap-height」**（或等价地「0.5×–1× 符号宽度」）。SiMuseor 现行规范的 **0.5 × cap-height** 落在区间下沿 —— 偏紧但在合规内。
> 🟨 **v2 数字更正（重要）**：本报告初版使用的「cap 21px / gap 10.5px → 12px / 组合标总宽 124.3px / 占侧栏 190px 可用宽 65%」这一组数字**基于 30px 字标的旧口径，已作废**。visual-architect 复核后的现行口径为：**`.brand-wordmark { font-size: 20px }` → cap-height 14.00px、墨迹宽 65.06px；现行 gap = 10px（直接复用 `.brand` 既有 `gap:10px`，不新增 CSS 值）；组合标视觉宽 137.06px / 占位宽 162px / 占 200px 可用宽 81%**。
> 由此得出的**方法论结论不变且更明确**：① gap = 10px 与「0.5× cap 口径」一致（10 / 14 = 0.71× cap，仍在 0.5–1× 区间内）；② **占位宽已达 200px 可用宽的 81%**，比旧口径的 65% 更紧张 —— 「组合标在窄槽里 gap 最先被牺牲」的推论**被新数字强化**；③ 现行蝉高 = **2.07× cap**，已高于 Evoke 的 1–1.5× 区间上沿，**GOV.UK 的「小尺寸放大辅助图形」一档已天然满足**，无需新增规则。
> 🟨 **v2 对「gap 写死绝对值」的结论升级**：初版建议「gap 0.5×cap = 10.5px → 网格取 12px」已**不适用**（现行值本就是绝对值 10px）。修正后的建议为：**规范中同时保留「比例口径（0.5× cap，随 cap-height 同比缩放）」与「绝对值口径（20px 字标档 = gap 10px）」两条**，并明确 10px 复用自 `.brand` 既有值，避免后续实现者另立数值。
> 来源：本项目 `_phase1-logo-v2.md` §1.2 / §2.5（visual-architect 复算口径）｜ https://kukoocreative.com/blog/logo-lockups ｜ https://madebyevoke.com/blog/combination-mark-logo-design

### 3.3 高度比例关系

- 🟩 主流三档（同上表）：符号高 = cap-height / x-height / 全字高，**选一条、写死**（Digital Polo）
- 🟩 Evoke 给出的**判断区间**与理由：符号高 ≈ 1–1.5× cap-height；**过大 → 看起来像「给图标加了标签」；过小 → 沦为装饰噪音**
- 🟩 重量匹配原则：「Ensure both share the same visual weight (stroke thickness), the same **design register** (both geometric or both organic, not one of each), and similar spacing philosophy. **If they look like they're from different designers, they probably need to be redesigned** with the relationship in mind.」
  - 来源：https://madebyevoke.com/blog/combination-mark-logo-design

> 🟨 **推论 3.3（重要张力）**：SiMuseor 的**字标是「窄体衬线感」（Barlow Condensed 400）+ 单色墨黑**，而蝉形是**高饱和渐变 + 低多边形分面**。按 Evoke 的「design register 一致性」判据，这两者**不在同一视觉语域**（几何 vs 衬线；彩色 vs 单色）。这不是错误 —— 大量成熟品牌正是用「单色字标 + 彩色图形」（Slack 彩色井号 + 黑色字、Google 彩色 G + 黑色字标、Adobe 红色 Fi + 黑色 Adobe 字标）。但它要求**「辅助」的量化必须成立**，否则观感会滑向 Evoke 说的「labelled icon」。SiMuseor 现行 M-2「蝉形着色面积 ≤ 组合标包围盒 20%（实测 11.9%）」正是这条量化，值得保留。

### 3.4 可引用的权威规范清单

| 规范 | 机构 | 网址 |
|---|---|---|
| **GOV.UK Brand Guidelines** | 英国政府数字服务 | https://brand.design-system.service.gov.uk/logo-system/logo-elements/ ｜ https://brand.design-system.service.gov.uk/logo-system/brand-hierarchy |
| **Slack Brand Guidelines (PDF)** | Slack / Pentagram | https://a.slack-edge.com/3f2ae/marketing/img/media-kit/Slack-Brand-Guidelines.pdf |
| **Cursor brand guidelines** | Cursor | https://cursor.com/zh/brand |
| **Elemento brand guidelines** | Elemento | https://www.elemento.cloud/brand-guidelines.html |
| **SelectStar logo guidelines** | SelectStar | http://www.selectstar.org/brand/logo |
| **Logo Design Love — 品牌风格指南合集** | Logo Design Love（收录 NASA / GOV.UK / Mozilla / IEEE / MasterCard / Cisco / Dropbox 等 50+ 官方指南） | https://www.logodesignlove.com/brand-identity-style-guides |
| **opengfx LOCKUPS 规范** | 开源 | https://github.com/modbender/skill-library-mcp/blob/main/data/opengfx/references/LOCKUPS.md |
| **Nixa Missouri Brand Identity Style Guide (PDF)** | 密苏里州 | https://www.nixa.com/wp-content/uploads/2023/08/Nixa-Brand-Standards-07242022.pdf |

---

## 4. favicon 与品牌主标的关系

### 4.1 业界 favicon 常用主标的哪个状态

#### 🟩 四层响应式阶梯（目前最系统的公开表述）
Brainy 的四级模型：
| 层 | 通用名 | 典型尺寸 | 内容 |
|---|---|---|---|
| 1 | Full lockup | 200px+ / 印刷 / 招牌 | 标记 + 字标 + 标语 |
| 2 | Primary mark | 80–300px | 标记 + 字标 |
| 3 | Simplified mark | 32–80px | 简化标记单独或配缩写 |
| 4 | **Monogram / favicon** | **16–32px** | **单字符 / 字形 / 几何精简** |

- 🟩 铁律：「**The favicon is not a resize job. It is a separate design artifact that borrows the brand's color and proportion, nothing else.**」
- 🟩 最常见的失败：「**The most common failure at tier four is designers sending the tier-three simplified mark to the favicon slot and hoping it works.** At 16 pixels, anything that needed 32 pixels to read is no longer readable. **The favicon needs its own design pass.**」
- 🟩 减重四法：drop hairlines / increase counter spacing / simplify curves / **prefer mass over outline**
  - 来源：https://brainy.ink/paper/responsive-logo-systems ｜ https://brainy.ink/paper/glossary/logo-simplification-rules

#### 🟩 七家标杆的 tier-4 做法
- 🟩 **Google**：G favicon 是「a perfect geometric reduction of the full wordmark's color logic… **It reads at 16 pixels because it was designed for 16 pixels**, not derived from the wordmark by someone who needed an icon by Friday.」
- 🟩 **Mailchimp**：Freddie（黑猩猩吉祥物）→ 只保留头部裁切，去掉身体与帽子细节，「keeps only the features readable in a 32×32 grid」
- 🟩 **Slack**：旧 11 色井号在深色背景浑浊、印刷需严格色彩管理 → 新 4 色 4 形几何，「**stays crisp from 16 pixels to billboard**」
- 🟩 **Notion**：N 字形作为单字重图标
- 🟩 **Vercel**：纯几何三角，「**It is impossible to break at small sizes because it has no breakable components.**」
- 🟩 **Linear**：L 标，无发丝线、无易闭合字腔、曲线已简化
- 🟩 **Stripe**：字标即标记，S 字形本身足够重
  - 来源：https://brainy.ink/paper/responsive-logo-systems
- 🟩 失败侧：**Hilton** 盾形标内部细排版在 < 64px 完全崩坏且**官方无简化版**；**FedEx** 的负空间箭头无法简化，favicon 实际就是字标
  - 来源：https://brainy.ink/paper/glossary/logo-simplification-rules

#### 🟩 favicon 具体尺寸规范（可直接抄）
- 🟩 **16×16**：只能看主要轮廓；不依赖文字或细节；「no stroke or gap thinner than **2 pixels**」；counters 需 **≥ 2px** 间隙；剪影应占约 **14×14** 像素
- 🟩 **32×32**：可呈现稍多细节，但**仍应避免过细笔画**；「no stroke thinner than **3 pixels**」
- 🟩 **48×48**：可作为搜索结果与高密度屏幕的基本版本
- 🟩 **180×180**（apple-touch-icon）：需考虑 iOS 圆角裁切，**画布内保留约 80% 内容**
- 🟩 **512×512**（manifest）：可保留较完整图形；**maskable 安全区为中心 409×409**
- 🟩 交付清单（2026 最小集，Evil Martians 方案）：`favicon.ico`（32×32 兜底，含 16/32/48）+ `favicon.svg`（现代浏览器首选，可内嵌深色模式）+ `apple-touch-icon.png` 180×180 + manifest 的 192×192 与 512×512 + 可选 `icon-mask.png` 512×512（maskable）
  - 来源：https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs ｜ https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/ ｜ https://madevisualstudio.com/?p=333 ｜ https://bytepane.com/blog/favicon-generator/
- 🟩 **iOS 会把 apple-touch-icon 的透明区填成黑色** → apple-touch-icon 必须不透明
  - 来源：https://kukoocreative.com/blog/favicon-size ｜ https://www.ilovedevtool.com/zh-TW/blog/icon-generator-guide

### 4.2 「favicon 单独用图形、主标用字标」这一分离式策略的案例与优劣

#### 🟩 支持该策略的案例
- 🟩 **Google**（G favicon / Google 字标分开）、**Mailchimp**（Freddie / Cavendish wordmark，「The full Cavendish wordmark never appears below tier two」）、**Slack**（井号 / slack 字标）、**Notion**（N / Notion）、**Vercel**（△ / Vercel）、**Linear**（L / Linear）、**Stripe**（S / Stripe）
- 🟩 **Starbucks 2011 移除环形文字**（驱动力是数字可读性）：「The text inside the circular border was unreadable at app-icon, favicon, and small social-avatar sizes — exactly the surfaces growing in importance as mobile use rose. **Starbucks had enough brand recognition by 2011** that the wordmark wasn't necessary inside the emblem」
- 🟩 **Mastercard 2019**、**Volkswagen 2019 扁平化**、**Kia 2021** 同属「符号脱离文字独立行走」浪潮
  - 来源：https://www.digitalpolo.com/what-is-an-emblem-logo ｜ https://en.wilogo.com/blog/logo-starbucks-sirene-medievale-cercle-vert-histoire ｜ https://businessfig.com/the-quiet-business-logic-behind-the-flat-logo-wave/

#### 🟩 该策略的**前提条件**（关键风险）
- 🟩 「**Never symbol only when the brand is new.** A startup that uses its symbol alone before the brand has built any recognition is **gambling** that customers will make the association without being told the name. **Always lead with the combination mark** until the brand has significant market recognition.」
  - 来源：https://madebyevoke.com/blog/combination-mark-logo-design
- 🟩 「A standalone symbol communicates nothing about the name on first exposure… **A symbol-first strategy requires sustained exposure and marketing investment before it pays off**, and abandoning it halfway through that investment… wastes the exposure investment already spent.」
- 🟩 「New brands that try to launch as symbol-only typically **fail to break through the recognition barrier and end up adding their wordmark back** into the primary lockup.」
- 🟩 「Adopting a combination mark and immediately treating the symbol as interchangeable with the full mark, before sufficient exposure has actually built that association, is **the same mistake as jumping straight to symbol-only, just with an extra step**.」
  - 来源：https://nouralhamwi.com/journal/wordmark-vs-symbol-what-actually-determines-which-a-brand-needs ｜ https://github.com/rampstackco/claude-skills/blob/main/skills/logo-design/references/architectures-explained.md
- 🟩 Starbucks 案例的适用边界被明确限定：「**A brand without 30+ years of recognition can't make the move Starbucks made.**」
  - 来源：https://www.digitalpolo.com/what-is-an-emblem-logo

> 🟨 **推论 4.1（重要）**：SiMuseor 的现状 —— **主标 = 字标主导的组合标；favicon = 单独蝉形** —— 正是「分离式品牌策略」。按上述业界共识，**这条策略只有在符号本身已被充分认知后才安全**。SiMuseor 是新品牌（字标基线刚冻结，无既有资产积累），因此：
> 🟨 **(a)** 蝉形单独出现在 favicon 是**业界标准做法且必要**（favicon 位没有空间放字标，这是所有品牌的共识做法，非 SiMuseor 特有风险）；
> 🟨 **(b)** 但这意味着**蝉形必须自带可识别性**，不能依赖字标在旁边解释它 —— 这就把 §2.3 的小尺寸可读性问题从「加分项」升级为**「生死线」**；
> 🟨 **(c)** **真正的风险不在 favicon，而在于「蝉形单独出现」这个权限一旦开闸，就会外溢**。业界反复警告的「symbol-first 陷阱」正是在品牌尚未积累认知时过早给符号独立性。**建议在 VIS 规范中明确写入「蝉形单独出现仅限 favicon / app icon / 平台图标等无法容纳文字的技术位」的白名单**，并禁止其在品牌传播型物料（分享卡、hero、海报）中单独使用 —— 这与团队现有裁决「产品其他位暂不接入」方向一致，但把它从「暂不接入」升级为**「有条件的原则 + 白名单」**，防止后续被随意突破。

#### 🟩 关于「favicon 是否可以动」
- 🟩 动画 favicon 支持度不一致：「GIF and animated SVG behavior varies across browsers, so do not depend on continuous playback」；「saved bookmarks or home-screen icons may capture only one frame」
- 🟩 建议：「**Ship a strong static icon first.**」
  - 来源：https://favicon.now/guides/animated-favicon ｜ https://imgconvert.cloud/blog/animated-favicon-guide
- 🟩 与团队现行裁决一致：「favicon 不参与动效（浏览器不播放 SVG 动画作为 favicon 的通用行为）」

### 4.3 深色主题 favicon 的行业解法

- 🟩 「The SVG favicon's `@media (prefers-color-scheme: dark)` support allows serving a light-background version for light mode and a dark-background version for dark mode **in a single file - the only format that solves this problem elegantly**.」
  - 来源：https://utilokit.com/vi/tools/favicon-generator
- 🟩 「SVG favicons support CSS `@media` queries including `prefers-color-scheme`, making them the only favicon format with **true automatic dark mode support**」（Chrome 89+ / Firefox 86+ / Safari 15+）
  - 来源：https://bytepane.com/blog/favicon-generator/
- 🟩 Google 官方的自适应 favicon 教程（web.dev）：在 SVG 内部写 `<style>`，用 `@media (prefers-color-scheme: dark)` 切换填充色
  - 来源：https://web.dev/patterns/components/svg-favicon ｜ https://web.developers.google.cn/building-an-adaptive-favicon
- 🟩 反例警戒：「If you have a favicon that is a black shape with a transparent background, it will disappear on a dark browser tab.」→ 加白色描边或加实色容器
  - 来源：https://logoaitool.com?p=1995/
- 🟩 「SVG favicons 在 Chromium 下以 secure static mode 绘制，因此**不能有 web font、外链图片或脚本**」
  - 来源：https://dev.to/usman_basheers/making-a-favicon-from-an-svg-measured-what-breaks-at-16-pixels-16om

---

## 5. 对 SiMuseor 的具体启示（5 条可落规范的建议）

> 每条标注来源编号。🟩 = 有来源支撑的规则，🟨 = 我的具体取值建议（取值基于来源规则 + SiMuseor 现有实测数据）。

---

### 建议 1 ｜ favicon 必须是**独立重画**的降级资产，不是渐变版的缩放

**依据**：§2.3（低多边形 < 32px 糊成泥块）、§4.1（tier-4 是独立设计资产，非 tier-3 缩放）、§2.2 Inkyy 原则 5（每个低多边形 logo 都要从第一天配 flat 版本）

**具体动作**：
1. **不能直接用现有 MIN 帧**（品红→橙渐变 + 发丝接缝线）。团队实测已证明：接缝线在 16/32/48px 分别为 **0.021 / 0.042 / 0.062px**，全部「invisible below 1px」；渐变在 16×16 的 256 个像素里会「average into a single dull tone」。
2. **裁切而非缩放**：取 MIN 帧**头部 + 触角 + 肩**的紧凑剪影（团队已做过「方形头胸版」方向，方向正确，但需**去掉渐变**、**去掉接缝线**），重绘为：
   - **单色剪影 + 实色容器**：底色用一个品牌纯色（plum `#4b0350` 或 magenta `#c31d72`），蝉形用白/纸墨色实心挖空 —— 这是「最可靠的 favicon 模式」，保证在浅/深标签栏都有对比，且定义出清晰外轮廓
   - 颜色数 ≤ 2，**零渐变**
3. **验收三连测**：① 纯黑剪影 16px 可辨；② 16px 在白底 / `#111` 底 / 浏览器标签底色三处均清晰；③ 灰度下仍可辨

**🟨 取值**：容器 16×16 内图形占 **14×14px**（行业口径）；封顶 2 色；不得有任何 < 1px 的线。

---

### 建议 2 ｜ 组合标排布**维持现状**，但把 gap 与高度写成「X 倍数 + 具体像素」双轨，并借鉴 GOV.UK 加一档「小尺寸放大辅助图形」

**依据**：§3.1（图形在左是默认，重量方向 heavy→light 强化字标主导）、§3.2（GOV.UK 用 3 dots、SelectStar 用 2 个「l」、opengfx 用 0.5–1× icon 宽）、§3.3（Evoke：符号高 1–1.5× cap-height）

**具体动作**：
1. **保留**「蝉形在左、字标在右」—— 与西方惯例一致，且视线终点落在字标，与「字标是主视觉」自洽（§3.1）。**影视案例佐证**：Huhu Studios 的甲虫同样位于字标左侧（§1.4）。
2. **保留**「蝉高 = 1.5 × cap-height」—— 落在 Evoke 的 1–1.5× 区间上沿，且能保证蝉形本身 ≥ 32px 可辨下限。
   - ⚠️ **v2 数字更正**：visual-architect 复核后的现行值为**蝉高 2.07× cap**（已高于区间上沿），**维持现状即可，无需改动**。初版建议的「1.75–2× cap」小尺寸放大档**已天然满足**。
3. **保留**「gap = 0.5 × cap-height」—— 落在业界 0.5–1× 区间下沿；但**必须在规范里同时写死绝对值**。
   - ⚠️ **v2 数字更正**：现行 gap 已是绝对值 **10px**（复用 `.brand` 既有 `gap:10px`），且 10 / 14px cap = **0.71× cap**，仍在区间内。**规范应写成「比例 + 绝对值」双轨**：比例口径 0.5× cap（随 cap-height 同比缩放）+ 绝对值口径（20px 字标档 = 10px）。
   - 理由（§3.2 推论）：组合标占位宽已达 200px 可用宽的 **81%**，窄槽里 gap 最先被牺牲，只写比例会导致不同实现者各自换算。
4. **🟨 新增一档（借鉴 GOV.UK）**：当组合标整体宽度逼近 120px 下限时，**蝉形相对放大**（如从 1.5× cap 提到 1.75–2× cap），而非等比缩小。GOV.UK 的原话是「when being used at smaller sizes such as within the app icon, the **enlarged** crown should be used to aid accessibility and legibility」—— 这直接回应了「辅助图形在小尺寸时该不该一起缩」的经典两难。
   - ⚠️ **v2 状态**：因现行蝉高已是 2.07× cap，此档**已天然满足**，本条从「新增规则」降级为「**写进规范时明确标注『小尺寸下蝉形相对放大而非等比缩小』这一意图**」，以免后续实现者误按等比缩放。

---

### 建议 3 ｜ 补齐 **mono（单色）版** 与 **深色主题独立资产**，favicon 深浅两版用 SVG `prefers-color-scheme` 单文件承载

**依据**：§4.3（SVG 是唯一支持真深色模式的 favicon 格式）、§4.1（组合标必须能单色存活）、§2.3 失效模式四（颜色依赖失效）、§1.2 Firefly 反例（品牌色只在图标系统里）

**具体动作**：
1. **mono 版**：交付「蝉形纯墨黑 / 纯白」两枚单色资产。理由（§2.3）：「If it only works in the brand gradient it will fail on an embroidered shirt, a stamp, a fax and half the places it ends up」。组合标必须能整体转单色存活 —— 这是「品牌资产完整性」的底线。
2. **深色主题**：团队现有裁决「不用 `filter: invert()`、深色主题必须独立重新配色资产」**正确且与业界一致**（SiMuseor 的品红↔青绿翻转会把「品红→橙」的暖色语义整体反转，业界同理回避：Slack 的 11 色方案「suffered against any background color other than white」而重做）。**建议在此基础上补一条**：深色版的品红极需按 §4.3 的「重画而非翻转」原则单独调色（团队已测出 plum 极在深底 `#15151a` 上仅 **1.25:1**，远低于 3:1 门槛；已算出的达标档是 `#a3389c` / `#b04aa8` —— **建议深色版把 plum 极直接定为 `#a3389c`，而不是原色**）。
3. **favicon 深浅两版**：用**一个** `favicon.svg`，内部 `@media (prefers-color-scheme: dark)` 切换底色/图形色；同时保留 `favicon.ico`(32) 兜底 + `apple-touch-icon.png` 180（**必须不透明**，iOS 会把透明填黑）+ manifest 192/512 + 可选 maskable（安全区 409×409）。
   - ⚠️ **SVG favicon 内的 CSS 必须是内联 `<style>`，不能有外链字体/图片/脚本**（Chromium secure static mode）。

---

### 建议 4 ｜ 把「白色发丝接缝线」**降级为 ≥64px 的大尺寸层特征**，并在小尺寸层改用「面片色差」承载低多边形识别

**依据**：§2.4（白色发丝线在业界低多边形标识中几无先例；Inkyy 16 例中白色只以大块面片出现）、§2.3（发丝线 < 1px 归零的物理规律）、§2.2 论文的「渐变应在面片之间而非面片内部」

**具体动作**：
1. **在 VIS 中显式分层**（这是本调研最有价值的一条结构性建议）：

   | 层 | 尺寸 | 图形表现 | 接缝线 | 渐变 |
   |---|---|---|---|---|
   | **L1 大尺寸层** | ≥ 64px | 完整低多边形 | ✅ 保留发丝线 | ✅ 保留 plum→orange |
   | **L2 中尺寸层** | 32–64px | 完整低多边形，**加粗接缝线** | ⚠️ 线宽加粗到目标尺寸 ≥ 2px | ⚠️ 可保留但需验证面片色差仍可辨 |
   | **L3 favicon 层** | 16–32px | **重绘的单色剪影 + 实色容器** | ❌ 去除 | ❌ 去除 |

2. **「面片色差承载识别」**是替代方案：低多边形的识别感来自**面片之间的明度/色相差**，而不是白线。团队已测出完整色阶（plum `#4b0350` → 品红 `#c31d72` → 橙红 `#f04c3e`），在 L2 档应验证「相邻面片色差 ≥ 一个可见级差」，若不足则**调整面片分色**而非加粗线条。
3. **同时删掉一条现行禁令**的适用性：团队 v2.0 禁用项里有「不得改接缝线宽比例」。若采纳本建议 L2 层的「加粗接缝线」，**该禁令需要按尺寸分层豁免** —— 否则规范自相矛盾。

---

### 建议 5 ｜ 做一次**商标近似与语义占位检索**，重点排查「蝉镜 AI」及 Apache Ant 的品红紫撞色

**依据**：§1.1（蝉镜 AI 实测 favicon `#ff5a25` 橙红 + 抽象环标）、§1.2（Apache Ant `#A81C7D` 品红紫，与 SiMuseor 品红主调 `#c31d72` 同域）、§1.3（CICADA 3301 商标历史与语义先占）

> ⚠️ **v2 更新**：本建议的**品类冲突判定已随定位变更而改变**。初版按旧定位（「AIGC 模型社区 / 创作工作台」）判为「正面同赛道、最高优先级」；**新定位（剧集（电影）AI 导演台）下品类不重叠**，用户已裁决解除 P0。本条**降级为「留档 + 常设监控」**，具体见 §6.1。

**具体动作**：
1. ~~**品类冲突排查（最高优先级）**~~ → **v2 状态：已解除。** 用户 2026-11-13 裁决：**蝉形保留，不做任何更改**，理由：品类不重叠（蝉镜 = 数字人营销 / 一站式内容生产；司梦 = 剧集（电影）AI 导演台）+ 命名不冲突（司梦 ≠ 蝉镜）。**风险事实仍留档**（色相差 9.9°、对比度 1.16:1），转为**常设监控项**。
2. **色域撞色（仍有效）**：SiMuseor 的品红主调 `#c31d72` 与 Apache Ant 官方色 `#A81C7D`（同属 magenta/plum 域，色相接近）构成「开发者工具 + 品红 + 昆虫」的**视觉联想撞车**。而 Apache Ant 恰是 Java 构建工具的经典标识 —— 目标受众（AI 开发者）对此高度敏感。**建议：在 VIS 中明确记录「本品牌昆虫标的色相锚点位于 orange 侧而非 plum 侧」的语义理由**，把 plum 限定为渐变暗端而非主识别色。
   - ✅ visual-architect 已采纳并写入规范 §4.4「色相锚点记录」，并加了一条限定：**这是语义约定、不是视觉改动**（用户已拍板蝉形保留原样 `#4b0350 → #f04c3e` 全链路不动），只约束将来另出色板 / 家族色编码时的锚点选择。
   - ⚠️ visual-architect 复算后**修正了我的一处口径**：plum 仅占主体 **5.8%**，属暗部点缀色而非主导色（我报告初版的判断偏乐观）。**这反而强化了本条建议** —— 把色相锚点定在 orange 侧的理由更充分。
3. **语义规避**：文案与物料中禁用「蝉噪 / 蛙鸣蝉噪 / 寒蝉凄切 / 噤若寒蝉」联想（§1.3 有实据的贬义）；改用「金蝉脱壳 / 一鸣惊人 / 居高声自远」一线。视觉上**避免黑色剪影 + 加密感 + 神秘符号**这一 Cicada 3301 语汇。
   - ⚠️ **v2 强化**：新定位是「导演台」——**声音是影视生产的核心对象**，因此「蝉鸣」在语义上从「气质不搭」升级为**语义安全线**（§1.4 推论 1.5）。
   - ✅ **v2 新增一条（用户明确，须写死）**：**禁止「蝉 = 梦」类文案**（如「让梦成蝉」「蝉梦」）—— 用户明确「我们是司梦，不是蝉」。品牌名与图形是两个独立命题，强行等同会造成「名字被图形吃掉」的反向风险。
4. **补充一项业界自律**：查询 `SiMuseor` / `司梦` 在开发者、影视制作与 AIGC 场景的实际使用情况（本次检索未发现同名在用产品，但未做完整的商标数据库检索 —— 这一步需专业代理）。
   - **v2 检索关键词应更新**：从「AI 创作 / 数字人 / 内容平台」扩展到「**影视 / 剧集 / 分镜 / 预演 / 剪辑 / AI 导演 / 影视工业化**」—— 这才是新定位真正的占位战场。

---

### 附：建议之外的两个「低成本高回报」补充项

- 🟩 **组合标需交付「三锁版」**（水平 / 堆叠 / 独立符号），且**一次委托、同时交付**（Kukoo：「Commission all three versions together… Most brands need at least two lockup variations from day one, because no single layout fits every space」）。SiMuseor 现行裁决「竖版 stacked 当前不采用」——建议改为「**当前不启用，但作为资产储备随主资产一同冻结**」，避免将来为单一场景重开标识设计。
  - 来源：https://kukoocreative.com/blog/logo-lockups
- 🟩 **最小尺寸表**应覆盖四层：组合标最小总宽（现 120px）/ 字标最小宽 / 蝉形最小高 / favicon 最小。GOV.UK 给出的是「wordmark 50px / crown 16px，**低于 crown 最小宽时改用 small crown 版本**」的成对写法，可直接对标为「组合标最小总宽 120px / 蝉形最小高 32px，**低于则改用 favicon 剪影版**」。
  - 来源：https://brand.design-system.service.gov.uk/logo-system/logo-elements/

---

## 6. 风险清单（按优先级）

> **v2 说明**：品类定位已由「AIGC 模型社区 / 创作工作台」变更为「**剧集（电影）AI 导演台**」。下表 P0-2 条的**判定基准随定位变更而变化**，处置见 §6.1。其余各条**不受定位变更影响**。

| 优先级 | 风险 | 依据 | 缓解 |
|---|---|---|---|
| **P0** | **白色发丝接缝线在 favicon 尺寸归零** —— 团队实测 16px 时仅 0.021px。图形最重要的识别特征在 favicon 位完全不存在 | §2.3；团队 `favicon-legibility.png` | 建议 4：L3 层重绘单色剪影 |
| ~~**P0**~~ → **已解除（转监控）** | ~~「蝉镜 AI」在中文 AI 创作赛道已占位，且 favicon 主色 `#ff5a25` 与 SiMuseor 橙色极同域~~ —— **风险事实仍成立，但 v2 定位下品类不重叠，用户裁决解除** | §1.1（我实测采样）；§6.1 | 留档 + 常设监控；色域邻近转为 §4.4 色相锚点约束 |
| **P1** | **品红主调 `#c31d72` 与 Apache Ant `#A81C7D` 同域**，目标受众（开发者）对 Apache 生态高度敏感 | §1.2 | 建议 5：把 orange 定为识别色锚，plum 限定为暗端 ✅ 已落规范 §4.4 |
| **P1** | 低多边形 + 渐变在 < 32px 必然糊成泥块（低多边形 logo 的第一大陷阱） | §2.3（Inkyy 明文） | 建议 1：flat fallback ✅ 已落规范 §5.3b L3 |
| **P2** | 组合标视觉语域不一致（几何分面彩色图形 vs 窄体衬线感单色字标） | §3.3（Evoke design register 判据） | 保留 M-2「蝉形着色面积 ≤ 20%」的量化约束 |
| **P2** | 「蝉噪」类贬义联想在中文语境有实据 | §1.3；§1.4 推论 1.5 | 建议 5：文案层规避；v2 上升为语义安全线 |
| **P3** | 深色底 plum 极对比度仅 1.25:1 | 团队实测（§建议 3） | 深色版 plum 极改用 `#a3389c` |

---

## 6.1 定位变更对竞品判定的影响（v2 处置记录）

**变更事实**：品类定位由「AIGC 模型社区 / 创作工作台」变更为「**剧集（电影）AI 导演台**」；品牌中文名 **司梦**。

### 🟩 三件事分别留痕（事实 / 裁决 / 前提）

**① 风险事实（如实记录，不因裁决而抹去）**
- 🟩 蝉镜 AI（chanjing.cc）favicon 主色实测 `#ff5a25`，与 SiMuseor 橙色极 `#f04c3e` 色相差 **9.9°**、对比度 **1.16:1**
- 🟩 蝉镜定位为「一站式 AI 内容创作工作台」（数字人视频、AI 创作、无限画布、智能拉片、PPT/PDF 转视频）
- 🟩 该事实**源于旧定位下的「正面同赛道」判定**，判定本身随定位变更而失效，但色域邻近与心智占位**作为事实继续有效**
- 来源：http://www.chanjing.cc/ ｜ https://doc.chanjing.cc/help-center/

**② 用户裁决（2026-11-13）**
- **蝉形保留，不做任何更改。** 理由：品类不重叠（蝉镜 = 数字人营销 / 一站式内容生产；司梦 = 剧集（电影）AI 导演台）+ 命名不冲突（司梦 ≠ 蝉镜）

**③ 解除理由与前提声明（须写入规范，避免后续被误引）**
- ✅ **「P0 风险解除」这一结论依赖「剧集（电影）AI 导演台」这一定位成立。若品类定义回退为通用 AI 创作平台，理由①即刻失效，结论必须重新评估。**
- ✅ 解除的是**品类冲突**这一项，**不是**色域邻近这一项 —— 后者已转为 §4.4「色相锚点记录」这一**常设约束**继续生效

### 🟨 推论 6.1：新定位反而**降低**了竞品与语义风险的整体水位
- **品类距离更远**：旧定位（通用 AIGC 创作平台）与蝉镜（通用 AI 内容创作）正面重叠；新定位（影视 / 剧集专业工具）与蝉镜的用户群、场景、核心任务都不同 —— 同名同图形的「心智冲突」概率显著下降。
- **语义冲突更远**：CICADA 3301 绑定的是「解密 / 神秘 / 黑客」，旧定位（开发者工具平台）离这个语汇更近；新定位（影视工业）离它更远。
- **竞争参照系换了**：新定位真正的占位战场是**「影视 / 剧集 / 分镜 / 预演 / AI 导演 / 影视工业化」**这一片，而非「AI 创作平台」。**建议把后续商标与产品名检索的关键词整体切换到这片战场**（建议 5 第 4 条已据此更新）。
- **新增的正向论证**：新定位与既有影视机构的昆虫标实践**同频**（§1.4 的 Wētā / Dragonfly / Huhu / OVO 四例），品牌合法性与叙事说服力**同时增强**。

---

## 7. 附录：来源索引

**影视 / 动画 / 舞台语境中的蝉与昆虫（v2 新增）**
- 电影《蝉衣》：https://m.toutiao.com/article/7687294810297762346 ｜ https://yy.voc.com.cn/news/202609/33860774.html
- 动画短片《663114》：http://madfilm.org/review-663114-at-rooftop-cinema-fri-jun-30-930pm/
- 电影《Cicada》(2015)：https://stage.asamnews.com/2015/03/12/review-cicada-is-visually-awe-inspiring-emotionally-inspirational/
- 定格动画《Cicada》(Swoon, 2020)：https://swoonstudio.org/projects-1#/swimming-cities-of-serenissima/ ｜ https://www.turnercarrollgallery.com/?p=61044
- 电影《Silence》与蝉的叙事结构：https://linnetmoss.com/2017/01/12/shusaku-endos-silence-on-page-and-screen
- Wētā Workshop / Wētā FX：https://wiki.teamfortress.com/wiki/Weta_Workshop/zh-hans ｜ https://news.ifeng.com/c/7fbCDwQf4lz ｜ https://en.namu.wiki/w/W%C4%93t%C4%81%20FX
- Cirque du Soleil《OVO》：https://wiki2.org/en/Ovo_(Cirque_du_Soleil) ｜ https://www.designingsound.com/project/ovo
- Dragonfly Film and Television：https://avid.miraheze.org/Dragonfly?oldid=1481425
- Cheyenne Enterprises：https://avid.miraheze.org/Cheyenne_Enterprises
- Huhu Studios：https://avid.miraheze.org/Huhu_Studios
- Kestrop Studio（蝉标）：https://kateestrop.com?p=87/
- 歌剧《Imago》品牌：https://www.toopstudio.com/portfolio/glyndebourne-imago-identity/
- 《Cats》音乐剧 logo 方法论：https://nypost.com/2016/08/02/thanks-to-cats-theater-souvenirs-are-now-and-forever/ ｜ https://www.wikiwand.com/en/Cats_(Musical)

**蝉 / 昆虫标识**
- Cicada Hui A' Design Award：https://designers.org/134386
- CICADA Branding (Behance)：https://be.net/gallery/242096259/CICADA-Branding
- Cicada8 (Utter Design)：https://utter.design/project/cicada8
- 蝉镜 AI：http://www.chanjing.cc/ ｜ https://doc.chanjing.cc/help-center/- Apache Ant：https://iconcreator.co/icons/brands/apacheant
- Apache Hive：https://hive.apache.org/
- MantisBT：https://mantisbt.org/manual/
- Ant Design：https://ant.design/
- IBM BeeAI：https://www.ibm.com/think/news/beeai-open-source-multiagent
- CloudBees：https://the-brandidentity.com/project/seeing-the-unseen-mottos-luminous-rebrand-for-cloudbees-finds-inspiration-in-the-vision-of-bees
- KDAN：https://www.kdan.com/blog/kdan-rebranding-2024-2
- Adobe Firefly：https://logo-index.com/software/adobe-firefly ｜ https://devicons.io/icons/adobe-firefly
- 技术圈动物图鉴：https://csdnnews.blog.csdn.net/article/details/112386559 ｜ https://m.bilibili.com/opus/479774643267889523
- Cicada 3301 商标：https://www.trademarkia.com/cicada-3301-87913185 ｜ https://trademarks.justia.com/879/13/cicada-87913185.html
- Cicada3301 勒索软件：https://hackread.com/cicada3301-ransomware-french-peugeot-dealership/

**蝉的文化语义**
- https://www.dcmp.org/media/15361-emily-graslie-s-art-lab-cicada-mania
- https://www.knowmastery.com/cicada-symbolism
- https://iere.org/what-do-cicadas-symbolize
- https://speritualmeaning.com?p=391/
- https://globalmeaninglibrary.com/animals/cicada
- https://wh.rednet.cn/m/content/646742/75/13004789.html（五月鸣蜩）
- http://paper.lqnews.cn/html/2014-10/29/content_6_2.htm（不容小觑的蝉）
- https://www.toutiao.com/article/6326760437392539906/
- https://h5detail.yiyouliao.com/rivers/newsfeed/1536235174142947329/ID3G5VC6DHQF0H1.html
- 蝉噪贬义：https://www.hao86.com/ciyu_view_9bf2b043ac9bf2b0/ ｜ https://www.guoxuedashi.com/dangu/67032x/ ｜ http://suinian.com/book/1884/1217461.html

**低多边形**
- 郭姝宏、段嵘《低多边形风格动态图形在电商品牌中的应用》https://pdf.hanspub.org/ecl_2315074.pdf
- https://www.inkyy.com/low-poly-logo-design
- https://chrislemke.github.io/website_designs/designs/Low_Poly.html
- https://www.designstylebook.com/graphic-design/low-poly
- https://polylusion.com/blog/low-poly-art
- https://edittheimage.app/?p=1784/（crystallize / wireframe stroke）
- https://graphicdesign.stackexchange.com/posts/comments/132147（Facets / Crystals 术语）

**小尺寸可读性 / favicon**
- https://brainy.ink/paper/responsive-logo-systems
- https://brainy.ink/paper/glossary/logo-simplification-rules
- https://utilokit.com/vi/tools/favicon-generator
- https://www.brandedwebdesign.com/favicon-design-size-format-and-7-rules-for-a-logo-that-works-at-16px/
- https://www.ikagency.com?p=14900/
- https://dev.to/usman_basheers/making-a-favicon-from-an-svg-measured-what-breaks-at-16-pixels-16om
- https://beconfidency.agency/insights/logo-for-small-sizes
- https://www.pongo.com.tw/favicon-logo-simplification
- https://www.pixelcake.com.tw/posts/website-icon-favicon-design
- https://www.ilovedevtool.com/zh-TW/blog/icon-generator-guide
- https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs
- https://bytepane.com/blog/favicon-generator/
- https://madevisualstudio.com/?p=333
- https://kukoocreative.com/blog/favicon-size
- https://square.pov.town/blog/favicon-design-tips-16px
- https://web.dev/patterns/components/svg-favicon ｜ https://web.developers.google.cn/building-an-adaptive-favicon
- https://www.3wen.cn/jijianbiaozhibushiyuexiaoyuehao.html
- https://imgconvert.cloud/blog/animated-favicon-guide ｜ https://favicon.now/guides/animated-favicon

**组合标 / 排布规范**
- https://kukoocreative.com/blog/logo-lockups
- https://unfold.co/journal/logomark-layout-proportions ｜ https://medium.com/unfoldco/logomark-on-the-right-…
- https://madebyevoke.com/blog/combination-mark-logo-design
- https://www.digitalpolo.com/combination-mark-logo ｜ https://www.digitalpolo.com/what-is-an-emblem-logo
- https://brand.design-system.service.gov.uk/logo-system/logo-elements/ ｜ /brand-hierarchy
- https://a.slack-edge.com/3f2ae/marketing/img/media-kit/Slack-Brand-Guidelines.pdf
- https://www.pentagram.com/work/slack
- http://www.selectstar.org/brand/logo
- https://www.elemento.cloud/brand-guidelines.html
- http://www.chrisalexander.design/work/scenta
- https://github.com/modbender/skill-library-mcp/blob/main/data/opengfx/references/LOCKUPS.md
- https://www.logodesignlove.com/brand-identity-style-guides
- https://nouralhamwi.com/journal/wordmark-vs-symbol-what-actually-determines-which-a-brand-needs
- https://logosystems.app/blog/wordmark-vs-symbol
- https://helion360.com/blog/what-professional-logo-design-actually-requires
- https://luxbranding.co.uk/what-logo-versions-do-i-need
- https://velocity-wear.com/blogs/building-a-brand-style-guide-for-apparel
- https://hajiarui.com/html/news/1418.html

**换标失败案例**
- https://www.studiokalex.com/blog/rebrand-backlash-how-to-rebrand-without-losing-customers
- https://graphicfolks.com/blog/iconic-logo-design-fails
- https://hillsdalecollegian.com/?p=9004111222238267
- https://businessfig.com/the-quiet-business-logic-behind-the-flat-logo-wave/
- https://onlykutts.com/2024/11/26/will-too-much-minimalism-kill-brands/
- https://marketingmind.in/when-rebranding-goes-too-far-strips-the-soul-of-a-brand/

**其他**
- WCAG 1.4.11 非文本对比：https://www.w3.org/TR/2017/WD-WCAG21-20170728 ｜ https://alphagov.github.io/guide-to-wcag/sc/1.4.11.html
- Okta / Unity 品牌剖析：https://brandkit.pro/brand/okta ｜ https://brandkit.pro/brand/unity
- MYOB 重塑：https://worldbranddesign.com/peter-borg-studio-redefines-the-identity-of-myob-as-a-modern-tech-platform/
- Starbucks 2011：https://en.wilogo.com/blog/logo-starbucks-sirene-medievale-cercle-vert-histoire ｜ https://www.digitalpolo.com/what-is-an-emblem-logo
