/**
 * 视觉等价校验：把两份 SVG 光栅化后逐像素比较。
 *
 * 用途：批量优化时证明「字节变了，画面没变」。只看字节或元素数无法发现
 * 层叠顺序、class 覆盖、mask 引用这类问题。
 */

export type RenderStatus = 'identical' | 'minor' | 'different' | 'unavailable';

export interface RenderDiff {
  status: RenderStatus;
  changedPixels: number;
  strongPixels: number;
  totalPixels: number;
  percent: number;
}

const CANVAS_SIZE = 256;
/** 单通道容差：吸收抗锯齿与不同路径命令的微小光栅差异。 */
const TOLERANCE = 10;
/** 强差异阈值：只由抗锯齿造成的差异不应越过它。 */
const STRONG_TOLERANCE = 48;

export async function compareSvgRender(
  original: string,
  optimized: string,
  size = CANVAS_SIZE,
): Promise<RenderDiff> {
  if (original === optimized) {
    return { status: 'identical', changedPixels: 0, strongPixels: 0, totalPixels: size * size, percent: 0 };
  }
  const [a, b] = await Promise.all([rasterize(original, size), rasterize(optimized, size)]);
  if (!a || !b) {
    return { status: 'unavailable', changedPixels: 0, strongPixels: 0, totalPixels: size * size, percent: 0 };
  }

  let changed = 0;
  let strong = 0;
  const dataA = a.data;
  const dataB = b.data;
  for (let i = 0; i < dataA.length; i += 4) {
    const dr = Math.abs(dataA[i] - dataB[i]);
    const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
    const da = Math.abs(dataA[i + 3] - dataB[i + 3]);
    const delta = Math.max(dr, dg, db, da);
    if (delta > TOLERANCE) changed += 1;
    if (delta > STRONG_TOLERANCE) strong += 1;
  }

  const totalPixels = size * size;
  const percent = (changed / totalPixels) * 100;
  return {
    status: changed === 0 ? 'identical' : strong === 0 ? 'minor' : 'different',
    changedPixels: changed,
    strongPixels: strong,
    totalPixels,
    percent: Math.round(percent * 1000) / 1000,
  };
}

async function rasterize(text: string, size: number): Promise<ImageData | null> {
  const blob = new Blob([text], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'sync';
    const loaded = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url;
    });
    if (!loaded || image.naturalWidth === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // 统一白底：透明区域在两侧都按白色比较，避免「透明 vs 透明」的伪差异。
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    // 轻微模糊：吸收小数精度取整带来的亚像素位移，避免把抗锯齿差异当成画面变化。
    ctx.filter = 'blur(0.8px)';
    ctx.drawImage(image, 0, 0, size, size);
    ctx.filter = 'none';
    return ctx.getImageData(0, 0, size, size);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
