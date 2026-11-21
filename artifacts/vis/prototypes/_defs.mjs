/* ============================================================================
 * VIS 原型页 · 定义层（Definition Layer）
 * ----------------------------------------------------------------------------
 * 这里是原型页**唯一手写处**。展示面（prototypes/*.html）是生成物，别手改。
 *
 * 每个原型一份定义，四个必填字段：
 *   id          原型标识（与文件名对应）
 *   type        形状名 —— 去 _types.mjs 找渲染器
 *   file        展示面输出路径（相对 artifacts/vis/）
 *   status      生命周期：active（在架） / retired（已退役）
 *
 * 生命周期口径（VIS v2.10）：
 *   实验类原型的使命是「比选」，一旦裁决落地就**必须退役** —— 留着会让
 *   读者以为候选还在可选。退役 = status 改 retired + 删掉展示面文件。
 *   vis-proto check 会盯着这两件事：
 *     · status=retired 但文件还在  -> FAIL（该删了）
 *     · 文件还在但注册表没有它      -> FAIL（野生文件）
 *
 * 【退役记录】保留在册，是「不许复活」的凭据。
 * ============================================================================ */

/** 工作流卡的通用图标（16 网格线性） */
const WF_ICON = {
  type: 'svg',
  body: '<circle cx="4" cy="4" r="1.6"/><circle cx="12" cy="8" r="1.6"/><circle cx="4" cy="12" r="1.6"/>\n      <path d="M5.4 4.8l5.2 2.4M5.4 11.2l5.2-2.4"/>',
};

/** 家族厂牌（浅/深两版） */
const logo = (slug, alt) => ({
  type: 'logo',
  src: `../../../web/public/families/${slug}.svg`,
  darkSrc: `../../../web/public/families/${slug}-dark.svg`,
  alt,
});

/** 家族厂牌（单版，无深色反白） */
const img = (slug, alt) => ({
  type: 'img',
  src: `../../../web/public/families/${slug}.svg`,
  alt,
});

export const PROTO_DEFS = [
  /* ======================================================================
   * 资产卡样张页
   * ==================================================================== */
  {
    id: 'cards',
    type: 'asset-cards',
    file: 'prototypes/cards.html',
    status: 'active',
    retireWhen: '组件页 §6.2 卡片章节（s-37 / s-38）收编本骨架后',
    note: '跨页复用的骨架原型：模型 / 工作流 / 节点共用一套卡片结构，' +
      '本地库与发现页只换状态槽左侧与主按钮。',
    data: {
      page: 'cards',
      title: '资产卡片 · SiMuseor 原型',
      description: 'SiMuseor 原型页面：模型 / 工作流 / 节点共用一套资产卡骨架',
      brandSub: '司梦工作台',
      head: {
        title: '资产卡片 · 统一骨架',
        sub: '模型 / 工作流 / 节点 · 封面铺满整卡，底部遮罩承载信息',
      },
      spec: [
        ['① 封面', '铺满整张卡。有真实图就铺图，没有就用家族色 + 几何纹样兜底。'],
        ['② 身份行', '32×32 标识块，内部图形 24×24；右侧「厂名 / 作者」上下两行。'],
        ['③ 原站', '右上角固定为原站链接，本地库与发现页同一个位置、同一种样式。'],
        ['④ 状态槽', '左状态 · 半透明白线 · 右大小（权重 / 磁盘 / 节点类数）。'],
        ['⑤ 分类标签', '只放一枚：模型 = 文件类型，工作流 = 自定义分组，节点 = 安装方式。'],
        ['⑥ 动作行', '⋯ 在左，主按钮在右。危险、补齐依赖等次要操作收进菜单。'],
      ],
      sections: [
        {
          id: 'pc-model-owned',
          title: '模型 · 本地库',
          sub: '真实封面 / 兜底封面 / 权重缺失 · 白线右侧 = 磁盘大小',
          cards: [
            {
              onShot: true, family: 'qwen', motif: 3, photo: '../../wf-covers/qwen-image.jpg',
              mark: img('qwen', 'Qwen'),
              brand: 'Qwen', author: 'Comfy-Org', origin: 'HF',
              name: 'Qwen-Image-Edit-2509.safetensors', meta: '图像编辑',
              slot: { text: '在库', state: 'is-ok', size: '20.4 GB' },
              tag: 'Checkpoint', cta: '查找适配工作流',
            },
            {
              family: 'sdxl', motif: 1,
              mark: logo('sdxl', 'SDXL'),
              brand: 'SDXL', author: 'WarmBloodAban', origin: 'HF',
              name: 'RealVisXL_V4.0_lightning.safetensors', meta: '文生图',
              slot: { text: '在库', state: 'is-ok', size: '6.5 GB' },
              tag: 'Checkpoint', cta: '查找适配工作流',
            },
            {
              family: 'flux', motif: 2,
              mark: logo('flux', 'FLUX'),
              brand: 'FLUX.1', author: 'black-forest-labs', origin: 'HF',
              name: 'flux_detail_tweaker.safetensors', meta: '文生图',
              slot: { text: '权重缺失', state: 'is-err', size: '0 B' },
              tag: 'LoRA', cta: '重新下载',
            },
          ],
          caption: '封面铺满整卡，底部信息压在半透明遮罩上；白线把状态和磁盘大小分开。' +
            '显存压力条与本机显存全部撤掉，本地库右上角也改为原站链接。' +
            '标签只保留模型文件类型（Checkpoint / LoRA），站点不在卡上重复。',
        },
        {
          id: 'pc-model-discover',
          title: '模型 · 发现',
          sub: '真实封面 / 兜底封面 · 白线左侧换成下载量',
          cards: [
            {
              onShot: true, family: 'flux', motif: 0, photo: '../../wf-covers/flux1-dev.jpg',
              mark: logo('flux', 'FLUX'),
              brand: 'FLUX.1', author: 'black-forest-labs', origin: 'HF',
              name: 'FLUX.1-dev.safetensors', meta: '文生图',
              slot: { text: '↓ 86,200', size: '12.0 GB' },
              tag: 'Checkpoint', cta: '下载',
            },
            {
              family: 'hunyuan', motif: 0,
              mark: img('hunyuan', 'Hunyuan'),
              brand: 'Hunyuan', author: 'tencent', origin: 'MS',
              name: 'hunyuan-video-1.5.safetensors', meta: '文生视频',
              slot: { text: '↓ 41,600', size: '13.2 GB' },
              tag: 'Checkpoint', cta: '下载',
            },
          ],
          caption: '发现页与本地库完全同构：右上角同样是原站链接，只有白线左侧从' +
            '「在库 / 权重缺失」换成「下载量」；标签同样只标文件类型。',
        },
        {
          id: 'pc-workflow',
          title: '工作流',
          sub: '本地库 / 发现 / 无法解析 · 白线右侧 = 文件大小',
          cards: [
            {
              onShot: true, family: 'wan', motif: 1, photo: '../../wf-covers/wf-kontext-kontext0.jpg',
              mark: WF_ICON,
              brand: 'Wan 2.2', author: 'kijai', origin: 'Civitai',
              name: 'wan22-t2v-14b.json', meta: '视频生成',
              slot: { text: '12 节点 · 3 依赖', size: '24.5 MB' },
              tag: '人物', cta: '编辑',
            },
            {
              family: 'flux', motif: 3,
              mark: WF_ICON,
              brand: 'FLUX.1', author: 'Comfy-Org', origin: 'Civitai',
              name: 'flux1-dev-basic.json', meta: '基础模型',
              slot: { text: '8 节点 · 2 依赖', size: '11.9 MB' },
              tag: '电商', cta: '编辑',
            },
            {
              family: 'other', motif: 0,
              broken: { title: '无法解析', msg: '文件头不是合法 JSON' },
              mark: { type: 'text', text: '?' },
              brand: '未知', author: '无法识别',
              name: 'broken-flow.json', meta: '未识别',
              slot: { text: '文件格式错误', state: 'is-err', size: '0 B' },
              tag: '未分组', cta: '查看文件',
            },
            {
              onShot: true, family: 'hunyuan', motif: 2, photo: '../../wf-covers/qwen-image-edit.jpg',
              mark: WF_ICON,
              brand: 'Hunyuan', author: 'Tencent-Hunyuan', origin: 'MS',
              name: 'hunyuan-video-t2v.json', meta: '视频生成',
              slot: { text: '16 节点 · 4 依赖', size: '8.4 MB' },
              tag: '影视', cta: '导入',
            },
            {
              family: 'sdxl', motif: 4,
              mark: WF_ICON,
              brand: 'SDXL', author: 'civitai', origin: 'Civitai',
              name: 'sdxl-inpaint-workflow.json', meta: '图像编辑',
              slot: { text: '9 节点 · 1 依赖', size: '3.1 MB' },
              tag: '修图', cta: '导入',
            },
          ],
          caption: '工作流的标题、节点数也落到底部遮罩里；标签只放一个自定义分组' +
            '（人物 / 电商 / 影视 / 修图），时间显示已移除。坏文件仍用斜纹 + 居中说明，' +
            '底部信息照常显示。',
        },
        {
          id: 'pc-node',
          title: '节点',
          sub: '真实预览图 / 计数兜底 · 白线右侧 = 节点类数',
          cards: [
            {
              onShot: true, family: 'sd3', motif: 1, photo: '../../wf-covers/flux-kontext.jpg',
              mark: { type: 'text', text: 'CM' },
              brand: 'Manager', author: 'ltdrdata', origin: 'GitHub',
              name: 'ComfyUI-Manager', meta: '扩展管理',
              slot: { text: '已启用', state: 'is-ok', size: '42 节点类' },
              tag: 'Git 安装', cta: '查看',
            },
            {
              family: 'other', motif: 3, count: '18',
              mark: { type: 'text', text: 'IP' },
              brand: 'Impact', author: 'ltdrdata', origin: 'GitHub',
              name: 'ComfyUI-Impact-Pack', meta: '图像处理',
              slot: { text: '已启用', state: 'is-ok', size: '18 节点类' },
              tag: '一键安装', cta: '查看',
            },
            {
              family: 'wan', motif: 0, count: '12',
              mark: { type: 'text', text: 'WV' },
              brand: 'WanVideo', author: 'kijai', origin: 'GitHub',
              name: 'ComfyUI-WanVideoWrapper', meta: '视频生成',
              slot: { text: '缺 kornia、einops', state: 'is-warn', size: '12 节点类' },
              tag: '手动安装', cta: '补齐依赖',
            },
            {
              family: 'krea', motif: 2, count: '8',
              mark: { type: 'text', text: 'AC' },
              brand: 'ControlNet', author: 'Fannovel16', origin: 'GitHub',
              name: 'ComfyUI-Advanced-ControlNet', meta: '控制网',
              slot: { text: '未安装', size: '8 节点类' },
              tag: '一键安装', cta: '安装',
            },
          ],
          caption: '节点没有天然封面：有预览图就铺满整卡，没有就把节点类数放在遮罩上方的' +
            '可见区域。节点类名属于详情页信息，不再上卡；标签只标安装方式（Git / 一键 / 手动），' +
            '标识块、双行身份、原站链接与模型卡一致。',
        },
        {
          id: 'pc-diff',
          title: '本地库 vs 发现页',
          sub: '只有白线左侧与主按钮换内容',
          diff: {
            columns: [
              {
                title: '本地库 · 我有的',
                rows: [
                  ['右上', '原站链接（与发现页一致）'],
                  ['状态槽', '在库 / 权重缺失 / 已启用 / 缺依赖 · 右侧大小'],
                  ['标签行', '模型文件类型 / 工作流分组 / 节点安装方式'],
                  ['主按钮', '查找适配工作流 / 重新下载 / 编辑 / 查看'],
                ],
              },
              {
                title: '发现页 · 去找',
                rows: [
                  ['右上', '原站链接：HF / MS / Civitai / GitHub ↗'],
                  ['状态槽', '下载量 · 右侧大小'],
                  ['标签行', '模型文件类型 / 工作流分组 / 节点安装方式'],
                  ['主按钮', '下载 / 导入 / 安装'],
                ],
              },
              {
                title: '封面填充',
                rows: [
                  ['真实图', 'cover 铺满整卡，底部深色遮罩承载信息'],
                  ['兜底', '家族色 + 5 种纹样，遮罩与白线不变'],
                  ['节点', '兜底时节点类数放在上半区，作为信息而不是占位'],
                ],
              },
            ],
          },
        },
      ],
    },
  },

  /* ======================================================================
   * 站点底纹变体集 —— 已退役
   * --------------------------------------------------------------------
   * 2026-11-21：v2 单束柔光定稿并落产品（VIS §3.10），比选使命完成。
   * 展示面文件已删除；变体表留在 VIS §3.10 作为裁决依据。
   * 不许复活 —— 候选不再是候选，留着会让人以为还能改。
   * ==================================================================== */
  {
    id: 'backgrounds',
    type: 'bg-variants',
    file: 'prototypes/backgrounds.html',
    status: 'retired',
    retiredAt: '2026-11-21',
    retireWhen: 'v2 单束柔光定稿并落产品（VIS §3.10）',
    note: '实验结束，文件已删除。变体表见 VIS §3.10「渐变变体集」；' +
      '调参不再靠原型页，改改 --grad-site-wash / --texture-site-paper 两枚 token。',
  },
];
