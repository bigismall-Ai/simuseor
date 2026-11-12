/** 两个对照页共用的静态假数据，保证截图可复现、不依赖后端。 */

export type LabFileType = 'gguf' | 'safetensors' | 'ckpt' | 'zip';

export interface LabModel {
  id: string;
  name: string;
  author: string;
  source: string;
  downloads: number;
  likes: number;
  tags: string[];
  fileType: LabFileType;
  params: string;
  size: string;
  updated: string;
  /** 有封面时的图片地址。样例图取自 Civitai 的作者预览图，仅用于实验页 */
  image?: string;
}

export interface LabFile {
  path: string;
  size: number;
  picked: boolean;
}

export interface LabRow {
  id: string;
  name: string;
  repo: string;
  source: string;
  sizeBytes: number;
  fileCount: number;
  tags: string[];
  favorite: boolean;
  review: 'untried' | 'keep' | 'discard';
  updated: string;
  fileType: LabFileType;
}

/** 文件类型 → 语义色。这是「编码」不是「强调」，所以可以多色；强调色仍只留一处。 */
export const TYPE_COLOR: Record<LabFileType, string> = {
  gguf: '#1D9E75',
  safetensors: '#378ADD',
  ckpt: '#D85A30',
  zip: '#888780',
};

export const LAB_MODELS: LabModel[] = [
  {
    id: 'civitai/smooth-workflow-wan-2-2',
    name: 'Smooth Workflow Wan 2.2 (I2V/T2V/first2last frame/MMAudio)',
    author: 'DigitalPastel',
    source: 'Civitai',
    downloads: 126600,
    likes: 1240,
    tags: ['wan 2.2', 'i2v', 'workflow'],
    fileType: 'zip',
    params: 'WAN 2.2',
    size: '1.3G',
    updated: '2026-11-03',
    image: 'samples/shot-2.jpg',
  },
  {
    id: 'civitai/flux-kontext-megapack',
    name: 'FLUX.1-DEV & Kontext Workflows Megapack',
    author: 'Daedalus_7',
    source: 'Civitai',
    downloads: 110300,
    likes: 2310,
    tags: ['flux.1 d', 'kontext', 'workflow'],
    fileType: 'zip',
    params: 'FLUX.1-D',
    size: '2.4G',
    updated: '2026-10-28',
    image: 'samples/shot-6.jpg',
  },
  {
    id: 'huggingface/Qwen3.5-4B-3D-Coder',
    name: 'Qwen3.5-4B-3D-Coder',
    author: 'ccore',
    source: 'Hugging Face',
    downloads: 157200,
    likes: 725,
    tags: ['safetensors', 'qwen3_5', 'code'],
    fileType: 'safetensors',
    params: '4B',
    size: '7.9G',
    updated: '2026-11-06',
  },
  {
    id: 'huggingface/Wan2.2-I2V-A14B',
    name: 'WAN_2.2_I2V_14B',
    author: 'UmeAiRT',
    source: 'Hugging Face',
    downloads: 106300,
    likes: 880,
    tags: ['wan', 'i2v', 'gguf'],
    fileType: 'gguf',
    params: '14B',
    size: '8.3G',
    updated: '2026-11-05',
  },
  {
    id: 'modelscope/Qwen-Image-2.1-Turbo',
    name: 'Qwen-Image-2.1-Turbo-Quantized',
    author: 'abenzers',
    source: 'ModelScope',
    downloads: 233100,
    likes: 5740,
    tags: ['gguf', 'image-generation', 'comfyui'],
    fileType: 'safetensors',
    params: 'Turbo',
    size: '12.4G',
    updated: '2026-11-03',
  },
  {
    id: 'civitai/wan-2-2-aio',
    name: 'WAN 2.2 AIO · T2V / I2V / S2V / TI2I / MMAudio',
    author: 'K3NK',
    source: 'Civitai',
    downloads: 83800,
    likes: 960,
    tags: ['wan2.2', 'aio', 'lightning'],
    fileType: 'ckpt',
    params: 'WAN 2.2',
    size: '18.2G',
    updated: '2026-11-07',
    image: 'samples/shot-4.jpg',
  },
  {
    id: 'huggingface/Flux-GGUF-Q4',
    name: 'Flux.1-dev-GGUF-Q4_K_S',
    author: 'city96',
    source: 'Hugging Face',
    downloads: 412000,
    likes: 8900,
    tags: ['gguf', 'flux', 'quantized'],
    fileType: 'gguf',
    params: '12B',
    size: '6.8G',
    updated: '2026-10-22',
  },
  {
    id: 'civitai/sdxl-realistic-xl',
    name: 'Realistic XL v5 (photoreal finetune)',
    author: 'moozy',
    source: 'Civitai',
    downloads: 921400,
    likes: 24500,
    tags: ['sdxl', 'photoreal', 'people'],
    fileType: 'safetensors',
    params: 'SDXL',
    size: '6.5G',
    updated: '2026-09-30',
    image: 'samples/shot-5.jpg',
  },
];

export const LAB_FILES: LabFile[] = [
  { path: 'wan2.2_i2v_14B_Q4_K_S.gguf', size: 8_120_000_000, picked: true },
  { path: 'wan2.2_i2v_14B_Q8_0.gguf', size: 15_600_000_000, picked: false },
  { path: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', size: 6_740_000_000, picked: true },
  { path: 'clip_vision_h.safetensors', size: 1_260_000_000, picked: false },
  { path: 'README.md', size: 24_800, picked: false },
];

export const LAB_LIBRARY: LabRow[] = [
  {
    id: 'l1',
    name: 'WAN_2.2_I2V_14B',
    repo: 'huggingface/Wan2.2-I2V-A14B',
    source: 'Hugging Face',
    sizeBytes: 21_430_000_000,
    fileCount: 3,
    tags: ['wan', 'i2v', 'gguf'],
    favorite: true,
    review: 'keep',
    updated: '2026-11-05',
    fileType: 'gguf',
  },
  {
    id: 'l2',
    name: 'Qwen3.5-4B-3D-Coder',
    repo: 'huggingface/Qwen3.5-4B-3D-Coder',
    source: 'Hugging Face',
    sizeBytes: 7_930_000_000,
    fileCount: 1,
    tags: ['qwen3_5', 'code'],
    favorite: false,
    review: 'untried',
    updated: '2026-11-06',
    fileType: 'safetensors',
  },
  {
    id: 'l3',
    name: 'Realistic XL v5',
    repo: 'civitai/sdxl-realistic-xl',
    source: 'Civitai',
    sizeBytes: 6_500_000_000,
    fileCount: 2,
    tags: ['sdxl', 'photoreal'],
    favorite: true,
    review: 'keep',
    updated: '2026-09-30',
    fileType: 'safetensors',
  },
  {
    id: 'l4',
    name: 'Smooth Workflow Wan 2.2',
    repo: 'civitai/smooth-workflow-wan-2-2',
    source: 'Civitai',
    sizeBytes: 1_310_000_000,
    fileCount: 1,
    tags: ['workflow', 'wan 2.2'],
    favorite: false,
    review: 'keep',
    updated: '2026-11-03',
    fileType: 'zip',
  },
  {
    id: 'l5',
    name: 'Flux.1-dev-GGUF-Q4_K_S',
    repo: 'huggingface/Flux-GGUF-Q4',
    source: 'Hugging Face',
    sizeBytes: 6_800_000_000,
    fileCount: 4,
    tags: ['flux', 'gguf', 'quantized'],
    favorite: false,
    review: 'untried',
    updated: '2026-10-22',
    fileType: 'gguf',
  },
  {
    id: 'l6',
    name: 'WAN 2.2 AIO',
    repo: 'civitai/wan-2-2-aio',
    source: 'Civitai',
    sizeBytes: 18_200_000_000,
    fileCount: 5,
    tags: ['wan2.2', 'aio'],
    favorite: false,
    review: 'discard',
    updated: '2026-11-07',
    fileType: 'ckpt',
  },
  {
    id: 'l7',
    name: 'Qwen-Image-2.1-Turbo-Quantized',
    repo: 'modelscope/Qwen-Image-2.1-Turbo',
    source: 'ModelScope',
    sizeBytes: 12_400_000_000,
    fileCount: 2,
    tags: ['image-generation', 'comfyui'],
    favorite: true,
    review: 'untried',
    updated: '2026-11-03',
    fileType: 'safetensors',
  },
];
