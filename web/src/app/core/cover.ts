/**
 * 兜底封面：由模型元信息生成「家族铭牌」。
 *
 * 三条原则（缺一条就会退回彩色雪花）：
 *  1. 只读稳定字段（name / tags / fileType / params）。下载量、点赞、更新时间一律不参与，
 *     否则同一张封面会随统计漂移，识别价值归零。
 *  2. 色相预算 9 桶。模型上千个，颜色只能标识「家族」；身份由字牌（家族码 + 变体行）承担。
 *  3. 每个通道只绑一个字段，不做纯装饰。规模条是「参数量」的量化编码，不是花纹。
 *
 * 家族标识是「槽位 + 降级」两段：
 *  - 有官方资产（assets/families/{id}.svg）时填品牌标，20px 完整呈现、不裁切、不改色。
 *    这是指称性使用（用标识指代该模型家族本身），合规；但**绝不能**放大成背景水印或改配色，
 *    那会脱离指称语境变成装饰图案，也从「标识该模型」变成「用它的标装饰我们的界面」。
 *  - 没有资产时退回自绘几何标记，尺寸与位置一致，所以两种状态版式不跳。
 * 背景水印只放自绘纹样，永不使用官方标。
 */

export type FamilyId = 'flux' | 'wan' | 'sdxl' | 'sd15' | 'qwen' | 'pony' | 'hunyuan' | 'ltx' | 'other';

export interface FamilySpec {
  id: FamilyId;
  /** 字牌上的家族码，3-4 字符，等宽显示 */
  code: string;
  /** 色相，按 45° 左右间隔排布，保证相邻家族可分辨 */
  hue: number;
  /** 底色混合比例，老底模压低存在感 */
  strength: number;
  /** 24×24 单路径标记，无官方资产时的降级图形 */
  mark: string;
  /** 实心还是描边 */
  filled: boolean;
  /**
   * 官方标识资产路径。放在 web/public/families/ 下，运行时按 18px 原样呈现。
   * 缺省时退回 mark 自绘图形，版式不跳。
   *
   * 接入规格（以 Black Forest Labs brand 页为例，各家条款不同，逐家确认后再填）：
   *  - 用 symbol 单标，不用 wordmark：BFL 明确「symbol 可脱离字标单独使用，
   *    但仅限完整标会不可读的小尺寸」——18px 槽位正属此列。
   *  - 黑 / 白各一版：浅色底用黑、深色底用白。深色单色标放深色底会直接消失，
   *    但**不要**用 filter 或 currentColor 反转凑合，改配色破坏商标同一性。
   *  - 不许改色、拉伸、加阴影，所以 logo 不参与家族色编码，永远保持原色。
   *  - clear space 以 symbol 描边厚度为基准，槽位右侧 10px 间距已满足。
   */
  logo?: string;
  /** 反白版资产，仅在深色主题下替换显示 */
  logoDark?: string;
  /** 名字里拿不到参数时的兜底档位依据 */
  paramsB?: number;
  test: RegExp;
}

/**
 * 顺序敏感：具体家族必须排在通用家族前面。
 * 例如 wan2.2 的简称、sd1.5 与 sdxl 的区分，都靠顺序保证。
 */
export const FAMILIES: FamilySpec[] = [
  {
    id: 'sd15',
    code: 'SD15',
    hue: 200,
    strength: 9,
    mark: 'M5 5h14v14H5Z',
    filled: false,
    paramsB: 1,
    test: /sd[\s._-]?1[._]?5|stable[\s._-]?diffusion[\s._-]?1/i,
  },
  {
    id: 'sdxl',
    code: 'SDXL',
    hue: 344,
    strength: 13,
    mark: 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
    filled: false,
    paramsB: 3,
    test: /sdxl|sd[\s._-]?xl/i,
  },
  {
    id: 'pony',
    code: 'PONY',
    hue: 315,
    strength: 13,
    mark: 'M12 4L21 19H3Z',
    filled: true,
    paramsB: 3,
    test: /pony/i,
  },
  {
    id: 'hunyuan',
    code: 'HYV',
    hue: 212,
    strength: 13,
    mark: 'M12 3l8.5 4.75v9.5L12 21l-8.5-4.75v-9.5Z',
    filled: false,
    paramsB: 13,
    test: /hunyuan|\bhyv\b/i,
  },
  {
    id: 'ltx',
    code: 'LTX',
    hue: 90,
    strength: 12,
    mark: 'M4 7h6v10H4Z M14 7h6v10h-6Z',
    filled: true,
    paramsB: 2,
    test: /\bltx[\s.-]?v?\b/i,
  },
  {
    id: 'wan',
    code: 'WAN',
    hue: 178,
    strength: 14,
    mark: 'M3 18a9 9 0 0 1 18 0M7.5 18a4.5 4.5 0 0 1 9 0',
    filled: false,
    paramsB: 14,
    test: /\bwan[\s._-]?2|\bwan\b|wan2/i,
  },
  {
    id: 'flux',
    code: 'FLUX',
    logo: 'families/flux.svg',
    logoDark: 'families/flux-dark.svg',
    hue: 268,
    strength: 14,
    mark: 'M5 5l7 7-7 7M14 5l7 7-7 7',
    filled: false,
    paramsB: 12,
    test: /flux/i,
  },
  {
    id: 'qwen',
    code: 'QWEN',
    logo: 'families/qwen.svg',
    logoDark: 'families/qwen-dark.svg',
    hue: 34,
    strength: 14,
    mark: 'M4 9V4h16v5M4 15v5h16v-5',
    filled: false,
    test: /qwen/i,
  },
  {
    id: 'other',
    code: '—',
    hue: 60,
    strength: 6,
    mark: 'M6 6h3v3H6Z M15 6h3v3h-3Z M6 15h3v3H6Z M15 15h3v3h-3Z',
    filled: true,
    test: /$^/,
  },
];

/** 文件形态角标。它回答的是「下载下来是什么、放哪个目录」，比扩展名本身有用。 */
const FORMAT_CHIP: Record<string, string> = {
  gguf: 'GGUF',
  safetensors: 'SAFE',
  ckpt: 'CKPT',
  zip: 'WF',
};

const FORMAT_WORDS = new Set(['gguf', 'safetensors', 'safetensor', 'ckpt', 'pt', 'bin', 'zip', 'ggml', 'onnx']);

/**
 * 量化标记：Q4_K_S / IQ3_XXS / fp8 / bf16 这类，既是角标也是变体行的一部分。
 * 必须先在整个名字上整体命中，再去分词——否则 Q4_K_S 会被下划线拆成 Q4 / K / S 三段。
 */
const QUANT_IN_NAME = /\b(i?q\d+(?:[_-][a-z0-9]+)*|fp\d+|bf16|fp16|fp32|e4m3fn)\b/i;

export interface CoverInput {
  name: string;
  tags?: string[];
  fileType?: string;
  params?: string;
}

export interface CoverMeta {
  family: FamilyId;
  code: string;
  hue: number;
  strength: number;
  mark: string;
  filled: boolean;
  /** 官方标识资产路径，缺省表示退回 mark 自绘 */
  logo?: string;
  /** 反白版资产，深色主题下使用 */
  logoDark?: string;
  /** 右上角标：量化标记优先，其次文件形态 */
  chip: string;
  /** 字牌下的变体行 */
  variant: string;
  /** 参数量档位 1-4，0 表示未知（不画规模条） */
  scale: number;
}

export function resolveFamily(model: CoverInput): FamilySpec {
  const hay = `${model.name} ${(model.tags ?? []).join(' ')}`;
  for (const f of FAMILIES) {
    if (f.test.test(hay)) return f;
  }
  return FAMILIES[FAMILIES.length - 1];
}

function tokensOf(name: string): string[] {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .split(/[-_\s·/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && /[a-z0-9]/i.test(t));
}

/** 参数量 → 4 档；拿不到数字时用家族常见规模兜底，纯未知返回 0 */
function scaleOf(model: CoverInput, family: FamilySpec): number {
  const src = `${model.params ?? ''} ${model.name}`;
  const m = src.match(/(\d+(?:\.\d+)?)\s*B\b/i);
  const billion = m ? parseFloat(m[1]) : family.paramsB;
  if (!billion || Number.isNaN(billion)) return 0;
  if (billion <= 2) return 1;
  if (billion <= 8) return 2;
  if (billion <= 20) return 3;
  return 4;
}

export function coverMeta(model: CoverInput): CoverMeta {
  const family = resolveFamily(model);
  const tokens = tokensOf(model.name);

  // 整体先抓量化标记，再从分词结果里剔掉它的碎片（Q4 / K / S 都属于 Q4_K_S）
  const quant = model.name.match(QUANT_IN_NAME)?.[1] ?? '';
  const quantLower = quant.toLowerCase();
  const rest = tokens.filter((t) => {
    const lower = t.toLowerCase();
    if (FORMAT_WORDS.has(lower)) return false;
    if (family.test.test(t)) return false;
    if (quantLower && quantLower.includes(lower)) return false;
    return true;
  });

  // 变体行取前 3 段，量化标记固定收尾：dev · Q4_K_S
  const variant = [...rest.slice(0, 3), quant].filter(Boolean).join(' · ') || '未命名';

  return {
    family: family.id,
    code: family.code,
    hue: family.hue,
    strength: family.strength,
    mark: family.mark,
    filled: family.filled,
    logo: family.logo,
    logoDark: family.logoDark,
    // 角标只放首段（Q4 而不是 Q4_K_S），完整量化信息留在变体行
    chip: quant ? quant.split(/[_-]/)[0].toUpperCase().slice(0, 4) : (FORMAT_CHIP[model.fileType ?? ''] ?? ''),
    variant,
    scale: scaleOf(model, family),
  };
}
