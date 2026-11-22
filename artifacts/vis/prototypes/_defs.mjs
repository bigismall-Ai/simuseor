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
              onShot: true, family: 'qwen', motif: 3, photo: '../../../web/public/samples/shot-2.jpg',
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
              onShot: true, family: 'flux', motif: 0, photo: '../../../web/public/samples/shot-4.jpg',
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
              onShot: true, family: 'wan', motif: 1, photo: '../../../web/public/samples/shot-5.jpg',
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
              onShot: true, family: 'hunyuan', motif: 2, photo: '../../../web/public/samples/shot-6.jpg',
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
              onShot: true, family: 'sd3', motif: 1, photo: '../../../web/public/samples/shot-2.jpg',
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
              search: '搜索工作流，如 flux / wan',
              groups: [{
                label: '来源',
                chips: [
                  { text: '全部', count: 128, on: true },
                  { text: '模板', count: 32 },
                  { text: 'CH', count: 41 },
                  { text: 'HF', count: 12 },
                  { text: 'MS', count: 8 },
                  { text: 'CI', count: 21 },
                  { text: 'GH', count: 14 },
                ],
              }],
              tools: { sort: '热门', view: 'grid' },
            },
          },
          caption: '这一页原来连数量都没有，六个来源写成页头的一句 hint —— 用户看完既不知道有多少结果，也不能只挑一个源。' +
            '现在数量进状态条、来源进 chips；hint 删除。六个站点全用缩写（模板 / CH / HF / MS / CI / GH），' +
            '全名留在 title 气泡里 —— 900–1200 宽时缩写能让筛选行保持一行。' +
            '发现页与本地工作流终于共享同一条顶部，只换读数与筛选项。',
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
   * 统一页头样张页（页头已定稿 + 搜索筛选统一方案）
   * --------------------------------------------------------------------
   * 2026-11-21：页头组件（web/src/app/ui/page-header.component.ts）本身已统一，
   * 不统一的是「页头承载的信息层级」。本页先把定稿的分层页头画一遍（三组页面 ×
   * 本地库 / 发现 = 6 个页头实例），再在同一个原型里给出「搜索 + 筛选」的统一方案。
   * 本轮只做视觉参考与手册登记 —— 产品侧零改动。
   * ==================================================================== */
  {
    id: 'page-header',
    type: 'page-header',
    file: 'prototypes/page-header.html',
    status: 'active',
    navLabel: '页头与筛选',
    retireWhen: '组件页 §6.2 页头章节（s-36）收编本页头结构后',
    note: '统一页头的定稿视觉参考（6 个页头实例）+ 搜索与筛选统一视觉方案'
      + '（现状盘点 · 三套候选 · 推荐与代价 · 空结果三态）。',
    data: {
      page: 'page-header',
      title: '统一页头与搜索筛选 · SiMuseor 原型',
      description: 'SiMuseor 原型页面：六页统一页头（已定稿）+ 搜索与筛选统一视觉方案',
      brandSub: '司梦工作台',
      head: {
        title: '统一页头（定稿） · 搜索 + 筛选',
        sub: '六页页头实例 + 搜索筛选统一方案（三套候选）',
      },
      spec: [
        ['① kicker（区）', '只标归属：Models / Workflows / Nodes。视图名不再拼进这一行。'],
        ['② title + 视图切换', '标题说这页是什么；「本地库 / 发现」是控件，用 segmented 表达，不拼进标题。'],
        ['③ hint', '至多一句、≤40 字，只说「这页是干什么的」，不教怎么用（§7.5）。'],
        ['④ 主操作区（右）', '至多一个主按钮 + 一个次要按钮，同排右对齐不换行；无动作则整区留空，不留占位。'],
      ],
      now: {
        head: ['页面', 'kicker（现状 → 定稿）', 'title', 'hint（定稿）', '右侧动作（定稿）'],
        rows: [
          ['工作流 · 本地库', 'Workflows → Workflows', '工作流', '本机的工作流：装了什么、能不能直接跑。', '分组管理（主）〔撤掉「发现工作流」〕'],
          ['工作流 · 发现', 'Workflows · Discover → Workflows', '发现工作流', '从各来源找工作流，下载后就能跑。', '（整区留空）'],
          ['模型库 · 本地库', 'Models → Models', '模型库', '你的模型资产：装了什么、占多大、能不能跑。', '扫描入库（主）〔撤掉「发现模型」〕'],
          ['模型库 · 发现', 'Models · Discover → Models', '发现模型', '跨源搜索合并为一个列表。', '（整区留空）'],
          ['节点管理 · 本地库', 'Nodes → Nodes', '节点管理', '已装的节点包：提供了什么、缺哪些文件。', '检测缺失（主 · 徽标 3）〔撤掉「发现节点」〕'],
          ['节点管理 · 发现', 'Nodes · Discover → Nodes', '发现节点', '搜节点扩展，装上就能用。', '（整区留空）'],
        ],
        foot: '现状的三处毛病都在信息层级，不在组件：① kicker 把「区」和「视图」混进一行'
          + '（Models · Discover 这种写法作废）；② hint 四页三种口径、两页是空的；'
          + '③ 右侧动作区有无不定，本地页两个按钮、发现页空着。'
          + '定稿后逐页对到上表右半边 —— 六页的完整实例在下一节。',
      },
      scheme: {
        spec: [
          ['四区', 'kicker（区）→ 标题 + 视图切换 → hint（一句）→ 右侧动作区。'],
          ['视图切换', 'segmented（本地库 / 发现）—— 产品既有控件，§3.7.3 已登记为视图切换的表达，全站不再有第二种。'],
          ['动作区', '本地库页留一个主按钮（分组管理 / 扫描入库 / 检测缺失）；发现页整区留空。'],
          ['手册', '§7.5 文案与命名 · §6 间距 4px 基准 · §3.7.3 资产卡统一骨架 · §3.7.7 页头结构。'],
        ],
        caption: '结构：kicker 只标区（Workflows / Models / Nodes），标题说这页是什么，'
          + '「本地库 / 发现」交给 segmented，右边只留一个本地维护动作。'
          + '窄屏（≤900）时标题行右边会挤 —— 届时先把 hint 折行，不要把切换控件挪位置。',
      },
      cost: {
        title: '三处代价（不是选项，是这套排布的附带后果）',
        why: [
          '① 「去发现」按钮与视图切换二选一 —— 同一件事两个入口，§7.2 口径不允许。'
            + '所以本地页撤掉「发现工作流 / 发现模型 / 发现节点」主按钮，由 segmented 承担；'
            + '本地页剩下的那一个动作（分组管理 / 扫描入库 / 检测缺失）升为主按钮。',
          '② 发现页的动作区整区留空 —— 刷新已经在状态条右端（见「列表顶部」原型 §5），'
            + '页头再放「刷新清单」就是两个刷新入口。若将来改成页头放刷新，须同步撤掉状态条那个图标。',
          '③ 工作流 / 节点四条 hint 原本是空的，本轮按「每页至多一句」新拟 —— '
            + '这是本轮唯一新增的产品文案，落产品前请把这四句过一遍。',
        ],
      },
      pages: [
        {
          group: '工作流', area: 'Workflows', view: '本地库', title: '工作流',
          hint: '本机的工作流：装了什么、能不能直接跑。',
          actions: [{ text: '分组管理', primary: true }],
        },
        {
          group: '工作流', area: 'Workflows', view: '发现', title: '发现工作流',
          hint: '从各来源找工作流，下载后就能跑。',
          actions: [],
        },
        {
          group: '模型库', area: 'Models', view: '本地库', title: '模型库',
          hint: '你的模型资产：装了什么、占多大、能不能跑。',
          actions: [{ text: '扫描入库', primary: true }],
        },
        {
          group: '模型库', area: 'Models', view: '发现', title: '发现模型',
          hint: '跨源搜索合并为一个列表。',
          actions: [],
        },
        {
          group: '节点管理', area: 'Nodes', view: '本地库', title: '节点管理',
          hint: '已装的节点包：提供了什么、缺哪些文件。',
          actions: [{ text: '检测缺失', badge: '3', primary: true }],
        },
        {
          group: '节点管理', area: 'Nodes', view: '发现', title: '发现节点',
          hint: '搜节点扩展，装上就能用。',
          actions: [],
        },
      ],
      sf: {
        now: {
          head: ['页面', '搜索框（占位文案）', '触发', '筛选维度用什么控件', '排序', '已选条件 / 清除', '空结果文案'],
          rows: [
            ['工作流 · 本地库', '搜索名称、原文件名或分组', '即时', 'chip 行 ×2（分组 / 状态）', '自造下拉菜单', 'chip 选中态 / 无清除入口', '还没有本地工作流 · 没有符合条件的工作流'],
            ['发现工作流', '搜索工作流，如 flux / wan', '回车或点「搜索」', 'chip 行（来源）', '原生 select', 'chip 选中态 / 无清除入口', '没有找到工作流'],
            ['模型库 · 本地库', '搜索名称或路径', '即时', '右侧浮层 rail 分面（4 维多选）', '原生 select', 'rail 内勾选 / 只有分面级「重置」', '库里还没有模型 · 没有匹配的模型'],
            ['发现模型', '搜索模型关键词，如 qwen', '300ms 防抖 + 回车', 'chip 行 ×2（来源 / 任务类型）', '原生 select', 'chip 选中态 / 无清除入口', '没有找到匹配的模型'],
            ['节点管理 · 本地库', '搜索已装扩展或目录', '即时', 'chip 行（状态）', '原生 select', 'chip 选中态 / 无清除入口', '还没装任何节点 · 没有匹配的节点'],
            ['发现节点', '搜扩展名或节点名，如 impact / sam / controlnet', '回车或点「搜索」', 'chip 行（类型 + 「更多 N」）', '原生 select', 'chip 选中态 / 无清除入口', '没有找到节点'],
            ['下载任务', '（没有搜索框）', '—', 'segmented 分段（任务状态）', '（没有排序）', 'segmented 选中态 / 无清除入口', '暂无X任务'],
          ],
          foot: '数出来一共几套写法：搜索 3 套（即时 / 回车提交 / 防抖 300ms）、筛选 3 套控件'
            + '（chip 行 / 右侧 rail 分面 / segmented 分段）、排序 2 套（自造菜单 1 处、原生 select 5 处）、'
            + '空态 1 个组件但三态只分了两档（搜索无匹配 与 筛选后为空，在任何一页都没分开过）、'
            + '「清除全部筛选」0 处（模型库只有分面级的「重置」）。'
            + '外壳本身已经统一（ui-collection-bar = 状态行 + 筛选行，六页共用），'
            + '所以要统一的不是布局，是壳里面这几样：写法、措辞、可见性。',
        },
        final: {
          id: 'sf-final',
          tag: '定稿',
          name: '一行筛选条 ＋「筛选」浮层',
          sub: '搜索框 → 站点筛选 → 筛选按钮（带徽标）→ 排序 → 读数与清除全部',
          spec: [
            ['一行里放什么', '从左到右：搜索框 → 站点筛选（chip 行）→「筛选」按钮（漏斗图标 ＋ 已选条件徽标）'
              + '→ 排序下拉 → 视图切换 → 行右端的结果读数与「清除全部筛选」。'],
            ['其余类别筛选去哪', '全部收进「筛选」按钮点开的浮层（div 浮层，锚在按钮下方）—— 模型类型 / 任务、'
              + '用途、格式、排序权重等不属于「站点」的维度。浮层里分组呈现：分组标题 ＋ 每组的选项 chip ＋ 每项计数；'
              + '底部有「清除全部」与「完成」。'],
            ['站点筛选为什么留在外面', '站点是最常用的一层（先定从哪个站找），留在外面一行可见；'
              + '类别维度多且低频，收进浮层。两层是两件事 —— 站点决定「从哪儿找」，类别决定「找什么样的」。'],
            ['筛选维度控件', '沿用已定：chip 行直陈，阈值 ≤2 组 / 每组 ≤6 项；超出收进浮层。'],
            ['排序控件', '沿用已定：原生 select，选项「按 X」句式。'],
            ['结果读数', '沿用 page-status 既有格式：有筛选时「42 / 128 个模型」，无筛选时「128 个模型」。'
              + '读数落在这一行最右端，紧邻「清除全部筛选」—— 读数与产生它的控件同排。'],
            ['空结果三态', '沿用已定：集合为空 / 搜索无匹配 / 筛选后为空，三态分开写。'],
          ],
          bar: {
            search: { placeholder: '搜索模型关键词，如 qwen', clear: true },
            sites: {
              label: '按站点筛选',
              chips: [
                { text: '全部站点', on: true },
                { text: 'HuggingFace' },
                { text: 'ModelScope' },
                { text: 'Civitai' },
                {
                  text: 'GitHub',
                  off: true,
                  tip: '探针不可达：DNS 解析失败',
                  aria: 'GitHub（不可用：探针不可达，DNS 解析失败）',
                },
              ],
            },
            pop: {
              label: '筛选',
              count: 2,
              facets: [
                { key: 'task', label: '任务类型', items: [
                  { text: '写实', count: 12, on: true },
                  { text: '风格', count: 18 },
                  { text: '角色', count: 9 },
                  { text: '角色一致性', count: 5 },
                ] },
                { key: 'usage', label: '用途', items: [
                  { text: '主模型', count: 21 },
                  { text: 'LoRA', count: 14 },
                  { text: '文本编码器', count: 8 },
                  { text: 'VAE', count: 3 },
                ] },
                { key: 'format', label: '格式', items: [
                  { text: 'safetensors', count: 34, on: true },
                  { text: 'gguf', count: 12 },
                  { text: 'ckpt', count: 5 },
                ] },
                { key: 'weight', label: '排序权重', items: [
                  { text: '下载量', count: 40 },
                  { text: '点赞', count: 30 },
                  { text: '最新入库', count: 20 },
                  { text: '文件大小', count: 10 },
                ] },
              ],
            },
            sort: '综合',
            view: 'grid',
            count: { visible: '42', total: '128', unit: '个模型' },
            clearAll: '清除全部筛选',
          },
          caption: '这一行就是最终形态：左边是「在哪儿找」（关键词 ＋ 站点），'
            + '中间是「筛得更细」（筛选按钮，其余类别维度在浮层里），'
            + '右边是「怎么看」（排序、视图）与「看到了多少」（读数、清除全部筛选）。',
          hint: '浮层可以真的点开：点「筛选」按钮 → 浮层出现；点「完成」/ 右上角 ✕ / 按 Esc / 点浮层外面 → 收起。'
            + '徽标随浮层里的已选项实时变；「清除全部」把浮层里的已选项清空、徽标归零。'
            + '灰置的站点项不可点，鼠标移上去出提示气泡 —— 原因不印在页面上，页面保持干净。',
        },
        layers: {
          title: '站点筛选 与 类别筛选 是两件事',
          lead: '不是把两个东西换了个位置 —— 是分成两层：站点留在外面一行可见（最常用的一层），'
            + '其余类别维度收进「筛选」浮层。站点决定「从哪儿找」，类别决定「找什么样的」；'
            + '两层各自独立、各自可清。',
          rows: {
            head: ['层', '有哪些', '回答什么问题', '控件与位置'],
            rows: [
              ['站点筛选', 'HuggingFace / ModelScope / Civitai / GitHub / 官方模板 / ComfyHub 等来源站',
                '从哪儿找', 'chip 行 · 留在外面一行'],
              ['类别筛选', '模型类型 / 任务、用途、格式、排序权重等',
                '找什么样的', '分组 chip ＋ 每项计数 · 在「筛选」浮层里'],
            ],
          },
          probe: {
            head: ['探针状态', '是否作为可选项提供', '呈现'],
            rows: [
              ['可连接', '是', '正常 chip，可选'],
              ['不可达', '否', '灰置、不可点；hover 出提示气泡写原因（原因不印在页面上）'],
              ['未探测', '否', '灰置、不可点；hover 出提示气泡写「尚未探测」'],
            ],
          },
          foot: '站点候选项按源探针状态定：探针判定不可达 / 未探测的站不作为可选项提供 —— '
            + '与「探针判定不可连接的源不在发现页或下载页提供」同一条口径。'
            + '原因不印在页面上（页面保持干净），放进 hover 气泡。',
        },
        change: {
          title: '改了什么',
          why: [
            '① 上一轮说的是「双行分层：第二行铺完整类别筛选」，本轮取消第二行 —— '
              + '类别筛选从「铺在第二行」改为「收进「筛选」按钮点开的浮层」。'
              + '省下的代价：筛选条不再比内容区高出一截，首屏能看到的卡片行数不变。',
            '② 排序 / 视图 / 读数 / 清除全部筛选全部收进同一行：整条筛选条是一个工具条'
              + '（缩范围 → 怎么看 → 看到了多少），不再拆成两行，也不再有第二个面板常驻。',
            '③ 站点筛选留在外面可见（上一轮也定了），但与浮层里的类别筛选明确分层：'
              + '前者选「从哪儿找」，后者选「找什么样的」。',
            '④ 原 A 工具条式未采用：站点与类别两类筛选并排摊在一行，读者分不清哪枚 chip 管站、'
              + '哪枚管类；站点候选还要带 hover 提示，一行更挤。',
            '⑤ 原 C 侧栏分面未采用：六页里五页只有 1–2 个维度，常驻左栏换不回那点空间，'
              + '却让列表整体右移、卡片网格从 4 列掉到 3 列；侧栏还得靠分组标题把站点和类别分开读，'
              + '不如直接分层。',
          ],
          foot: '沿用上一轮已定的部分本轮不推翻：筛选维度控件（chip 行直陈）、'
            + '阈值规则（≤2 组 / 每组 ≤6 项）、排序控件（原生 select，选项「按 X」句式）、'
            + '结果计数写法（「42 / 128 个模型」）、'
            + '空结果三态（集合为空 / 搜索无匹配 / 筛选后为空）。',
        },
        empty: [
          {
            kind: '① 集合为空',
            cond: '还没装、还没下过东西',
            icon: '◍',
            title: '库里还没有模型',
            hint: '下载完成后会自动出现在这里，或用上面的「扫描入库」导入已有目录。',
            cta: { text: '去发现模型', primary: true },
          },
          {
            kind: '② 搜索无匹配',
            cond: '有东西，但没搜到',
            title: '没有找到匹配「qwen-xl」的结果',
            hint: '换个关键词，或清掉搜索词看全部。',
            keywords: ['qwen', 'flux', 'lora', 'sdxl'],
            cta: { text: '清空搜索' },
          },
          {
            kind: '③ 筛选后为空',
            cond: '搜到了，但被条件筛没了',
            title: '这 3 个筛选条件下没有内容',
            hint: '放宽其中一个条件试试，或者一次全清。',
            cta: { text: '清除全部筛选', primary: true },
          },
        ],
        emptyFoot: '三态必须分开 —— 今天六页里没有一页把「搜不到」和「筛没了」写成两句话。'
          + '最接近的一句是「换个关键词或筛选条件试试；也可能是这个分组下还没有工作流」，'
          + '两个原因挤在一句里，读者不知道自己该换词还是该松条件。'
          + '统一口径：① 空集合给下一步（去发现 / 扫描入库）；② 搜索无匹配 → 清掉搜索词；'
          + '③ 筛选后为空 → 松条件或全清。'
          + '标题里要带上触发原因（关键词 / 条件数），不能只说「没找到」。',
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
