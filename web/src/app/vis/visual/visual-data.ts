import { LibraryModel, LocalWorkflow, SearchItem } from '../../core/types';

/** 色彩页的两套色板（浅色水墨留白 / 深色极光界面）。 */
export const INK_COLORS = [
  { name: '宣纸', token: '--ink-paper', hex: '#ECE8DE', role: '页面底色 / 面板', text: '#222C28' },
  { name: '墨', token: '--ink-ink', hex: '#222C28', role: '正文 / 主操作', text: '#ECE8DE' },
  { name: '苔', token: '--ink-moss', hex: '#68756C', role: '次级文字', text: '#F6F1E8' },
  { name: '赭石', token: '--ink-accent', hex: '#B95E4E', role: '危险 / 少量强调', text: '#F6F1E8' },
  { name: '石灰', token: '--ink-stone', hex: '#C6C0B4', role: '分隔 / 边框', text: '#222C28' },
];

export const AURORA_COLORS = [
  { name: '极光底', token: '--aurora-bg', hex: '#0E1026', role: '页面底色', text: '#F6F4FF' },
  { name: '深海军蓝', token: '--aurora-panel', hex: '#0D1026', role: '面板 / 按钮', text: '#F6F4FF' },
  { name: '极光蓝', token: '--aurora-primary', hex: '#5658FF', role: '主操作 / 选中', text: '#F6F4FF' },
  { name: '品红', token: '--aurora-magenta', hex: '#E45CFF', role: '氛围强调', text: '#0E1026' },
  { name: '薄荷', token: '--aurora-mint', hex: '#54E8D1', role: '辅助强调', text: '#0E1026' },
  { name: '雪青', token: '--aurora-text', hex: '#F6F4FF', role: '正文', text: '#0E1026' },
];

export const COLOR_ROLES = [
  { role: '页面底色', ink: '宣纸 #ECE8DE', aurora: '极光底 #0E1026' },
  { role: '面板 / 卡片', ink: '纸面提亮 #F4F0E7', aurora: '深海军蓝 #0D1026' },
  { role: '主文字', ink: '墨 #222C28', aurora: '雪青 #F6F4FF' },
  { role: '次级文字', ink: '苔 #68756C', aurora: '雪青 70%' },
  { role: '主操作', ink: '墨 #222C28', aurora: '极光蓝 #5658FF' },
  { role: '危险 / 警示', ink: '赭石 #B95E4E', aurora: '赭石 #B95E4E' },
  { role: '边框 / 分隔', ink: '石灰 #C6C0B4', aurora: '白 18%' },
  { role: '氛围强调', ink: '—', aurora: '品红 #E45CFF / 薄荷 #54E8D1' },
];

/** 卡片页假数据 —— 组件与样式是真的，数据只为让它们渲染出东西。 */
export const SEARCH_ITEMS: SearchItem[] = [
  {
    id: 'flux1-dev',
    name: 'flux1-dev.safetensors',
    author: 'black-forest-labs',
    source: 'Hugging Face',
    description: 'FLUX.1 dev 权重',
    downloads: 128400,
    likes: 2400,
    tags: ['文生图', 'FLUX'],
    task: '文生图',
    url: '',
    updated_at: '2026-11-10',
  },
  {
    id: 'wan22-t2v',
    name: 'wan22-t2v.safetensors',
    author: 'Wan-AI',
    source: 'ModelScope',
    description: 'WAN 2.2 视频生成',
    downloads: 86400,
    likes: 1200,
    tags: ['文生视频', 'WAN'],
    task: '文生视频',
    url: '',
    updated_at: '2026-11-08',
  },
];

export const LIBRARY_MODELS: LibraryModel[] = [
  {
    id: 'sdxl-realvis',
    name: 'RealVisXL_V4.0_lightning.safetensors',
    repo_id: 'x',
    source: 'Civitai',
    local_path: '/models/RealVisXL_V4.0_lightning.safetensors',
    size_bytes: 68719476736,
    file_count: 1,
    tags: ['文生图', 'SDXL'],
    created_at: '2026-11-01',
    files: [],
    params: '6B',
  },
  {
    id: 'ltx-video',
    name: 'ltx-video-0.9.7-distilled.safetensors',
    repo_id: 'x',
    source: 'Hugging Face',
    local_path: '/models/ltx-video-0.9.7-distilled.safetensors',
    size_bytes: 5583457487,
    file_count: 1,
    tags: ['文生视频', 'LTX'],
    created_at: '2026-10-28',
    files: [],
    params: '2B',
  },
];

/** 工作流卡四态：ready / api / missing / broken。 */
export const WORKFLOWS: LocalWorkflow[] = [
  {
    name: 'wan22-t2v.json',
    path: '/workflows/wan22-t2v.json',
    folder: '',
    size: 24576000,
    mtime: 1763136000,
    nodes: 12,
    format: 'ui',
    main_model: 'wan2.2-t2v.safetensors',
    group: '视频',
    model_slots: [],
    deps: { have: [], missing: [] },
    node_deps: { have: [], missing: [], unknown: [] },
  },
  {
    name: 'flux1-dev.json',
    path: '/workflows/flux1-dev.json',
    folder: '',
    size: 12781585,
    mtime: 1763222400,
    nodes: 8,
    format: 'ui',
    main_model: 'flux1-dev.safetensors',
    model_slots: [],
    deps: { have: [], missing: [] },
    node_deps: { have: [], missing: [], unknown: [] },
  },
  {
    name: 'qwen-txt2img.json',
    path: '/workflows/qwen-txt2img.json',
    folder: '',
    size: 4404019,
    mtime: 1763136000,
    nodes: 6,
    format: 'ui',
    main_model: 'qwen-image.safetensors',
    group: '文生图',
    model_slots: [],
    deps: {
      have: [],
      missing: [
        { file: 'qwen-image.safetensors', node: 'UNETLoader', directory: 'diffusion_models', url: '' },
      ],
    },
    node_deps: { have: [], missing: [], unknown: [] },
  },
  {
    name: 'broken-workflow.json',
    path: '/workflows/broken-workflow.json',
    folder: '',
    size: 1126,
    mtime: 1763222400,
    nodes: 0,
    format: 'broken',
    main_model: '',
    error: 'JSON 语法错误：第 12 行缺少逗号',
    model_slots: [],
    deps: { have: [], missing: [] },
    node_deps: { have: [], missing: [], unknown: [] },
  },
];
