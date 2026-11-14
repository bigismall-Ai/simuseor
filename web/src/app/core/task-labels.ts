/**
 * 源站原生 task 值 → 中文标签。
 *
 * 这些值来自各源站自己的模型类型字段（HF 的 pipeline_tag、Civitai 的 modelType、
 * ModelScope 的 task），是**发现页**用的词表。
 *
 * 与后端 `weight_class.TASK_LABELS` 是两套东西，别混：后端那套是本机模型的
 * 归一化分类（text_to_image / lora / controlnet …），由文件名与目录推断；
 * 这里的键是源站原样返回的字符串，同一个意思在不同站写法完全不同
 * （HF 的 image-text-to-text、Civitai 的 ComfyWorkflows）。
 *
 * 之所以单独放一个文件：发现页的筛选 chip 与模型卡的类型标签都要用这张表，
 * 放两处就会漂移 —— 筛选里显示英文、卡片里显示中文，是最容易出洋相的地方。
 */
export const SOURCE_TASK_LABELS: Record<string, string> = {
  // ---- Hugging Face pipeline_tag ----
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'video-to-video': '视频转视频',
  'image-text-to-text': '图文理解',
  'image-text-to-video': '图文生视频',
  'text-generation': '文生文',
  'text-to-speech': '语音合成',
  'automatic-speech-recognition': '语音识别',
  'audio-to-audio': '音频转换',
  'feature-extraction': '特征提取',
  'sentence-similarity': '文本向量',
  'text-ranking': '文本排序',
  'text-classification': '文本分类',
  'token-classification': '词元分类',
  'image-classification': '图像分类',
  'zero-shot-image-classification': '零样本图像分类',
  'image-segmentation': '图像分割',
  'object-detection': '目标检测',
  'question-answering': '问答',
  'translation': '翻译',
  'summarization': '摘要',
  'fill-mask': '掩码填充',
  'zero-shot-classification': '零样本分类',
  'any-to-any': '通用',
  'multiple-choice': '多选',
  'table-to-text': '表格转文本',
  'time-series-forecasting': '时序预测',

  // ---- Civitai modelType ----
  Checkpoint: '主模型',
  LORA: 'LoRA',
  LoCon: 'LoCon',
  VAE: 'VAE',
  Controlnet: 'ControlNet',
  TextualInversion: '文本反转',
  TextEncoder: '文本编码器',
  Upscaler: '放大模型',
  Embedding: '嵌入',
  Hypernetwork: '超网络',
  'Motion Module': '动作模块',
  'Style Model': '风格模型',
  'Aesthetic Gradient': '美学梯度',
  Poses: '姿势',
  Wildcards: '通配符',
  ComfyWorkflows: '工作流',
  LLM: '大语言模型',
  Other: '其它',
};

/** 源站 task 值 → 中文标签；没有收录就原样返回（宁可显示原文，也不要瞎翻） */
export function sourceTaskLabel(task: string): string {
  if (!task) return '';
  return SOURCE_TASK_LABELS[task] || task;
}
