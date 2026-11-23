import type { RemoteFile } from './types';

/**
 * 真正的权重文件扩展名。
 *
 * 下载弹层只展示这些文件 —— 仓库里的 config.json / tokenizer.json /
 * .gitattributes / tiktoken.model / chat_template.jinja / README.md 等
 * 都不是 ComfyUI 能加载的权重，混在清单里只会让用户以为「全都要下」。
 */
export const WEIGHT_EXTENSIONS = [
  '.safetensors',
  '.sft',
  '.gguf',
  '.ckpt',
  '.pt',
  '.pth',
  '.bin',
  '.onnx',
] as const;

/**
 * 带权重扩展名、但其实是训练产物的文件。
 *
 * `training_args.bin` / `optimizer.pt` / `rng_state.pth` 是训练中间状态，
 * 不是能加载的模型；按扩展名会被误判成权重。
 */
const TRAINING_ARTIFACTS = new Set([
  'training_args.bin',
  'optimizer.bin',
  'optimizer.pt',
  'scheduler.pt',
  'rng_state.pth',
  'scaler.pt',
]);

export function isWeightFile(path: string): boolean {
  const low = (path || '').toLowerCase();
  const name = low.split('/').pop() || '';
  if (TRAINING_ARTIFACTS.has(name)) return false;
  return WEIGHT_EXTENSIONS.some((ext) => low.endsWith(ext));
}

export function weightFiles(files: RemoteFile[]): RemoteFile[] {
  return files.filter((f) => isWeightFile(f.path));
}

/** 量化/精度标记：Q4_K_M、fp8、bf16、nf4、nvfp4、int8、w4a8… */
const QUANT_RE =
  /(?:^|[-_./])(q[1-8](?:_[a-z0-9]+)*|iq[1-4][a-z0-9_]*|fp4|fp6|fp8|fp16|fp32|bf16|f16|f32|nf4|nvfp4|nvfp8|mxfp4|mxfp8|int[2-8]|w[468]a(?:8|16))(?=[-_./]|$)/i;

function quantOf(path: string): string {
  const match = QUANT_RE.exec(path || '');
  return match ? match[1].toLowerCase() : '';
}

/**
 * Diffusers 原始仓库的分片：`text_encoder/model-00001-of-00014.safetensors`。
 *
 * 这些是 diffusers 目录格式的组件分片，ComfyUI 的 UNETLoader / CLIPLoader
 * 不能直接加载；默认视图不展示它们，避免「14 个分片全是本机用不了的权重」。
 */
const DIFFUSERS_SHARD_RE =
  /(?:^|\/)(?:model|diffusion_pytorch_model)-\d{5}-of-\d{5}\.safetensors$/i;

/** 普通权重分片（GGUF / safetensors 都可能是）：同一组必须一起下载。 */
const WEIGHT_SHARD_RE = /-\d{5}-of-\d{5}\.[a-z0-9]+$/i;

function isDiffusersShard(path: string): boolean {
  return DIFFUSERS_SHARD_RE.test(path || '');
}

function isWeightShard(path: string): boolean {
  return WEIGHT_SHARD_RE.test(path || '');
}

function componentOf(file: RemoteFile): string {
  if (file.folder) return file.folder;
  const parts = (file.path || '').split('/');
  return parts.length > 1 ? parts[0].toLowerCase() : 'checkpoints';
}

function totalBytes(files: RemoteFile[]): number {
  return files.reduce((sum, f) => sum + (f.size || 0), 0);
}

/** 从仓库名拆出用于匹配权重的关键词（MiniMax-H3-Image → minimax / h3 / image）。 */
function hintTokens(hint: string): string[] {
  return [
    ...new Set(
      (hint || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && t !== 'comfy' && t !== 'org')
    ),
  ];
}

function hintScore(file: RemoteFile, tokens: string[]): number {
  const hay = (file.path || '').toLowerCase();
  return tokens.reduce((score, token) => score + (hay.includes(token) ? 1 : 0), 0);
}

/** 同组里选一个「最像本模型、体积最小」的备选权重。 */
function pickAlternate(files: RemoteFile[], tokens: string[]): RemoteFile {
  return files.reduce((best, file) => {
    const score = hintScore(file, tokens);
    const bestScore = hintScore(best, tokens);
    if (score !== bestScore) return score > bestScore ? file : best;
    return (file.size || 0) < (best.size || 0) ? file : best;
  });
}

/** 去掉量化标记与分片后缀后的主干名，用来判断两份权重是不是同一组件的不同量化。 */
function stemOf(path: string): string {
  const name = (path || '').split('/').pop() || '';
  return name
    .replace(/\.[^.]+$/, '')
    .replace(QUANT_RE, '')
    .replace(/-\d{5}-of-\d{5}$/i, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

/** 按量化档位选一组：优先匹配模型名，其次体积最小；分片整组保留。 */
function pickQuantGroup(files: RemoteFile[], tokens: string[]): RemoteFile[] {
  const groups = new Map<string, RemoteFile[]>();
  for (const f of files) {
    const key = quantOf(f.path) || 'default';
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }

  const best = [...groups.values()].reduce((a, b) => {
    const scoreA = Math.max(...a.map((f) => hintScore(f, tokens)));
    const scoreB = Math.max(...b.map((f) => hintScore(f, tokens)));
    if (scoreA !== scoreB) return scoreB > scoreA ? b : a;
    return totalBytes(b) < totalBytes(a) ? b : a;
  });

  // 分片必须整组下载；非分片的同档位文件是互斥备选，只选一份。
  return best.some((f) => isWeightShard(f.path)) ? best : [pickAlternate(best, tokens)];
}

/**
 * 一个组件内默认选哪一份。
 *
 * - 非量化权重（主模型 / VAE / 文本编码器）优先保留；
 * - 同组件的量化副本如果只是同一权重的另一种精度（同名，只差 fp8/fp16 后缀），
 *   不再重复选；
 * - 如果量化文件是另一个组件（如 clip_l 旁边的 t5xxl_fp16），补选一组量化版本；
 * - 只有量化权重时，按量化档位选最匹配、体积最小的一组；
 * - 分片权重整组保留，不能只下其中一片。
 */
function pickComponent(files: RemoteFile[], tokens: string[]): RemoteFile[] {
  const nonQuant = files.filter((f) => !quantOf(f.path));
  if (nonQuant.length) {
    const baseStems = new Set(nonQuant.map((f) => stemOf(f.path)));
    const separateQuant = files.filter(
      (f) => quantOf(f.path) && !baseStems.has(stemOf(f.path))
    );
    return separateQuant.length
      ? [...nonQuant, ...pickQuantGroup(separateQuant, tokens)]
      : nonQuant;
  }
  return pickQuantGroup(files, tokens);
}

/**
 * 默认展示的「匹配权重」。
 *
 * 目标：默认给用户一套 ComfyUI 能直接加载、且体积尽量小的权重，而不是把仓库
 * 里所有 safetensors 都铺出来。
 *
 * 1. 先滤掉所有非权重文件；
 * 2. Diffusers 原始仓库（主模型/文本编码器只有 `model-00001-of-00014` 这种分片）
 *    默认不勾选任何权重 —— ComfyUI 加载不了，避免误导；
 * 3. 其余权重按 ComfyUI 目录（checkpoints / diffusion_models / text_encoders…）
 *    分组，每个组件默认选一份；
 * 4. 分片文件（GGUF / safetensors）整组保留。
 *
 * 其余权重通过「查看全部权重」展开，不默认塞给用户。
 */
export function matchedWeightFiles(files: RemoteFile[], modelHint = ''): RemoteFile[] {
  const weights = weightFiles(files);
  if (!weights.length) return [];

  const tokens = hintTokens(modelHint);
  const shards = weights.filter((f) => isDiffusersShard(f.path));
  const pool = weights.filter((f) => !isDiffusersShard(f.path));

  const hasMainSingle = pool.some((f) => {
    const component = componentOf(f);
    return (
      (component === 'checkpoints' || component === 'diffusion_models') &&
      (f.size || 0) >= 1_000_000_000
    );
  });

  // 只有分片、没有可直接加载的主权重：这是 Diffusers 原始仓库。
  if (shards.length && !hasMainSingle) return [];
  if (!pool.length) return [];

  const byComponent = new Map<string, RemoteFile[]>();
  for (const f of pool) {
    const key = componentOf(f);
    const list = byComponent.get(key);
    if (list) list.push(f);
    else byComponent.set(key, [f]);
  }

  const picked: RemoteFile[] = [];
  for (const group of byComponent.values()) picked.push(...pickComponent(group, tokens));
  return picked;
}
