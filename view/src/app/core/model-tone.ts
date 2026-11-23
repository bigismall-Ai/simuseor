/**
 * 模型卡的底色系统：家族色优先，任务色兜底。
 *
 * 为什么不能只用家族色：真实库里大部分模型认不出官方家族（原型实测 68% 落进
 * other），全用同一个中性色 → 一屏卡片同色，再精致的布局也像毛坯房。
 * 任务类型是第二维度（文生图 / 文生视频 / 文本生成 / LoRA…），足以让卡片有层次，
 * 而且它本来就要显示在卡上。
 *
 * 两条硬规则：
 *  1. **深色主题换整套色，不翻色板**。浅色底在深色页面上会整块发亮，
 *     所以每个家族 / 任务都有独立的深色值。
 *  2. **两套色都返回，调用方只给 `--t-*` / `--t-*-d`，由 CSS 映射到 `--plate-*`**。
 *     两套色都写内联的话，内联永远赢过 CSS 规则，深色主题就切不过去。
 *
 * ── 家族色的唯一出处 ──────────────────────────────────────────────
 * 这里的 `FAMILY_TONE` / `FAMILY_TONE_DARK` 是**全站唯一一份家族色**。
 * 以前 `cover-plate.component.ts` 里还有一份等值的 `.f-*` 静态类，两边各改各的，
 * 迟早会飘。现在封面（`ui/cover-plate.component.ts`）也走这份色板，
 * 改颜色只改这里一处。
 *
 * 任务值来自 v4 原型（认不出家族时的兜底），只在本文件里存在。
 */

/** 一套色：底 / 正文 / 强调 / 纹样 */
export interface Tone {
  bg: string;
  ink: string;
  strong: string;
  mark: string;
}

/**
 * 家族色板（浅色）：25 个家族。
 *
 * 与封面 `.f-*` 那份曾经重复的两套色，现在只留这里。
 */
export const FAMILY_TONE: Record<string, Tone> = {
  flux: { bg: '#f1eefc', ink: '#574f8c', strong: '#3c3489', mark: '#8f86d6' },
  wan: { bg: '#e1f5ee', ink: '#2f7563', strong: '#085041', mark: '#59b79f' },
  sdxl: { bg: '#fbeaf0', ink: '#95516b', strong: '#72243e', mark: '#d78aa6' },
  sd15: { bg: '#f1f3f4', ink: '#5b6165', strong: '#41474a', mark: '#a3abaf' },
  pony: { bg: '#fbebf6', ink: '#8a4a74', strong: '#6d2a55', mark: '#d18cb8' },
  hunyuan: { bg: '#e7f0fa', ink: '#3a6291', strong: '#14487a', mark: '#8cb4de' },
  ltx: { bg: '#ecf4e3', ink: '#55703a', strong: '#3a5a1e', mark: '#9dbe7c' },
  qwen: { bg: '#f7efdd', ink: '#8b6421', strong: '#633806', mark: '#d3a862' },
  minimax: { bg: '#fdeef3', ink: '#9c3f68', strong: '#6d2645', mark: '#e88ab0' },
  krea: { bg: '#e2f2f5', ink: '#2c6d78', strong: '#0d4a54', mark: '#66b3bf' },
  zimage: { bg: '#e9ebfa', ink: '#464c8e', strong: '#262a63', mark: '#8d94d6' },
  hidream: { bg: '#fdeae6', ink: '#93503f', strong: '#70301f', mark: '#dda08c' },
  ernie: { bg: '#e8edfc', ink: '#2f4fa0', strong: '#16306e', mark: '#7f9ede' },
  noobai: { bg: '#eef2df', ink: '#67703c', strong: '#474e1f', mark: '#a8b477' },
  sd3: { bg: '#e8ecf3', ink: '#475573', strong: '#22314c', mark: '#8b9ab8' },
  cogvideo: { bg: '#e3efe7', ink: '#34694f', strong: '#124a33', mark: '#74b391' },
  kolors: { bg: '#fdefe0', ink: '#8f5a1e', strong: '#6b3c05', mark: '#daa464' },
  mochi: { bg: '#eef1dc', ink: '#6b7233', strong: '#49500f', mark: '#adb46f' },
  lumina: { bg: '#f8f0d9', ink: '#86701f', strong: '#665100', mark: '#d2ba70' },
  skyreels: { bg: '#e6f0f8', ink: '#3b6488', strong: '#163f63', mark: '#84b0d4' },
  kandinsky: { bg: '#f6e9f3', ink: '#84406f', strong: '#62244f', mark: '#c88cb4' },
  playground: { bg: '#e4f3ef', ink: '#2f6d5f', strong: '#0d4a3d', mark: '#6fb9a6' },
  pixart: { bg: '#f9eae6', ink: '#8f4a3a', strong: '#6b2a1c', mark: '#d99c8b' },
  illustrious: { bg: '#f3ebf7', ink: '#7a4a8c', strong: '#582866', mark: '#b789c9' },
  chroma: { bg: '#f7ece2', ink: '#7d5a3a', strong: '#5a3c1e', mark: '#c39a72' },
};

/** 家族色板（深色）。同源同值，只是底压深、字提亮。 */
export const FAMILY_TONE_DARK: Record<string, Tone> = {
  flux: { bg: '#1e1b33', ink: '#c3bcfa', strong: '#ded9ff', mark: '#8f86d6' },
  wan: { bg: '#10241f', ink: '#8fdfca', strong: '#bdf2e2', mark: '#59b79f' },
  sdxl: { bg: '#2a1620', ink: '#f2adc3', strong: '#ffd2e0', mark: '#d78aa6' },
  sd15: { bg: '#202326', ink: '#a8b0b4', strong: '#d3d9dc', mark: '#a3abaf' },
  pony: { bg: '#281626', ink: '#f3b6df', strong: '#ffd6ee', mark: '#d18cb8' },
  hunyuan: { bg: '#131f2c', ink: '#9dcbf3', strong: '#cce6ff', mark: '#8cb4de' },
  ltx: { bg: '#1b2313', ink: '#b4d68a', strong: '#d9efbb', mark: '#9dbe7c' },
  qwen: { bg: '#232220', ink: '#eec48a', strong: '#ffdfae', mark: '#d3a862' },
  minimax: { bg: '#2a1620', ink: '#f0a3c1', strong: '#ffc8dc', mark: '#e88ab0' },
  krea: { bg: '#10282c', ink: '#8fd6e0', strong: '#bdeef5', mark: '#66b3bf' },
  zimage: { bg: '#1a1b33', ink: '#b0b6f2', strong: '#d9dcff', mark: '#8d94d6' },
  hidream: { bg: '#2b1a15', ink: '#f0b5a2', strong: '#ffd6c7', mark: '#dda08c' },
  ernie: { bg: '#141d33', ink: '#a8bdf0', strong: '#d3e0ff', mark: '#7f9ede' },
  noobai: { bg: '#202415', ink: '#c3cf95', strong: '#e2ecc0', mark: '#a8b477' },
  sd3: { bg: '#191e2b', ink: '#b3bfd3', strong: '#d8e1f0', mark: '#8b9ab8' },
  cogvideo: { bg: '#12261e', ink: '#93d3b5', strong: '#c4ecd8', mark: '#74b391' },
  kolors: { bg: '#2b1c0f', ink: '#e8bc85', strong: '#ffd9ac', mark: '#daa464' },
  mochi: { bg: '#21240f', ink: '#cfd68f', strong: '#e9edb9', mark: '#adb46f' },
  lumina: { bg: '#26200f', ink: '#e4cb84', strong: '#ffe6ab', mark: '#d2ba70' },
  skyreels: { bg: '#131f2b', ink: '#a8cbe8', strong: '#d3e6f7', mark: '#84b0d4' },
  kandinsky: { bg: '#291726', ink: '#e3b3d1', strong: '#f8d6ea', mark: '#c88cb4' },
  playground: { bg: '#12241f', ink: '#95d6c4', strong: '#c3f0e2', mark: '#6fb9a6' },
  pixart: { bg: '#2b1a15', ink: '#ecb3a3', strong: '#ffd5c8', mark: '#d99c8b' },
  illustrious: { bg: '#251a2b', ink: '#d9b2e6', strong: '#f2d9fb', mark: '#b789c9' },
  chroma: { bg: '#2a2018', ink: '#d8b596', strong: '#f2dcc4', mark: '#c39a72' },
};

/**
 * 中性底：家族认不出、任务也认不出时的最后一块底。
 *
 * 「未知就是未知，不猜」—— 所以是中性灰，不是随便挑一个家族色。
 */
export const NEUTRAL_TONE: Tone = { bg: '#f2f1ed', ink: '#6b6a63', strong: '#57564f', mark: '#b3b2aa' };
export const NEUTRAL_TONE_DARK: Tone = { bg: '#232321', ink: '#b0afa6', strong: '#d7d6cd', mark: '#b3b2aa' };

/** 任务色：认不出家族时的第二维度。id 与后端 `weight_class.TASK_LABELS` 一致 */
export const TASK_TONE: Record<string, Tone> = {
  text_to_image: { bg: '#f1eefc', ink: '#574f8c', strong: '#3c3489', mark: '#8f86d6' },
  image_to_image: { bg: '#fbeaf0', ink: '#95516b', strong: '#72243e', mark: '#d78aa6' },
  text_to_video: { bg: '#e7f0fa', ink: '#3a6291', strong: '#14487a', mark: '#8cb4de' },
  image_to_video: { bg: '#e1f5ee', ink: '#2f7563', strong: '#085041', mark: '#59b79f' },
  text_generation: { bg: '#f7efdd', ink: '#8b6421', strong: '#633806', mark: '#d3a862' },
  embedding: { bg: '#ecf4e3', ink: '#55703a', strong: '#3a5a1e', mark: '#9dbe7c' },
  lora: { bg: '#fdf0e6', ink: '#9a5a24', strong: '#7a3d10', mark: '#dfa06a' },
  upscaler: { bg: '#eef0f7', ink: '#4a5578', strong: '#333c5c', mark: '#8d97bd' },
  controlnet: { bg: '#f4ecf7', ink: '#75418f', strong: '#5a2f70', mark: '#b98fd0' },
  speech_to_text: { bg: '#eef6f3', ink: '#3f7a68', strong: '#2a5f4f', mark: '#7fbfa8' },
  text_to_speech: { bg: '#f7eef1', ink: '#8f4f63', strong: '#6e3849', mark: '#cf8b9e' },
  image_understanding: { bg: '#eef2f4', ink: '#4e6069', strong: '#36474e', mark: '#8ea3ad' },
};

export const TASK_TONE_DARK: Record<string, Tone> = {
  text_to_image: { bg: '#1e1b33', ink: '#c3bcfa', strong: '#ded9ff', mark: '#8f86d6' },
  image_to_image: { bg: '#2a1620', ink: '#f2adc3', strong: '#ffd2e0', mark: '#d78aa6' },
  text_to_video: { bg: '#132336', ink: '#8fc0e8', strong: '#c3e0f7', mark: '#8cb4de' },
  image_to_video: { bg: '#10241f', ink: '#8fdfca', strong: '#bdf2e2', mark: '#59b79f' },
  text_generation: { bg: '#2b2113', ink: '#d6b571', strong: '#f0d9a6', mark: '#d3a862' },
  embedding: { bg: '#1a2612', ink: '#a5c782', strong: '#d3ecb6', mark: '#9dbe7c' },
  lora: { bg: '#2a1c10', ink: '#e0a874', strong: '#f3cf9f', mark: '#dfa06a' },
  upscaler: { bg: '#1a1e2c', ink: '#9aa4cd', strong: '#c6cdea', mark: '#8d97bd' },
  controlnet: { bg: '#241a2c', ink: '#c294d8', strong: '#e2c4ee', mark: '#b98fd0' },
  speech_to_text: { bg: '#10241f', ink: '#8fdfca', strong: '#bdf2e2', mark: '#7fbfa8' },
  text_to_speech: { bg: '#2a1a20', ink: '#dda0b3', strong: '#f2c8d5', mark: '#cf8b9e' },
  image_understanding: { bg: '#182026', ink: '#a3b6c2', strong: '#c9dae4', mark: '#8ea3ad' },
};

/**
 * 取一套色。`family` 为 `other`（认不出）时落到任务色，任务也没有才中性。
 *
 * 家族色回答「谁家的」，任务色回答「干什么的」—— 两个都认不出才不涂色。
 *
 * 两套色都留着：调用方同时拿到浅色与深色，由 CSS 按 `data-theme` 挑。
 */
export function modelTone(family: string, task: string, dark: boolean): Tone {
  const fam = dark ? FAMILY_TONE_DARK : FAMILY_TONE;
  if (family && family !== 'other' && fam[family]) return fam[family];
  const taskTable = dark ? TASK_TONE_DARK : TASK_TONE;
  if (task && taskTable[task]) return taskTable[task];
  return dark ? NEUTRAL_TONE_DARK : NEUTRAL_TONE;
}
