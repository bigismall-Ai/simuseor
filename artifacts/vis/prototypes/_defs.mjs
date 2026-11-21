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
    navLabel: '资产卡片原型',
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
        ['④ 状态槽', '左状态 · 半透明白线 · 右 = 本地磁盘大小 / 发现点赞 / 工作流文件大小 / 节点类数。'],
        ['⑤ 分类标签', '只放一枚：模型 = 文件类型，工作流 = 自定义分组，节点 = **它提供什么**（节点类代表名 + 「+N」；一个节点类都不提供的给「管理面板」）。'],
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
          sub: '真实封面 / 兜底封面 · 白线左侧换成下载量，右侧换成点赞',
          cards: [
            {
              onShot: true, family: 'flux', motif: 0, photo: '../../wf-covers/flux1-dev.jpg',
              mark: logo('flux', 'FLUX'),
              brand: 'FLUX.1', author: 'black-forest-labs', origin: 'HF',
              name: 'FLUX.1-dev.safetensors', meta: '文生图',
              slot: { text: '↓ 86,200', size: '♥ 1,200' },
              tag: 'Checkpoint', cta: '下载',
            },
            {
              family: 'hunyuan', motif: 0,
              mark: img('hunyuan', 'Hunyuan'),
              brand: 'Hunyuan', author: 'tencent', origin: 'MS',
              name: 'hunyuan-video-1.5.safetensors', meta: '文生视频',
              slot: { text: '↓ 41,600', size: '♥ 840' },
              tag: 'Checkpoint', cta: '下载',
            },
          ],
          caption: '发现页与本地库完全同构：右上角同样是原站链接，白线左侧从' +
            '「在库 / 权重缺失」换成「下载量」，右侧从「磁盘大小」换成「点赞」。' +
            '搜索接口暂时不返回文件大小，不拿「—」占位 —— 下载量回答「有多少人用」，' +
            '点赞回答「用过的人认不认」，两者同一层但不是同一件事。标签同样只标文件类型。',
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
          sub: '真实预览图 / 铭牌兜底 · 白线右侧 = 节点类数',
          cards: [
            {
              onShot: true, family: 'sd3', motif: 1, photo: '../../wf-covers/flux-kontext.jpg',
              mark: { type: 'text', text: 'CM' },
              brand: 'Manager', author: 'ltdrdata', origin: 'GitHub',
              name: 'ComfyUI-Manager', meta: '扩展管理',
              slot: { text: '已启用', state: 'is-ok', size: '0 节点类' },
              tags: [
                { text: '管理面板', title: 'ComfyUI-Manager 的 NODE_CLASS_MAPPINGS 是空的 —— 它只提供面板，不提供节点类' },
              ],
              cta: '查看',
            },
            {
              family: 'other', motif: 3, plateMark: { mark: 'IP', label: 'Impact Pack' },
              mark: { type: 'text', text: 'IP' },
              brand: 'Impact', author: 'ltdrdata', origin: 'GitHub',
              name: 'ComfyUI-Impact-Pack', meta: '图像处理',
              slot: { text: '已启用', state: 'is-ok', size: '18 节点类' },
              tags: [
                { text: 'ImpactWildcardProcessor', mono: true, title: 'ImpactWildcardProcessor 等 18 个节点类' },
                { text: '+17', more: true },
              ],
              cta: '查看',
            },
            {
              family: 'wan', motif: 0, plateMark: { mark: 'WV', label: 'WanVideo' },
              mark: { type: 'text', text: 'WV' },
              brand: 'WanVideo', author: 'kijai', origin: 'GitHub',
              name: 'ComfyUI-WanVideoWrapper', meta: '视频生成',
              slot: { text: '缺 kornia、einops', state: 'is-warn', size: '12 节点类' },
              tags: [
                { text: 'WanVideoModelLoader', mono: true, title: 'WanVideoModelLoader 等 12 个节点类' },
                { text: '+11', more: true },
              ],
              cta: '补齐依赖',
            },
            {
              family: 'krea', motif: 2, plateMark: { mark: 'AC', label: 'ControlNet' },
              mark: { type: 'text', text: 'AC' },
              brand: 'ControlNet', author: 'Fannovel16', origin: 'GitHub',
              name: 'ComfyUI-Advanced-ControlNet', meta: '控制网',
              slot: { text: '未安装', size: '8 节点类' },
              tags: [
                { text: 'AdvancedControlNetApply', mono: true, title: 'AdvancedControlNetApply 等 8 个节点类' },
                { text: '+7', more: true },
              ],
              cta: '安装',
            },
          ],
          caption: '节点没有天然封面：有预览图就铺满整卡，没有就用**扩展铭牌**（标识 + 名字）填满封面区 —— ' +
            '与模型卡的家族铭牌同一逻辑，不再拿数字占位（同一个「N 节点类」也不该在封面上报两次）。' +
            '白线右侧是节点类数（节点没有磁盘大小，规模就是它提供多少节点类）。' +
            '标签栏放**它提供什么**：有节点类的给代表类名 + 「+N」（完整清单在详情页），' +
            '一个节点类都不提供的给「管理面板」（ComfyUI-Manager 的 NODE_CLASS_MAPPINGS 是空的 —— ' +
            '这类扩展**节点类数恒为 0**，别拿数字硬凑）。' +
            '这是节点扩展唯一独有的决策问题：「我要的那个节点类在不在这个包里」；' +
            '模型卡答「是什么文件」（Checkpoint / LoRA）、工作流卡答「属于哪类内容」（人物 / 电商），' +
            '同一层。安装方式不再进标签栏：动作按钮已经表达了（安装 / 补齐依赖 / 查看）。' +
            '标识块、双行身份、原站链接与模型卡一致。',
        },
        {
          id: 'pc-diff',
          title: '本地库 vs 发现页',
          sub: '左侧换状态，右侧换第二信号，主按钮换动作',
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
                  ['状态槽', '下载量 · 右侧点赞'],
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
   * 列表顶部样张页
   * ==================================================================== */
  {
    id: 'page-status',
    type: 'page-status',
    file: 'prototypes/page-status.html',
    status: 'active',
    navLabel: '页面状态原型',
    retireWhen: '组件页 §6.2 列表顶部章节（页头 / 状态条 / 筛选条）收编本骨架后',
    note: '列表顶部的统一骨架：页头 / 状态条 / 筛选条。' +
      '同一个位置、同一套几何，六页只换事实槽与筛选项。',
    data: {
      page: 'page-status',
      title: '列表顶部 · SiMuseor 原型',
      description: 'SiMuseor 原型页面：模型 / 工作流 / 节点的本地与发现页共用一套列表顶部骨架',
      brandSub: '司梦工作台',
      head: {
        title: '列表顶部 · 统一骨架',
        sub: '页头 / 状态条 / 筛选条 · 模型 / 工作流 / 节点 × 本地 / 发现',
      },
      spec: [
        ['① 页头', '只回答「这是哪一页」：kicker + 标题 + 至多一句 hint + 全局动作（扫描 / 分组 / 检测 / 去发现）。数量不进来。'],
        ['② 状态条', '只回答「现在看到多少」：主读数 + 2–3 条只读事实。筛选时写「42 / 128」；首次加载写「读取中…」。'],
        ['③ 筛选条', '只回答「怎么缩小范围」：搜索 → 分面 chips → 排序 / 视图。顺序固定，工具收在右端。'],
        ['④ 事实槽', '只放只读聚合（占用 / 分组 / 节点类 / 清单规模）。可点的状态与动作一律去 chips 或按钮，避免「看着能点」。'],
        ['⑤ 刷新', '属于「重新读数」，留在状态条右端；排序 / 视图属于「怎么看」，留在筛选条右端。两者不混。'],
      ],
      before: [
        ['模型库', '`.lib-summary` 一行读数；搜索 / 排序躲在右侧浮层里', '状态条「128 个模型 · 1.2 TB」；搜索 / 排序进筛选条，浮层只留分面'],
        ['模型发现', '数量挤在页头右侧；工具栏另起一个带框面板', '数量回到状态条；来源 / 任务 / 排序 / 视图同一条筛选行'],
        ['工作流库', '读数条 + 分组行 + 工具行 = 三行，边框各画各的', '状态行 + 筛选行 = 两行；分组管理进页头'],
        ['工作流发现', '没有数量；来源被塞进页头 hint', '数量进状态条；来源变成 chips，hint 删除'],
        ['节点管理', '4 个统计盒 + 一整块检测面板，页面被切成格子', '一行读数；检测进页头动作，结果用徽标，不占主位'],
        ['节点发现', '数量在面板底部，和排序挤在一起，刷新是文字按钮', '数量进状态条；分类 / 排序进筛选行，刷新收成图标'],
      ],
      sections: [
        {
          id: 'ps-model-mine',
          title: '模型 · 本地库',
          sub: '主读数 = 本机数量 · 事实 = 占用 / 权重缺失 · 搜索从浮层搬回顶部',
          header: {
            kicker: 'Models', title: '模型库',
            hint: '你的模型资产：装了什么、占多大、能不能跑。',
            actions: [{ text: '扫描入库' }, { text: '发现模型', primary: true }],
          },
          status: {
            count: 128, unit: '个模型',
            facts: [
              { label: '占用', value: '1.2 TB' },
              { label: '权重缺失', value: '3', tone: 'err' },
            ],
            filters: {
              search: '搜索名称或路径',
              groups: [],
              tools: { filter: '筛选', filterCount: 2, sort: '入库时间' },
            },
          },
          caption: '数量与占用原来是一行散字，搜索和排序又躲在右缘浮层里 —— 同一页的「看什么」被拆成两处。' +
            '现在状态条只读数，搜索 / 排序 / 浮层入口并到同一条筛选行；浮层只留多选分面。' +
            '模型库的分面是多选抽屉，不在筛选行重复一遍：筛选行只给入口和已选数量。' +
            '权重缺失是只读事实，用错误色；它不是筛选项，不会被误读成一个可点的过滤器。',
        },
        {
          id: 'ps-model-discover',
          title: '模型 · 发现',
          sub: '主读数 = 结果数 · 事实 = 来源合并 / 已入库 · 数量不再挤页头',
          header: {
            kicker: 'Models · Discover', title: '发现模型',
            hint: '', actions: [],
          },
          status: {
            count: '86+', unit: '个模型',
            facts: [
              { label: '合并', value: '3 个来源' },
              { label: '已入库', value: '12' },
            ],
            filters: {
              search: '搜索模型关键词，如 qwen / lora / flux',
              groups: [
                {
                  label: '来源',
                  chips: [
                    { text: '全部', count: 86, on: true },
                    { text: 'Hugging Face', count: 42 },
                    { text: 'ModelScope', count: 26 },
                    { text: 'Civitai', count: 18 },
                  ],
                },
                {
                  label: '任务',
                  chips: [
                    { text: '文生图', count: 48 },
                    { text: '文生视频', count: 12 },
                    { text: 'LoRA', count: 26 },
                  ],
                },
              ],
              tools: { sort: '综合', view: 'grid' },
            },
          },
          caption: '发现页以前把唯一一个数量塞进页头右侧：换一次筛选，页头跟着抖，而且和「这是哪一页」混在一起。' +
            '现在数量固定在状态条；来源不再写在 hint 里，而是变成第一组 chips —— 能点的来源就不该只是一句说明。' +
            '结果未取完时主读数保留「+」，与现有分页语义一致。',
        },
        {
          id: 'ps-workflow-mine',
          title: '工作流 · 本地库',
          sub: '主读数 = 已筛 / 全部 · 事实 = 占用 / 分组 / 缺依赖 · 三行收成两行',
          header: {
            kicker: 'Workflows', title: '工作流',
            hint: '',
            actions: [{ text: '分组管理' }, { text: '发现工作流', primary: true }],
          },
          status: {
            count: 128, unit: '个工作流',
            filtered: { visible: 42, total: 128 },
            facts: [
              { label: '占用', value: '2.4 GB' },
              { label: '分组', value: '14' },
            ],
            filters: {
              search: '搜索名称、原文件名或分组',
              groups: [
                {
                  label: '分组',
                  chips: [
                    { text: '全部', count: 128, on: true },
                    { text: '人物', count: 24 },
                    { text: '电商', count: 18 },
                    { text: '影视', count: 12 },
                    { text: '未分组', count: 9 },
                  ],
                },
                {
                  label: '状态',
                  chips: [
                    { text: '缺依赖', count: 6, tone: 'warn' },
                    { text: '就绪', count: 24 },
                    { text: 'API 格式', count: 7 },
                    { text: '无法解析', count: 5 },
                  ],
                },
              ],
              tools: { sort: '最近修改', view: 'grid' },
            },
          },
          caption: '这一页原来是三段：读数条、分组行、工具行，各自带一条边框；分组管理还占在读数条里。' +
            '现在读数和事实合并成状态行，搜索 / 分组 / 状态 / 排序 / 视图合并成筛选行；分组管理是数据动作，回到页头。' +
            '健康度只在状态 chips 里报一次（缺依赖 / 就绪 / 无法解析），事实槽不再重复同一个数字；' +
            '再点一次已选中的状态就退回全部，不必额外放一个「全部」chip。' +
            '「42 / 128」只在筛选生效时出现 —— 没有筛选时不该先让人读一个斜杠。',
        },
        {
          id: 'ps-workflow-discover',
          title: '工作流 · 发现',
          sub: '主读数 = 结果数 · 事实 = 来源 / 已入库 · 来源从 hint 变成 chips',
          header: {
            kicker: 'Workflows · Discover', title: '发现工作流',
            hint: '', actions: [],
          },
          status: {
            count: 128, unit: '个工作流',
            facts: [
              { label: '来源', value: '6 个' },
              { label: '文件', value: '214 个' },
            ],
            filters: {
              search: '搜索工作流，如 flux / wan / minimax',
              groups: [{
                label: '来源',
                chips: [
                  { text: '全部', count: 128, on: true },
                  { text: '官方模板', count: 32 },
                  { text: 'ComfyHub', count: 41 },
                  { text: 'Hugging Face', count: 12 },
                  { text: 'ModelScope', count: 8 },
                  { text: 'Civitai', count: 21 },
                  { text: 'GitHub', count: 14 },
                ],
              }],
              tools: { sort: '热门', view: 'grid' },
            },
          },
          caption: '这一页原来连数量都没有，六个来源写成页头的一句 hint —— 用户看完既不知道有多少结果，也不能只挑一个源。' +
            '现在数量进状态条、来源进 chips；hint 删除。发现页与本地工作流终于共享同一条顶部，只换读数与筛选项。',
        },
        {
          id: 'ps-node-mine',
          title: '节点 · 本地管理',
          sub: '主读数 = 已安装 · 事实 = 节点类 / 清单 · 4 个统计盒收成一行 · 检测进页头',
          header: {
            kicker: 'Nodes', title: '节点管理',
            hint: '',
            actions: [
              { text: '检测缺失', badge: '6', tone: 'warn' },
              { text: '发现节点', primary: true },
            ],
          },
          status: {
            count: 3, unit: '个已安装',
            facts: [
              { label: '可用节点类', value: '143' },
              { label: '清单规模', value: '6,045' },
            ],
            filters: {
              search: '搜索已装扩展或目录',
              groups: [{
                label: '状态',
                chips: [
                  { text: '全部', count: 3, on: true },
                  { text: '已启用', count: 3 },
                  { text: '已禁用', count: 0 },
                ],
              }],
              tools: { sort: '按名称' },
            },
          },
          caption: '四个统计盒是这一轮最大的「顶部占用」：每个数字各占一个带边框的盒子，下面再接一整块检测面板。' +
            '现在四个数字收进一行 —— 主读数「3 个已安装」，事实「143 个可用节点类 · 6,045 个清单」。' +
            '检测是低频动作，回到页头，用「6」的警示徽标保留结果；它不再和扩展列表抢页面主位。' +
            '页面标题下的解释句删除：解释只在空态出现。',
        },
        {
          id: 'ps-node-discover',
          title: '节点 · 发现',
          sub: '主读数 = 清单总量 · 事实 = 节点类 / 已安装 · 数量与排序各归其位',
          header: {
            kicker: 'Nodes · Discover', title: '发现节点',
            hint: '', actions: [],
          },
          status: {
            count: '6,045', unit: '个扩展',
            facts: [
              { label: '节点类', value: '45,849' },
              { label: '已安装', value: '3' },
            ],
            filters: {
              search: '搜扩展名或节点名，如 impact / sam / controlnet',
              groups: [{
                label: '类型',
                chips: [
                  { text: '全部', count: 6045, on: true },
                  { text: '工具', count: 3408 },
                  { text: '文生图', count: 496 },
                  { text: '文本', count: 381 },
                  { text: '音频', count: 372 },
                  { text: '更多 3', count: null },
                ],
              }],
              tools: { sort: '按节点数' },
            },
          },
          caption: '清单页的规模是它唯一的强信号，所以主读数就是「6,045 个扩展」，节点类总数紧跟在事实槽。' +
            '原来这句读数被压在面板底部、和排序挤在同一行，翻页时还会跟着面板走；现在它固定在状态条。' +
            '「刷新清单」是重新读数，收成状态条右端的刷新图标；分类与排序留在筛选行。',
        },
      ],
      diff: {
        columns: [
          {
            title: '三层各司其职',
            rows: [
              ['页头', '身份 + 全局动作；数量永远不进来'],
              ['状态条', '当前集合的读数与只读事实'],
              ['筛选条', '搜索 → 分面 → 排序 / 视图'],
              ['分隔', '一条 panel-2 底，中间一条 border-soft；不叠外框'],
            ],
          },
          {
            title: '读数与事实',
            rows: [
              ['读数', '20px/600 + 11.5px 单位；筛选时 42 / 128'],
              ['事实', '2–3 条，只读聚合；异常才用语义色'],
              ['加载', '保留 46px 高度，写「读取中…」，不跳版'],
              ['空态', '空库隐藏状态条，交给空态说明'],
            ],
          },
          {
            title: '工具归位',
            rows: [
              ['刷新', '状态条右端 · 重新读数'],
              ['排序', '筛选条右端 · 怎么看'],
              ['视图', '筛选条右端；只有一种视图时不出现'],
              ['数据动作', '扫描 / 分组 / 检测 → 页头'],
            ],
          },
        ],
      },
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
