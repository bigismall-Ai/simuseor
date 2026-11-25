import { coverMeta } from '../core/cover';
import type { CoverInput, CoverMeta } from '../core/cover';
import { sourceAuthor, sourceLabel, sourceShort, sourceUrl } from '../core/source-links';
import { SOURCE_TASK_LABELS, folderFileTypeLabel, sourceTaskLabel } from '../core/task-labels';
import { fmtBytes, fmtInt } from '../core/types';
import type { LibraryModel, SearchItem } from '../core/types';
import type { CardMenuItem } from './card-menu';

/**
 * 模型卡唯一的数据契约。
 *
 * 本地库（LibraryModel）与发现（SearchItem[]）是同一批资产的两种状态，
 * 卡片不该维护两份模板。两个纯适配器把各自的原始字段摊平成这一份视图：
 * 组件只读 `ModelCardView`，不再认识 LibraryModel / SearchItem。
 *
 * 适配器里放的是**文案与状态口径**（损坏怎么叫、主按钮做什么、标签写什么），
 * 不放任何 DOM；封面 / 铭牌也在这里一次算好，组件只负责填槽位。
 */

/** 主按钮点下去到底该做哪件事；组件据此派发 output。 */
export type ModelCardActionKind = 'use' | 'download' | 'redownload' | 'open';

export type ModelCardStatusTone = '' | 'ok' | 'warn' | 'err';

export interface ModelCardAction {
  label: string;
  title: string;
  testId: string;
  kind: ModelCardActionKind;
}

export interface ModelCardOrigin {
  href: string;
  /** 动作行左侧的短名（HF / MS / Civitai / 本地导入） */
  label: string;
}

/** 32×32 厂牌位要的字段，来自 coverMeta。 */
export interface ModelCardMark {
  logo: string;
  logoDark: string;
  code: string;
  scale: number;
  title: string;
}

export interface ModelCardView {
  /** 卡片标题（模型全名） */
  title: string;
  /** 身份行第一行：家族名 */
  identName: string;
  /** 身份行第二行：发布者 / 作者 / 来源说明 */
  identSub: string;
  identSubTitle: string;
  /** 第二行是不是真·发布者（本地库据此只在有作者时挂 `.pill-author`） */
  identSubIsAuthor: boolean;
  /** 类别行：类别 + 规格 */
  meta: string;
  /** 状态槽左侧 */
  status: string;
  statusTitle: string;
  statusTone: ModelCardStatusTone;
  /** 状态槽右侧 */
  size: string;
  sizeTitle: string;
  /** ⑤ 唯一一枚分类标签 */
  tag: string;
  tagTitle: string;
  origin: ModelCardOrigin;
  action: ModelCardAction;
  menu: CardMenuItem[];
  /** 权重损坏 / 缺失：封面压警示层，照片不参与渲染 */
  broken: boolean;
  brokenTitle: string;
  brokenMsg: string;
  /** DEMO 占位文件：标签标红 */
  demo: boolean;
  /** 这张卡允许使用真实照片（损坏件即使是图也要让位给警示层） */
  onShot: boolean;
  /** 交给共享封面铭牌的字段 */
  plate: CoverInput;
  mark: ModelCardMark;
}

/** 查阅封面词表：与后端 `covers.PREFERENCE` 保持一致 */
const COVER_ORDER = ['modelscope', 'huggingface', 'civitai'];

/**
 * 「文件类型」词表 —— Civitai 的 modelType。
 *
 * 只有 Civitai 回答得了「这个文件是什么」（Checkpoint / LoRA / VAE…）；
 * HF / MS 的 task 是 pipeline 任务（text-to-image…），那是**类别**不是文件形态。
 */
const FILE_TYPES = new Set([
  'Checkpoint',
  'LORA',
  'LoCon',
  'VAE',
  'Controlnet',
  'TextualInversion',
  'TextEncoder',
  'Upscaler',
  'Embedding',
  'Hypernetwork',
  'Motion Module',
  'Style Model',
  'Aesthetic Gradient',
  'Poses',
  'Wildcards',
  'ComfyWorkflows',
  'LLM',
]);

/** 有原站、有仓库 id 的条目才能按原仓库 / 原版本 / 原文件重下 */
function canRedownload(model: LibraryModel): boolean {
  return (
    ['huggingface', 'modelscope', 'civitai'].includes(model.source) && !!model.repo_id
  );
}

function familyNameOf(meta: CoverMeta): string {
  return meta.code !== '—' ? meta.code : '未知家族';
}

function markOf(meta: CoverMeta): ModelCardMark {
  const familyCode = meta.code !== '—' ? meta.code : '';
  return {
    logo: meta.logo || '',
    logoDark: meta.logoDark || '',
    code: familyCode || (meta.publisher?.abbr ?? ''),
    scale: meta.logoScale || 1,
    title: meta.logo
      ? `${meta.code} 官方标识`
      : familyCode
        ? `${familyCode} 家族`
        : meta.publisher
          ? `未登记厂牌 · 发布方：${meta.publisher.label}`
          : '',
  };
}

/**
 * 本地库 → 卡片视图。
 *
 * 坏件的说法只在这里定义：封面警示层、状态槽与主按钮共用同一个来源，
 * 同一张卡上不会出现「权重损坏 / 文件格式错误」两种口径。
 */
export function fromLibraryModel(
  model: LibraryModel,
  options: { vramGb?: number; cover?: string } = {},
): ModelCardView {
  const { vramGb = 0, cover = '' } = options;
  const level = model.vram?.level;
  const broken = level === 'broken' || level === 'missing';
  const brokenTitle = level === 'broken' ? '权重损坏' : level === 'missing' ? '权重缺失' : '';
  const brokenMsg =
    level === 'broken'
      ? '有权重文件但头部解析失败'
      : level === 'missing'
        ? '目录里没有权重文件，下载不完整'
        : '';

  const plate: CoverInput = {
    id: model.id,
    name: model.name,
    tags: model.tags,
    image: broken ? undefined : cover || undefined,
  };
  const meta = coverMeta({
    id: model.repo_id,
    name: model.name,
    tags: model.tags || [],
  });

  const task = model.taskLabel || '未标注';
  const spec = [model.precision, model.params].filter(Boolean).join(' · ');
  const metaLine = [task, spec].filter(Boolean).join(' · ');

  const author = sourceAuthor(model.source, model.repo_id);
  const originLabel = model.isDemo
    ? '演示数据'
    : model.source === 'imported'
      ? '本地导入'
      : '未登记发布者';

  const fileType = model.isDemo
    ? 'DEMO'
    : folderFileTypeLabel(model.folder, model.folderLabel || '模型');
  const fileTypeTip = model.isDemo
    ? '离线演示占位文件，权重内容为假'
    : model.folderLabel
      ? `存放类型：${model.folderLabel}`
      : '文件类型未标注（存放目录不在已知分类里）';

  const redownloadable = canRedownload(model);
  const action: ModelCardAction = broken
    ? redownloadable
      ? {
          label: '重新下载模型',
          title: '按原仓库 / 原版本 / 原文件重新下载',
          testId: 'lib-card-primary',
          kind: 'redownload',
        }
      : {
          label: '打开目录',
          title: '本地导入条目没有原站仓库；打开目录查看或清理',
          testId: 'lib-card-primary',
          kind: 'open',
        }
    : {
        label: '查找适配工作流',
        title: '查找能运行它的工作流',
        testId: 'lib-card-primary',
        kind: 'use',
      };

  const statusTip =
    [model.vram?.text, model.vram?.hint].filter(Boolean).join(' · ') ||
    (!vramGb
      ? '本机未检测到独立显卡，无法判断能否运行'
      : (model.needGb ?? 0) > 0
        ? `显存压力 · 本机 ${vramGb.toFixed(0)} GB（估算值，实际占用取决于推理方式）`
        : '');

  return {
    title: model.name,
    identName: familyNameOf(meta),
    identSub: author || originLabel,
    identSubTitle: author ? `发布者：${author}` : originLabel,
    identSubIsAuthor: !!author,
    meta: metaLine,
    status: broken ? brokenTitle : '在库',
    statusTitle: statusTip,
    statusTone: broken ? 'err' : 'ok',
    size: fmtBytes(model.size_bytes),
    sizeTitle: '',
    tag: fileType,
    tagTitle: fileTypeTip,
    origin: {
      href: model.source_url || sourceUrl(model.source, model.repo_id),
      // 本地库卡历来写全名（Hugging Face），发现卡写短名（HF）；
      // 合并成一张卡后各自保持原样，除非要刻意统一口径，别顺手改。
      label: sourceLabel(model.source),
    },
    action,
    menu: [{ key: 'remove', label: '删除模型', danger: true, testId: 'lib-card-remove' }],
    broken,
    brokenTitle,
    brokenMsg,
    demo: !!model.isDemo,
    onShot: !broken,
    plate,
    mark: markOf(meta),
  };
}

/**
 * 发现条目（同一模型可能多来源）→ 卡片视图。
 *
 * 一组来源视为同一条资产：标题 / 身份 / 标签取主条目，
 * 下载量与点赞取各来源最大值（不让合并行看起来比单源还冷）。
 */
export function fromSearchItems(items: SearchItem[], cover = ''): ModelCardView {
  const primary = items[0];

  const shot = (() => {
    if (cover) return cover;
    for (const source of COVER_ORDER) {
      const hit = items.find((i) => i.source === source && !!i.image);
      if (hit) return hit.image;
    }
    return items.find((i) => !!i.image)?.image;
  })();

  const plate: CoverInput = {
    id: primary?.id || '',
    name: primary?.name || '',
    tags: primary?.tags || [],
    image: shot,
    author: primary?.author || '',
  };
  const meta = coverMeta(plate);

  const authors = [...new Set(items.map((i) => i.author).filter((a) => !!a))];
  const authorText = authors.join(' · ');

  const downloads = Math.max(...items.map((i) => i.downloads || 0), 0);
  const likes = Math.max(...items.map((i) => i.likes || 0), 0);

  const fileType = (() => {
    for (const it of items) {
      const t = (it.task || '').trim();
      if (FILE_TYPES.has(t)) return sourceTaskLabel(t);
    }
    return '';
  })();

  const category = (() => {
    for (const it of items) {
      const t = (it.task || '').trim();
      if (!t || FILE_TYPES.has(t)) continue;
      const label = sourceTaskLabel(t);
      if (label) return label;
    }
    for (const it of items) {
      for (const raw of it.tags || []) {
        const tag = (raw || '').trim();
        if (!tag || FILE_TYPES.has(tag)) continue;
        const label = SOURCE_TASK_LABELS[tag];
        if (label) return label;
      }
    }
    return '';
  })();

  const metaLine = [category, ...meta.specs.map((s) => `${s.k} ${s.v}`)]
    .filter(Boolean)
    .join(' · ');

  const originHref = primary?.url || '';
  const originLabel = primary ? sourceShort(primary.source) : '';

  const menu: CardMenuItem[] = items
    .filter((it) => !!it.url)
    .map((it) => ({
      key: `${it.source}:${it.id}`,
      label: sourceShort(it.source),
      href: it.url,
    }));

  return {
    title: primary?.name || '',
    identName: familyNameOf(meta),
    identSub: authorText || '—',
    identSubTitle: authorText || '来源未提供作者',
    identSubIsAuthor: !!authorText,
    meta: metaLine || '未标注',
    status: '↓ ' + fmtInt(downloads),
    statusTitle: '下载量：' + fmtInt(downloads),
    statusTone: '',
    size: '♥ ' + fmtInt(likes),
    sizeTitle: '点赞：' + fmtInt(likes),
    tag: fileType || '模型',
    tagTitle: fileType ? `文件类型：${fileType}` : '文件类型未标注',
    origin: { href: originHref, label: originLabel },
    action: { label: '下载', title: '', testId: 'card-download', kind: 'download' },
    menu,
    broken: false,
    brokenTitle: '',
    brokenMsg: '',
    demo: false,
    onShot: true,
    plate,
    mark: markOf(meta),
  };
}

/** 本地库卡在拿不到 model 时的空视图：不渲染任何假数据。 */
export const EMPTY_MODEL_CARD_VIEW: ModelCardView = {
  title: '',
  identName: '',
  identSub: '',
  identSubTitle: '',
  identSubIsAuthor: false,
  meta: '',
  status: '',
  statusTitle: '',
  statusTone: '',
  size: '',
  sizeTitle: '',
  tag: '',
  tagTitle: '',
  origin: { href: '', label: '' },
  action: { label: '', title: '', testId: '', kind: 'open' },
  menu: [],
  broken: false,
  brokenTitle: '',
  brokenMsg: '',
  demo: false,
  onShot: false,
  plate: { name: '' },
  mark: { logo: '', logoDark: '', code: '', scale: 1, title: '' },
};
