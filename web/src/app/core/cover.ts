/**
 * 兜底封面：由模型元信息生成「家族铭牌」。
 *
 * 三条原则（缺一条就会退回彩色雪花）：
 *  1. 只读稳定字段（id / name / tags / params）。下载量、点赞、更新时间一律不参与，
 *     否则同一张封面会随统计漂移，识别价值归零。
 *  2. 每个通道只绑一个字段，不做纯装饰：左上角标绑家族、大字绑家族码、
 *     规格行绑参数量与量化、右上角标绑文件形态。模型上千个，颜色只能标识「家族」，
 *     身份由字牌承担。
 *  3. 拿不到就不显示，不做估算。「参数 3B」如果是按家族常见规模猜出来的，
 *     用户会拿它跟真实文件对不上号，那比留白更糟。
 *
 * 家族标识是「槽位 + 降级」三段：
 *  - 有官方资产（public/families/{id}.svg）时填品牌标，22px 完整呈现、不裁切、不改色。
 *    这是指称性使用（用标识指代该模型家族本身），合规；但**绝不能**放大成背景水印或改配色，
 *    那会脱离指称语境变成装饰图案，也从「标识该模型」变成「用它的标装饰我们的界面」。
 *  - 没有资产时退回自绘几何标记，尺寸与位置一致，所以两种状态版式不跳。
 *  - 连自绘标记也没有（认不出家族）时，退回发布方缩写（1–3 字）：它回答的是
 *    「谁发的」，不是伪造的厂牌标，详见 publisher.ts。
 *
 * 家族色不在这里：色值写在组件里 9 个 `.f-*` 类 × 明暗两套。这里曾经有 hue / strength
 * 两个字段，但从来没人消费——颜色早就搬进 CSS 了。留着只会让后来的人以为改它有用。
 */

import { Publisher, publisherOf } from './publisher';

export type FamilyId =
  | 'flux' | 'wan' | 'sdxl' | 'sd15' | 'sd3' | 'qwen' | 'pony' | 'hunyuan' | 'ltx'
  | 'minimax' | 'krea' | 'zimage' | 'hidream' | 'ernie' | 'noobai' | 'illustrious'
  | 'chroma' | 'cogvideo' | 'kolors' | 'mochi' | 'lumina' | 'skyreels' | 'kandinsky'
  | 'playground' | 'pixart' | 'other';

export interface FamilySpec {
  id: FamilyId;
  /** 字牌上的家族码，3-4 字符，等宽显示 */
  code: string;
  /** 24×24 单路径标记，无官方资产时的降级图形 */
  mark: string;
  /** 实心还是描边 */
  filled: boolean;
  /**
   * 官方标识资产路径。放在 web/public/families/ 下，运行时按 22px 原样呈现。
   * 缺省时退回 mark 自绘图形，版式不跳。
   *
   * 接入规格（各家条款不同，逐家确认后再填）：
   *  - 用 symbol 单标，不用 wordmark：Black Forest Labs 的规范写明「symbol 可脱离字标单独使用，
   *    但仅限完整标会不可读的小尺寸」——22px 槽位正属此列。
   *  - 用官方配色，不要统一转黑白：BFL 规范只出黑/白两版，所以 Flux 用黑白；
   *    Qwen 官方是紫色，就保持紫色。实测统一转黑更糟——Qwen 的标内部镂空多，
   *    转黑后在 22px 变成黑白噪点，用官方紫才看得出六边形结构。
   *  - 深色主题另备反白版（`-dark.svg`），不要用 CSS filter 反转，那等于改色。
   *  - 不许改色、拉伸、加阴影，所以 logo 不参与家族色编码，永远保持原色。
   *  - clear space 以 symbol 描边厚度为基准，槽位右侧 10px 间距已满足。
   *  - Stability 的 shorthand 规范有一条硬前置：「用于完整字标会过小的场合，且该场合
   *    必须同时出现 Stability AI 的名称或标」。SDXL/SD15 卡片正文带 `stabilityai`
   *    发布方时成立；若哪天隐藏作者名，这两个要退回自绘标记。
   */
  logo?: string;
  /** 反白版资产，仅在深色主题下替换显示 */
  logoDark?: string;
  /**
   * 官方资产的光学配平系数，缺省 1。
   *
   * 各家的 viewBox 留白不一样，同样塞进 22px 盒子，图形实际边长能差三成：
   * Simple Icons（qwen）是 24×24 满幅，Stability（sdxl）1101 的 viewBox 里图形占
   * 100% 宽 × 91% 高，Flux 的 24 viewBox 只用掉 68% 宽。所以这个值只能**逐资产实测标定**，
   * 不能用一条统一 CSS 放大——满幅的那几个再放大就直接溢出。
   *
   * 实测口径：把资产按 contain 铺进 22px 格，量内容框与墨水覆盖率（见 tests/wt-ink.mjs）。
   * 只给「自身几何还有余量」的资产补正，已经顶满的不动。
   */
  logoScale?: number;
  test: RegExp;
}

/**
 * 顺序敏感：具体家族必须排在通用家族前面。
 * 例如 wan2.2 的简称、sd1.5 与 sdxl 的区分，都靠顺序保证。
 */
export const FAMILIES: FamilySpec[] = [
  {
    id: 'sd3',
    code: 'SD3',
    /*
     * SD3/3.5 没有独立 symbol，官方材料沿用 Stability AI 的 S. 标；
     * 因此与 sd15/sdxl 共用同一份资产（字节相同），世代由家族码 SD3 区分。
     */
    logo: 'families/sd3.svg',
    logoDark: 'families/sd3-dark.svg',
    mark: '',
    filled: false,
    test: /sd[\s._-]?3(?:[._]?5)?|stable[\s._-]?diffusion[\s._-]?3/i,
  },
  {
    id: 'sd15',
    code: 'SD15',
    logo: 'families/sd15.svg',
    logoDark: 'families/sd15-dark.svg',
    logoScale: 0.86,
    mark: 'M5 5h14v14H5Z',
    filled: false,
    test: /sd[\s._-]?v?1[._]?5|stable[\s._-]?diffusion[\s._-]?v?1/i,
  },
  {
    /*
     * Illustrious / NoobAI 这类社区家族**必须排在 sdxl 前面**：
     * 它们的微调名普遍写成 `waiIllustriousSDXL_v170`、`noobaiXLSDXL_v...`，
     * 先撞到 sdxl 的 /sd[\s._-]?xl/i 就永远认不出真正的家族。
     * 家族判定是「第一个命中」，顺序就是优先级。
     *
     * 两者都没有官方品牌资产（作者只发效果图），按官方外观重绘为近似标（非官方资产）。
     */
    id: 'illustrious',
    code: 'ILST',
    logo: 'families/illustrious.svg',
    logoDark: 'families/illustrious-dark.svg',
    mark: '',
    filled: true,
    test: /illustrious/i,
  },
  {
    id: 'noobai',
    code: 'NOOB',
    // NoobAI XL：取 noobaixl.org 的官方 512×512 图标（棕底米白像素 N），原图嵌入
    logo: 'families/noobai.svg',
    logoDark: 'families/noobai-dark.svg',
    mark: '',
    filled: true,
    test: /noob[\s._-]?ai/i,
  },
  {
    id: 'sdxl',
    code: 'SDXL',
    logo: 'families/sdxl.svg',
    logoDark: 'families/sdxl-dark.svg',
    // Stability 的 S. 在 1101 viewBox 里顶满宽高，22px 格内是全场最重的一个，
    // 缩到 0.86 才与字牌同一光学档位（覆盖率 41% → 约 31%）
    logoScale: 0.86,
    mark: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
    filled: false,
    /*
     * 只认「SDXL」和官方全名 `stable-diffusion-xl`。
     * **不要**放宽到裸 `XL`：社区 SDXL 微调（RealVisXL / Juggernaut-XL）不是 Stability 发布的，
     * 给它们挂 Stability 标会违反官方 shorthand 规范的前置条件（该场合须同时出现
     * Stability AI 的名称或标）。认不出就让它落 other / 自己的家族码。
     */
    test: /sdxl|sd[\s._-]?xl|stable[\s._-]?diffusion[\s._-]?xl/i,
  },
  {
    id: 'pony',
    code: 'PONY',
    mark: 'M12 4L21 19H3Z',
    filled: true,
    // 作者没有任何品牌资产，Civitai 页只有效果图，任何「Pony 标」都是二创
    test: /pony/i,
  },
  {
    id: 'krea',
    code: 'KREA',
    // 官网只有「Krea」文字字标；按官方外观重绘为 K 形标（非官方资产），明暗两版
    logo: 'families/krea.svg',
    logoDark: 'families/krea-dark.svg',
    mark: '',
    filled: true,
    test: /krea/i,
  },
  {
    id: 'zimage',
    code: 'ZIMG',
    // 通义 Z-Image，命名有 Z-Image / ZImage / z_image 三种写法；标为按官方外观重绘
    logo: 'families/zimage.svg',
    logoDark: 'families/zimage-dark.svg',
    mark: '',
    filled: true,
    test: /z[\s._-]?image/i,
  },
  {
    id: 'hidream',
    code: 'HDRM',
    logo: 'families/hidream.svg',
    logoDark: 'families/hidream-dark.svg',
    mark: '',
    filled: true,
    test: /hidream/i,
  },
  {
    id: 'ernie',
    code: 'ERN',
    /*
     * 百度文心（ERNIE）。官网 /assets/ 下直接给出 symbol 的宽高两版：
     * 浅色版 #002F8E + 蓝渐变，深色版是同几何的白色渐变（自带透明度 0.4→0.95）。
     * viewBox 21.76×24.78 已是 symbol 边界，不补 logoScale。
     *
     * 深色主题必须用官方白色版 —— 浅色版深端 #0439B5 压在 #232220 上只有约 1.9:1，
     * 而白色版实测 4.3:1 以上。这是「黑白标才备反白版」规则的又一例。
     */
    logo: 'families/ernie.svg',
    logoDark: 'families/ernie-dark.svg',
    mark: '',
    filled: true,
    test: /ernie|文心/i,
  },
  {
    id: 'chroma',
    code: 'CHRM',
    logo: 'families/chroma.svg',
    logoDark: 'families/chroma-dark.svg',
    mark: '',
    filled: true,
    test: /chroma/i,
  },
  {
    id: 'hunyuan',
    code: 'HYV',
    logo: 'families/hunyuan.svg',
    mark: 'M12 3l8.5 4.75v9.5L12 21l-8.5-4.75v-9.5Z',
    filled: false,
    test: /hunyuan|\bhyv\b|混元/i,
  },
  {
    id: 'ltx',
    code: 'LTX',
    mark: 'M4 7h6v10H4Z M14 7h6v10h-6Z',
    filled: true,
    // 官方只有「LtX」字标、没有符号；75×32 塞进方槽后高只剩 7.7px，且与字牌重复
    test: /\bltx[\s.-]?v?\b/i,
  },
  {
    id: 'wan',
    code: 'WAN',
    /*
     * 两道同基线、同圆心的半圆拱（外 9/6.2、内 4.4/2.2，拱脚垂直落地）。
     * 旧标记是 2.4px 描边的双弧，22px 下只有 8px 高、墨水覆盖 16%，
     * 和官方实心标差了整整一档；改成闭合填充后 26%，与 pony / ltx 同档。
     * 内拱外径与外拱内径留 1.8 的缝，22px 下约 1.65px，仍能读出是「两拱」而不是一块。
     */
    mark: 'M3 19.4V13.4A9 9 0 0 1 21 13.4V19.4H18.2V13.4A6.2 6.2 0 0 0 5.8 13.4V19.4Z M7.6 19.4V13.4A4.4 4.4 0 0 1 16.4 13.4V19.4H14.2V13.4A2.2 2.2 0 0 0 9.8 13.4V19.4Z',
    filled: true,
    // 官方只有 assets/logo.png 位图，描摹成 SVG 属于重绘，形状不可靠
    test: /\bwan[\s._-]?2|\bwan\b|wan2|万相/i,
  },
  {
    id: 'flux',
    code: 'FLUX',
    logo: 'families/flux.svg',
    logoDark: 'families/flux-dark.svg',
    // 图形只占 24 viewBox 的 68% 宽（高已顶满），是唯一还有横向余量的官方标；
    // 补到 1.08 后横向 17px、纵向 23.8px（出格 0.9px，落在卡片内边距里不会被裁）。
    logoScale: 1.08,
    mark: 'M5 5l7 7-7 7M14 5l7 7-7 7',
    filled: false,
    test: /flux/i,
  },
  {
    id: 'qwen',
    code: 'QWEN',
    logo: 'families/qwen.svg',
    // 不备反白版：Qwen 是官方紫（#6950EF），反白等于改色。
    // 深色主题下仍用这一份官方紫 —— 深色底 (#232220) 上对比度 3.3:1，
    // 作为品牌图形（3:1 门槛）够用，且保住了「官方紫」这个识别特征。
    mark: 'M4 9V4h16v5M4 15v5h16v-5',
    filled: false,
    test: /qwen|通义千问|千问/i,
  },
  {
    id: 'minimax',
    code: 'MMX',
    /*
     * MiniMax 官方标识：波浪形 symbol，官方渐变 #E21680 → #FF633A（品红→橙）。
     *
     * 资产来源：platform.minimaxi.com 首屏字标 svg 的第一个 path（viewBox 0 0 201 48 里
     * x 0~57.1358 那段就是 symbol，字标本身是黑色纯文字）。这里只取 symbol，
     * viewBox 裁到 `0 0 57.14 48`，渐变原样保留官方色。
     *
     * 社区之前只有字标，所以这里一度是空的 —— 现在官方 symbol 可用，就该用官方的。
     * 渐变是官方品牌的一部分，**不另做深色版**：深浅背景下这个饱和度都读得出来，
     * 反白版反而丢掉了识别特征。
     */
    logo: 'families/minimax.svg',
    mark: '',
    filled: true,
    test: /minimax|\bmmx\b/i,
  },
  {
    id: 'cogvideo',
    code: 'COGV',
    // 智谱 CogVideoX：官方只出位图与演示页；按官方外观重绘为视频播放标（非官方资产）
    logo: 'families/cogvideo.svg',
    logoDark: 'families/cogvideo-dark.svg',
    mark: '',
    filled: false,
    test: /cogvideo/i,
  },
  {
    id: 'kolors',
    code: 'KOLORS',
    // 快手可图：官方品牌页未提供 SVG；按官方外观重绘为渐变 K 标（非官方资产）
    logo: 'families/kolors.svg',
    logoDark: 'families/kolors-dark.svg',
    mark: '',
    filled: false,
    test: /kolors|可图/i,
  },
  {
    id: 'mochi',
    code: 'MOCHI',
    // Genmo Mochi：官方仓库无 logo，取 genmo.ai 字标 PNG 里的三色 symbol（原图嵌入，非重绘）
    logo: 'families/mochi.svg',
    logoDark: 'families/mochi-dark.svg',
    mark: '',
    filled: false,
    test: /mochi/i,
  },
  {
    id: 'lumina',
    code: 'LUMINA',
    // Alpha-VLLM Lumina：仓库没有品牌资产；按官方外观重绘为光芒标（非官方资产）
    logo: 'families/lumina.svg',
    logoDark: 'families/lumina-dark.svg',
    mark: '',
    filled: false,
    test: /lumina/i,
  },
  {
    id: 'skyreels',
    code: 'SKY',
    // 昆仑万维 SkyReels 视频模型：无矢量标；按官方外观重绘为胶片盘标（非官方资产）
    logo: 'families/skyreels.svg',
    logoDark: 'families/skyreels-dark.svg',
    mark: '',
    filled: false,
    test: /skyreels/i,
  },
  {
    id: 'kandinsky',
    code: 'KAND',
    // Kandinsky 实验室：官网未提供可下载 SVG；按官方外观重绘为构成主义三形（非官方资产）
    logo: 'families/kandinsky.svg',
    logoDark: 'families/kandinsky-dark.svg',
    mark: '',
    filled: false,
    test: /kandinsky/i,
  },
  {
    id: 'playground',
    code: 'PLAY',
    // Playground AI：无矢量标；按官方外观重绘为圆角播放键（非官方资产）
    logo: 'families/playground.svg',
    logoDark: 'families/playground-dark.svg',
    mark: '',
    filled: false,
    test: /playground/i,
  },
  {
    id: 'pixart',
    code: 'PIX',
    // 华为诺亚 PixArt：仓库无品牌资产；按官方外观重绘为像素 P（非官方资产）
    logo: 'families/pixart.svg',
    logoDark: 'families/pixart-dark.svg',
    mark: '',
    filled: false,
    test: /pixart/i,
  },
  {
    id: 'other',
    code: '—',
    /*
     * 认不出家族时什么标记都不画。
     *
     * 这里曾经是「四个方点」的占位符，实测 20px 下读起来像一个坏掉的图片图标，
     * 反而暗示「这张卡出错了」。未知就是未知——留空的槽位比一个含义不明的符号诚实，
     * 也不会让人把注意力花在猜它是什么意思上。
     */
    mark: '',
    filled: true,
    test: /$^/,
  },
];

/**
 * 缩略图地址归一。
 *
 * Civitai 返回的是 `/original=true/`（原图，动辄 3MB）。卡片只占 266px 宽，
 * 必须换成 `/width=448/` —— 注意这是**路径段**，加 `?width=` 查询参数无效，
 * 服务端会照样吐原图。
 *
 * 宽度取 448 而不是 520：实测 384 与 448 命中同一档（都是 124 KB），
 * 而 512 跳到 156 KB、520 是 307 KB。448 对 266px 的卡面已经是 1.68 倍，
 * 再往上只多花流量不多给清晰度。
 */
export function thumb(url?: string): string {
  if (!url) return '';
  return proxied(url.replace('/original=true/', '/width=448/'));
}

/**
 * 交给后端取图（`/api/cover`）。
 *
 * 图片是浏览器自己发请求的，后端「元数据走代理」管不到它：浏览器不挂代理/TUN 时，
 * `image.civitai.com` 直连直接超时，卡片就退回铭牌，看着像「封面是空的」。
 *
 * 只代理已知图床，其它地址原样返回 —— 不把任意 URL 塞给后端，也不让站外图片
 * 借我们的域名做转发。
 */
const PROXY_SUFFIX = ['civitai.com', 'civitai.red', 'modelscope.cn', 'huggingface.co', 'hf.co'];

export function proxied(url: string): string {
  if (!url) return '';
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!PROXY_SUFFIX.some((s) => host === s || host.endsWith('.' + s))) return url;
    return `/api/cover?u=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

/**
 * 背景构图变体数。家族色只有 9 桶，一屏里撞色几乎是必然的；
 * 真正让两张卡不像同一张的，是构图——色块落在哪个角、有没有出血的圆。
 * 变体只由 name 的稳定哈希决定（见 motifOf），不掺下载量之类会变的字段。
 */
export const MOTIF_COUNT = 5;

/**
 * 量化标记：Q4_K_S / IQ3_XXS / fp8 / bf16 这类。
 * 必须先在整个名字上整体命中，再去分词——否则 Q4_K_S 会被下划线拆成 Q4 / K / S 三段。
 */
const QUANT_IN_NAME = /\b(i?q\d+(?:[_-][a-z0-9]+)*|fp\d+|bf16|fp16|fp32|e4m3fn)\b/i;

export interface CoverInput {
  /** 仓库 id（org/name）。家族判定同时看它 —— display_name 常是中文，只看 name 会漏判 */
  id?: string;
  name: string;
  tags?: string[];
  params?: string;
  /** 原站页面（搜索结果主条目的 url），右上角直接跳过去 */
  href?: string;
  /** 原站短名：HF / MS / Civitai */
  hrefLabel?: string;
  /**
   * 真实封面（Civitai 缩略图）。有图时图片铺满整块做背景，文本压在渐变蒙版上；
   * 没有就退回生成构图。HF / ModelScope 基本拿不到，所以生成那条路才是主线。
   */
  image?: string;
  /** 发布者（HF 的 org / Civitai 的作者），用来判断是不是搬运 */
  author?: string;
}

/** 规格字段。只在取到确定值时生成。 */
export interface CoverSpec {
  k: string;
  v: string;
}

export interface CoverMeta {
  family: FamilyId;
  code: string;
  mark: string;
  filled: boolean;
  /** 官方标识资产路径，缺省表示退回 mark 自绘 */
  logo?: string;
  /** 反白版资产，深色主题下使用 */
  logoDark?: string;
  /** 官方资产的光学配平系数，缺省 1 */
  logoScale?: number;
  /** 规格，0-2 条：参数、量化。取不到就不生成，不占位 */
  specs: CoverSpec[];
  /** 背景构图变体，0..MOTIF_COUNT-1，由 name 稳定哈希决定 */
  motif: number;
  /** 真实封面图，缺省表示走生成构图 */
  image?: string;
  /** 搬运标注：非官方发布者的名字，缺省表示不显示 */
  byline?: string;
  /** 发布方：家族没有徽章时用它做默认身份（缩写由 publisher.ts 推导） */
  publisher?: Publisher;
}

export function resolveFamily(model: CoverInput): FamilySpec {
  const hay = `${model.id ?? ''} ${model.name} ${(model.tags ?? []).join(' ')}`;
  for (const f of FAMILIES) {
    if (f.test.test(hay)) return f;
  }
  return FAMILIES[FAMILIES.length - 1];
}

/**
 * FNV-1a。只要一个稳定的散列——同一个模型每次都要落在同一个构图变体上，
 * 换台机器、刷新十次结果必须一致，所以不能用 Math.random，也不该掺会变的统计字段。
 */
function motifOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % MOTIF_COUNT;
}

/**
 * 家族官方发布者（小写）。
 *
 * 只用来回答一件事：**这张卡是不是搬运**。发布者不是官方时，在家族码右侧标出发布者，
 * 免得把 `Comfy-Org/stable-diffusion-3.5`、`unsloth/FLUX.1-dev` 这类打包版当成官方出品。
 *
 * 只登记能确认的；没登记的家族**不做判断**（宁可不标，也别把社区作者误标成搬运）。
 */
const FAMILY_OWNERS: Record<string, string[]> = {
  flux: ['black-forest-labs'],
  qwen: ['qwen', 'qwenlm'],
  wan: ['wan-ai', 'alibaba-pai'],
  hunyuan: ['tencent', 'tencent-hunyuan'],
  ltx: ['lightricks'],
  hidream: ['hidream-ai'],
  krea: ['krea'],
  chroma: ['lodestones'],
  sdxl: ['stabilityai'],
  sd15: ['stabilityai', 'stable-diffusion-v1-5'],
  sd3: ['stabilityai'],
  minimax: ['minimaxai'],
  ernie: ['baidu', 'ernie'],
  cogvideo: ['zai-org', 'thu-coai'],
  kolors: ['kwai-kolors'],
  mochi: ['genmo'],
  lumina: ['alpha-vllm'],
  skyreels: ['skywork'],
  kandinsky: ['kandinskylab', 'ai-forever'],
  playground: ['playgroundai'],
  pixart: ['pixart-alpha'],
};

/**
 * 已知的打包 / 量化 / 加速发布者。
 *
 * 这几个组织发的基本都是别人家的模型（GGUF、fp8、蒸馏、重打包），
 * 不管家族有没有登记官方发布者，都可以判定为搬运。
 */
const REPACK_ORGS = [
  'comfy-org',
  'unsloth',
  'quantstack',
  'city96',
  'john6666',
  'prunaai',
  'lightx2v',
  'ai-modelscope',
  'lmstudio-community',
];

/** 是搬运就返回发布者名，否则返回空串。 */
function repackByline(familyId: string, author?: string): string {
  const name = (author || '').trim();
  if (!name) return '';
  const low = name.toLowerCase();
  const owners = FAMILY_OWNERS[familyId];
  if (owners) return owners.includes(low) ? '' : name;
  return REPACK_ORGS.includes(low) ? name : '';
}

export function coverMeta(model: CoverInput): CoverMeta {
  const family = resolveFamily(model);

  // 整体抓量化标记。Q4_K_S 这类整体命中，不做分词，否则会被下划线拆成三段
  const quant = model.name.match(QUANT_IN_NAME)?.[1] ?? '';

  // 规格只收确定值：参数量必须真的出现在名字或 params 里，按家族常见规模猜的不显示
  const specs: CoverSpec[] = [];
  const size = `${model.params ?? ''} ${model.name}`.match(/(\d+(?:\.\d+)?)\s*B\b/i);
  if (size) specs.push({ k: '参数', v: `${size[1]}B` });
  if (quant) specs.push({ k: '量化', v: quant.toUpperCase() });

  return {
    family: family.id,
    code: family.code,
    mark: family.mark,
    filled: family.filled,
    logo: family.logo,
    logoDark: family.logoDark,
    logoScale: family.logoScale,
    specs,
    motif: motifOf(model.name),
    image: thumb(model.image),
    byline: repackByline(family.id, model.author),
    publisher: publisherOf(model) ?? undefined,
  };
}
