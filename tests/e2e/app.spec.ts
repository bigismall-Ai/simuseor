import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// 截图固定落在 tests/artifacts/，与执行目录无关
const ART = resolve(__dirname, '../artifacts');

const HUB_ITEM = {
  id: 'e6f74ca84e32', name: 'FLUX 3 Video: Text to Video', author: 'ComfyUI',
  source: 'comfyhub', description: 'Generate a short video from a text prompt.',
  downloads: 70000, likes: 0, tags: ['Text to Video'], task: 'Workflows',
  url: 'https://comfy.org/workflows/e6f74ca84e32', updated_at: '2026-10-28',
  files: ['e6f74ca84e32.json'], file_count: 1, target_folder: 'workflows',
  thumbnail: '', requires: ['模型:Flux'],
};

test.describe('Model Downloader Web UI', () => {
  // 版本列表靠 `git ls-remote` 现取（1–3 秒，且依赖外网），E2E 里固定返回：
  // 保证「安装实例」弹层每次都有可选项。真实抓取逻辑由后端单测覆盖。
  test.beforeEach(async ({ page }) => {
    await page.route((url) => url.pathname === '/api/comfy/versions', (route) =>
      route.fulfill({
        json: {
          tags: [
            { tag: 'v0.45.0', sha: '989d93d0d968', prerelease: false },
            { tag: 'v0.44.2', sha: 'e6515b16ed36', prerelease: false },
          ],
          source: 'mirror',
          cached: false,
        },
      }));
    // 默认挡住封面批量接口：E2E 用的是 E:/mock 假路径，
    // 放它打到真后端会把测试键写进 var/data/workflow_covers.json 并占掉图池名额。
    // 个别要用真封面响应的用例在后面注册自己的 route，后注册的优先。
    await page.route((url) => url.pathname === '/api/workflows/covers', (route) =>
      route.fulfill({ json: { covers: {}, pinned: [], custom: [] } }));
    // 封面画廊默认给空候选：假路径不该打到真后端，更不该占掉图池名额
    await page.route((url) => url.pathname === '/api/workflows/covers/candidates', (route) =>
      route.fulfill({ json: { key: '', covers: [] } }));
    await page.route((url) => url.pathname === '/api/workflows/covers/choose', (route) =>
      route.fulfill({ json: { key: '', cover: '', pinned: false, source: 'manual' } }));
    // 分组管理接口默认返回空：测试用假路径，不该读到本机真实分组/钉图
    await page.route((url) => url.pathname === '/api/workflows/groups', (route) =>
      route.fulfill({ json: { groups: [], defined: [] } }));
  });

  test('三个页面渲染与导航', async ({ page }) => {
    await page.goto('/downloads');
    await expect(page.getByText('新建下载')).toBeVisible();
    await expect(page.getByRole('link', { name: '下载任务' })).toBeVisible();
    await expect(page.locator('select').first().locator('option', { hasText: 'Demo' })).toHaveCount(0);
    await page.screenshot({ path: ART + '/01-downloads.png', fullPage: true });

    await page.getByRole('link', { name: '设置' }).click();
    await expect(page.getByText('默认策略').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hugging Face' })).toBeVisible();
    await page.screenshot({ path: ART + '/03-settings.png', fullPage: true });

    await page.locator('.nav > a[href="/models"]').click();
    await expect(page.getByRole('heading', { name: '模型库' })).toBeVisible();
    await page.screenshot({ path: ART + '/02-library.png', fullPage: true });
  });

  test('设置页：保存配置并测试代理', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: '测试代理' }).first().click();
    await expect(page.locator('.notice.is-inline.ok')).toHaveText('成功', { timeout: 15_000 });
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByText('设置已保存')).toBeVisible();
    await page.screenshot({ path: ART + '/07-settings-proxy.png', fullPage: true });
  });

  test('demo 源：解析 → 勾选 → 下载 → 入库', async ({ page }) => {
    await page.goto('/downloads?demo=1');

    await page.locator('select').first().selectOption('demo');
    await page.getByPlaceholder('如 microsoft/Phi-3-mini-4k-instruct').fill('demo/text-gen-1.5');
    await page.getByRole('button', { name: '解析文件' }).click();

    const fileTable = page.locator('.file-table');
    await expect(fileTable.getByText('model.safetensors').first()).toBeVisible();
    // 只展示真实权重：config / tokenizer / README 等非权重文件不进下载清单
    await expect(page.getByText('1 个权重')).toBeVisible();
    await expect(fileTable.getByText('README.md')).toHaveCount(0);
    await expect(fileTable.getByText('config.json')).toHaveCount(0);
    await page.screenshot({ path: ART + '/04-resolved-files.png', fullPage: true });

    await page.getByRole('button', { name: '开始下载' }).click();
    const firstTask = page.locator('.task').first();
    await expect(firstTask).toContainText('demo/text-gen-1.5');
    await expect(firstTask.locator('.head').getByText(/下载中|已完成/).first()).toBeVisible();
    await page.screenshot({ path: ART + '/05-downloading.png', fullPage: true });

    // demo 源下载约 16s，机器忙时会贴到 30s 上限，放宽到 45s 避免偶发超时
    await expect(firstTask.locator('.head').getByText('已完成').first()).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: ART + '/06-task-completed.png', fullPage: true });

    await page.locator('.nav > a[href="/models"]').click();
    await expect(page.getByText('text-gen-1.5').first()).toBeVisible();
    await page.screenshot({ path: ART + '/08-library-after-download.png', fullPage: true });

    // 模型库 v4：卡片是海报卡，收藏 / 评审已移除，压力条与卡片动作都在
    await expect(page.getByTitle('收藏')).toHaveCount(0);
    // 显存压力条已撤（统一骨架没有这一层）—— 撤掉之后不该再出现
    await expect(page.locator('md-library-card .gauge')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查找适配工作流' }).first()).toBeVisible();
  });

  test('下载任务：工作流与模型共用任务表，工作流标出类型', async ({ page }) => {
    const row = (id: string, kind: string, dir: string) => ({
      id, source: 'templates', repo_id: id, revision: 'main', strategy: 'direct',
      status: 'completed', target_dir: dir, total_bytes: 1024, done_bytes: 1024,
      created_at: '2026-11-14T00:00:00', kind,
      files: [{ id: id + '-f', path: 'a.json', size: 1024, done_bytes: 1024, status: 'completed', candidates: [] }],
    });
    await page.route((url: URL) => url.pathname === '/api/tasks', (route: any) =>
      route.fulfill({ json: [
        row('comfy/portrait-flow', 'workflow', 'E:/mock/workspace/userdata/default/workflows/portrait'),
        row('some/flux-checkpoint', 'model', 'E:/mock/workspace/models/checkpoints/flux'),
      ] }));

    await page.goto('/downloads');
    const rows = page.locator('.task');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.head')).toContainText('工作流');
    await expect(rows.nth(1).locator('.head')).not.toContainText('工作流');
    // 节点不走这张任务表：页面上得说清楚去哪里看它的进度
    await expect(page.getByText(/节点包是 git 仓库/)).toBeVisible();
    await page.screenshot({ path: ART + '/39-task-kind.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('发现工作流：ComfyHub 源可筛选并创建下载任务', async ({ page }) => {
    const item = HUB_ITEM;
    // 发现页这条用例全 mock：ComfyHub 索引 3.7MB，E2E 不该依赖外网
    await page.route((url) => url.pathname === '/api/workflows', (route) =>
      route.fulfill({ json: { items: [item], errors: {}, done: true } }));
    await page.route((url) => url.pathname === '/api/workflows/resolve', (route) =>
      route.fulfill({ json: {
        repo_id: 'e6f74ca84e32', display_name: 'ComfyHub', revision: '', source: 'comfyhub',
        files: [{ path: 'e6f74ca84e32.json', size: 6064,
          candidates: ['https://comfy.org/workflows/download/e6f74ca84e32.json'] }],
        target_folder: 'workflows',
      } }));
    let taskBody: Record<string, unknown> | null = null;
    await page.route((url) => url.pathname === '/api/tasks', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      taskBody = route.request().postDataJSON();
      return route.fulfill({ json: { id: 't-hub', status: 'pending' } });
    });

    await page.goto('/workflows/discover');
    await expect(page.locator('.ps-chips').getByTitle('ComfyHub')).toBeVisible();
    await page.locator('.ps-chips').getByTitle('ComfyHub').click();
    await expect(page.locator('.wf-title')).toHaveText('FLUX 3 Video: Text to Video');
    // 发现页默认网格视图 = 统一骨架卡；依赖清单收在 ⋯ 菜单里（⑤ 标签位只放一枚分组标签）
    await expect(page.locator('md-hub-card')).toHaveCount(1);
    await page.locator('md-hub-card .acard-kebab').click();
    await expect(page.getByText('模型:Flux')).toBeVisible();
    await page.locator('md-hub-card .acard-kebab').click();

    await page.locator('[data-testid="wf-download-comfyhub"]').click();
    await expect(page.getByText(/已创建下载任务/)).toBeVisible();
    expect(taskBody).toMatchObject({
      source: 'comfyhub', target_folder: 'workflows', task: 'Workflows',
      files: ['e6f74ca84e32.json'],
    });
    await page.screenshot({ path: ART + '/40-comfyhub.png', fullPage: true });
  });

  test('发现工作流：切换来源时旧的慢响应不会盖掉当前结果', async ({ page }) => {
    const stale = { ...HUB_ITEM, id: 'stale-all', source: 'civitai', name: '旧响应不该出现' };
    await page.route((url) => url.pathname === '/api/workflows', async (route) => {
      const source = new URL(route.request().url()).searchParams.get('source');
      if (source === 'all') {
        // 六源并发明显慢于单源：旧响应必须被丢弃，否则 chip 选 ComfyHub 却显示 5 个源
        await new Promise((r) => setTimeout(r, 1200));
        return route.fulfill({ json: { items: [stale], errors: {}, done: true } });
      }
      return route.fulfill({ json: { items: [HUB_ITEM], errors: {}, done: true } });
    });

    await page.goto('/workflows/discover');
    await page.locator('.ps-chips').getByTitle('ComfyHub').click();
    await page.waitForTimeout(2000);
    await expect(page.locator('md-hub-card')).toHaveCount(1);
    await expect(page.locator('.wf-title')).toHaveText('FLUX 3 Video: Text to Video');
    await expect(page.getByText('旧响应不该出现')).toHaveCount(0);
  });

  test('解析失败有错误提示', async ({ page }) => {
    await page.goto('/downloads?demo=1');
    await page.locator('select').first().selectOption('demo');
    await page.getByPlaceholder('如 microsoft/Phi-3-mini-4k-instruct').fill('bad/repo');
    await page.getByRole('button', { name: '解析文件' }).click();
    await expect(page.locator('.notice.err')).toBeVisible();
    await page.screenshot({ path: ART + '/09-resolve-error.png', fullPage: true });
  });

  test('模型发现：搜索、行内下载弹层创建任务', async ({ page }) => {
    await page.goto('/models/discover?demo=1');
    await expect(page.getByRole('heading', { name: '发现模型' })).toBeVisible();
    await page.getByRole('button', { name: 'Demo', exact: true }).click();
    await page.getByTestId('search-input').fill('text');
    // VIS 定稿：发现模型的搜索是「停 300ms 自动发一次 / 回车」，页面上没有「搜索」按钮了
    await page.getByTestId('search-input').press('Enter');
    await expect(page.getByText('text-gen-1.5').first()).toBeVisible();
    // URL 同步了筛选状态
    await expect(page).toHaveURL(/\/models\/discover\?.*source=demo/);
    await page.screenshot({ path: ART + '/10-discover.png', fullPage: true });

    // 行内弹层：解析 → 创建任务
    await page.getByTestId('card-download').first().click();
    await expect(page.getByTestId('dialog-files')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dialog-files').getByText('model.safetensors')).toBeVisible();
    await expect(page.getByTestId('dialog-files').getByText('README.md')).toHaveCount(0);
    await page.getByTestId('dialog-create').click();
    await expect(page.getByText('已创建下载任务')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: ART + '/11-discover-to-download.png', fullPage: true });

    // 跳到下载任务页验证任务存在
    await page.getByTestId('dialog-goto-tasks').click();
    await expect(page).toHaveURL(/\/downloads/);
    await expect(page.locator('.task').first()).toContainText('demo/', { timeout: 15_000 });
  });

  test('下载弹层：Diffusers 分片仓库默认不勾选，可展开全部权重', async ({ page }) => {
    const item = {
      id: 'MiniMaxAI/MiniMax-H3-Image',
      name: 'MiniMax-H3-Image',
      author: 'MiniMaxAI',
      source: 'huggingface',
      description: '',
      downloads: 1,
      likes: 1,
      tags: [],
      task: 'text-to-image',
      url: 'https://huggingface.co/MiniMaxAI/MiniMax-H3-Image',
      updated_at: '2026-11-21',
    };
    await page.route((url) => url.pathname === '/api/search', (route) =>
      route.fulfill({ json: { items: [item], total: 1, errors: {} } }));
    await page.route((url) => url.pathname === '/api/covers', (route) =>
      route.fulfill({ json: { covers: {} } }));
    await page.route((url) => url.pathname === '/api/resolve', (route) =>
      route.fulfill({
        json: {
          repo_id: item.id,
          display_name: item.name,
          revision: 'main',
          source: 'huggingface',
          target_folder: '',
          files: [
            { path: 'pdd_fused_heads.safetensors', size: 12_000_000, candidates: [], folder: 'checkpoints' },
            { path: 'text_encoder/model-00001-of-00014.safetensors', size: 5_000_000_000, candidates: [], folder: 'text_encoders' },
            { path: 'transformer/model-00001-of-00012.safetensors', size: 5_500_000_000, candidates: [], folder: 'diffusion_models' },
            { path: 'README.md', size: 1000, candidates: [], folder: '' },
          ],
        },
      }));

    await page.goto('/models/discover?source=huggingface');
    await expect(page.locator('md-model-card')).toHaveCount(1);
    await page.getByTestId('card-download').click();

    // 分片权重不是 ComfyUI 能直接加载的形态：默认不勾选、不铺表格
    await expect(page.getByTestId('dialog-files')).toHaveCount(0);
    await expect(page.getByText(/Diffusers 分片格式/)).toBeVisible();

    // 点「查看全部权重」才展示全部真实权重；非权重文件始终不出现
    await page.getByRole('button', { name: /查看全部权重 \(3\)/ }).first().click();
    await expect(page.getByTestId('dialog-files')).toBeVisible();
    await expect(page.getByTestId('dialog-files').getByText('model-00001-of-00014.safetensors')).toBeVisible();
    await expect(page.getByTestId('dialog-files').getByText('README.md')).toHaveCount(0);
  });

  test('模型卡：分类标签只放一枚，来源收进右上角与 ⋯ 菜单', async ({ page }) => {
    await page.goto('/models/discover?demo=1');
    await page.waitForTimeout(1500);

    const card = page.locator('md-model-card').first();
    const tags = card.locator('.card-tags .pill');
    // 统一骨架 ⑤：分类标签**只放一枚**（模型=文件类型，工作流=分组，节点=它提供什么）
    await expect(tags).toHaveCount(1);
    await expect(tags.first()).toBeVisible();

    // 全圆角胶囊 —— 参考 comfy.org Hub 模型卡的规格
    const radius = await tags.first().evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toMatch(/999px|^50%$/);

    // 标签行单行：高度只有一行高，且卡片高度全墙一致
    const rowH = await card.locator('.card-tags').evaluate((el) => el.getBoundingClientRect().height);
    expect(rowH).toBeLessThan(26);
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('md-model-card .card')].map((c) =>
        Math.round(c.getBoundingClientRect().height),
      ),
    );
    expect(new Set(heights).size).toBe(1);

    // 标签内容是分类信息（文件类型 / 任务类别），**不是**来源的全大写字母。
    // 注意别一刀切禁止大写 —— LoRA / VAE / HF / MS 是专有名词，本来就该大写。
    const texts = await tags.allTextContents();
    expect(texts.some((t) => /HF|MS|Civitai|Demo/.test(t))).toBe(false);
    expect(
      texts.every((t) => t.trim() === t && !/^[A-Z]{3,}\s/.test(t)),
    ).toBe(true);

    // 来源入口有两处，都不在标签行里：
    //   右上角 .acard-origin（原站链接）· ⋯ 菜单里的来源胶囊（各来源的下载入口）
    const origin = card.locator('.origin').first();
    await expect(origin).toHaveAttribute('target', '_blank');
    await expect(origin).toHaveText(/HF|MS|Civitai/);
    await expect(card.locator('.card-tags .pill-link')).toHaveCount(0);

    await card.locator('.acard-kebab').click();
    const srcTitle = await card
      .locator('.acard-menu .pill-link')
      .first()
      .getAttribute('title');
    expect(srcTitle).toMatch(/在 .+ 上打开原始仓库/);

    // 标签行不能有内容被裁掉 —— 裁掉就等于没折叠
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('md-model-card .card-tags')].filter(
        (r) => r.scrollWidth > r.clientWidth + 1,
      ).length,
    );
    expect(clipped).toBe(0);

    await page.screenshot({ path: ART + '/60-model-card-pills.png', fullPage: false });
  });

  test('发现页：Civitai 缓存后加载更多不覆盖第一页', async ({ page }) => {
    const mk = (p: number) =>
      Array.from({ length: 20 }, (_, i) => ({
        id: `civ-${p}-${i}`,
        name: `Civ ${p} ${i}`,
        author: 'tester',
        source: 'civitai',
        description: '',
        downloads: 100 - i,
        likes: 10,
        tags: [],
        task: 'Checkpoint',
        url: `https://civitai.com/models/${p}${i}`,
        updated_at: '2026-11-14',
      }));
    const page1Calls: number[] = [];
    await page.route((url) => url.pathname === '/api/search', (route) => {
      const p = Number(new URL(route.request().url()).searchParams.get('page') || '1');
      if (p === 1) page1Calls.push(Date.now());
      return route.fulfill({ json: { items: mk(p), total: 20, errors: {} } });
    });
    await page.route((url) => url.pathname === '/api/covers', (route) =>
      route.fulfill({ json: { covers: {} } }));

    await page.goto('/models/discover?source=civitai');
    await expect(page.locator('md-model-card')).toHaveCount(20);
    const first = await page.locator('md-model-card .card-name').first().innerText();

    // 刷新：命中 3 分钟内的缓存，不应该再发 page=1 请求
    const before = page1Calls.length;
    await page.reload();
    await expect(page.locator('md-model-card')).toHaveCount(20);
    expect(page1Calls.length).toBe(before);

    // 加载更多必须追加第二页，第一页第一条不能被顶掉
    await page.getByRole('button', { name: '加载更多' }).click();
    await expect(page.locator('md-model-card')).toHaveCount(40);
    await expect(page.locator('md-model-card .card-name').first()).toHaveText(first);
  });

  test('模型库：海报卡 + 右侧分面筛选', async ({ page }) => {
    // 全 mock：三种卡（正常 / 残缺 / DEMO）一次看全，不依赖本机真实库
    const models = [
      {
        id: 'm-flux', name: 'FLUX.1-dev', repo_id: 'black-forest-labs/FLUX.1-dev',
        source: 'huggingface', local_path: 'E:/mock/models/diffusion_models/FLUX.1-dev',
        size_bytes: 23.8 * 1024 ** 3, file_count: 3, tags: ['text-to-image'],
        created_at: '2026-11-14T10:00:00', files: [],
        precision: 'BF16', params: '12.00 B', hasWeights: true, isDemo: false,
        folder: 'diffusion_models', folderLabel: '扩散模型', task: 'text_to_image',
        taskLabel: '文生图', needGb: 22.8,
        vram: { level: 'err', text: '装不下', hint: '超出 6.8 GB' },
      },
      {
        id: 'm-gpt2', name: 'gpt2', repo_id: 'openai/gpt2', source: 'huggingface',
        local_path: 'E:/mock/models/text_encoders/gpt2', size_bytes: 1024 * 1024,
        file_count: 2, tags: [], created_at: '2026-11-13T10:00:00', files: [],
        precision: 'FP16', params: '124 M', hasWeights: false, isDemo: false,
        folder: 'text_encoders', folderLabel: '文本编码器', task: 'text_generation',
        taskLabel: '文本生成', needGb: 0,
        vram: { level: 'missing', text: '缺少权重', hint: '目录里没有权重文件' },
      },
      {
        id: 'm-demo', name: 'text-gen-1.5', repo_id: 'demo/text-gen-1.5', source: 'demo',
        local_path: 'E:/mock/models/checkpoints/text-gen-1.5', size_bytes: 4 * 1024 ** 2,
        file_count: 1, tags: [], created_at: '2026-11-12T10:00:00', files: [],
        precision: 'FP16', params: '524.3 M', hasWeights: true, isDemo: true,
        folder: 'checkpoints', folderLabel: '主模型', task: 'text_generation',
        taskLabel: '文本生成', needGb: 0,
        vram: { level: 'demo', text: '演示数据', hint: '' },
      },
    ];
    await page.route((url) => url.pathname === '/api/library', (route) => route.fulfill({ json: models }));
    await page.route((url) => url.pathname === '/api/library/facets', (route) => route.fulfill({
      json: {
        folder: [
          { id: 'checkpoints', label: '主模型', count: 1, sizeText: '4.0 MB' },
          { id: 'diffusion_models', label: '扩散模型', count: 1, sizeText: '23.80 GB' },
          { id: 'text_encoders', label: '文本编码器', count: 1, sizeText: '1.0 MB' },
        ],
        task: [
          { id: 'text_generation', label: '文本生成', count: 2, sizeText: '5.0 MB' },
          { id: 'text_to_image', label: '文生图', count: 1, sizeText: '23.80 GB' },
        ],
        source: [
          { id: 'demo', label: 'demo', count: 1, sizeText: '4.0 MB' },
          { id: 'huggingface', label: 'huggingface', count: 2, sizeText: '23.80 GB' },
        ],
        publisher: [
          { id: 'black-forest-labs', label: 'black-forest-labs', count: 1, sizeText: '23.80 GB' },
          { id: 'demo', label: 'demo', count: 1, sizeText: '4.0 MB' },
          { id: 'openai', label: 'openai', count: 1, sizeText: '1.0 MB' },
        ],
        allFolders: [], allTasks: [],
      },
    }));
    await page.route((url) => url.pathname === '/api/library/gpu', (route) => route.fulfill({
      json: { name: 'RTX 4090', vramMb: 16384, vramGb: 16, vramText: '16 GB' },
    }));
    await page.route((url) => url.pathname === '/api/covers', (route) => route.fulfill({ json: { covers: {} } }));

    await page.goto('/models');
    await expect(page.locator('md-library-card')).toHaveCount(3);
    // 筛选入口只有筛选条上这一枚「筛选」按钮：右缘不再有第二枚浮标
    await expect(page.getByRole('button', { name: /^筛选/ })).toHaveCount(1);
    // 「筛选」浮层默认收起
    const filterPop = page.getByRole('dialog', { name: '筛选' });
    await expect(filterPop).toBeHidden();
    // 展开后是浮层：三个类别分面（存放类型 / 任务类型 / 发布方）都在；
    // 来源站那一维搬到筛选条上的站点 chip 行，不在浮层里
    await page.getByRole('button', { name: /^筛选/ }).click();
    await expect(filterPop).toBeVisible();
    await expect(filterPop.locator('[data-testid="facet-group"]')).toHaveCount(3);
    await expect(filterPop.getByText('存放类型', { exact: true })).toBeVisible();
    await expect(filterPop.getByText('任务类型', { exact: true })).toBeVisible();
    await expect(filterPop.getByText('发布方', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: '按站点筛选' })).toBeVisible();
    // 发布方是独立于家族的分面：点亮 openai 后这一维收窄到只剩 gpt2，清除全部后三张卡都回来
    const pub = filterPop.locator('[data-testid="facet-group"]').filter({ hasText: '发布方' });
    await expect(pub.getByRole('button')).toHaveCount(3);
    await pub.getByRole('button', { name: /^openai/ }).click();
    await expect(page.locator('md-library-card')).toHaveCount(1);
    await expect(page.getByText('gpt2').first()).toBeVisible();
    await filterPop.getByRole('button', { name: '清除全部' }).click();
    await expect(page.locator('md-library-card')).toHaveCount(3);
    await filterPop.getByRole('button', { name: '完成' }).click();
    // 三种形态都在；显存压力条按统一骨架撤掉了，不该再有
    await expect(page.locator('md-library-card .gauge')).toHaveCount(0);
    // 残缺条目的主操作是补救，不是「查找适配工作流」
    await expect(page.getByRole('button', { name: '重新下载模型' })).toBeVisible();

    // 右上角必须能直接跳回原站；发布方仍在底部标签行
    const src = page.locator('md-library-card a.origin').first();
    await expect(src).toHaveAttribute('href', 'https://huggingface.co/black-forest-labs/FLUX.1-dev');
    await expect(src).toHaveAttribute('target', '_blank');
    await expect(src).toHaveText('HF');
    await expect(page.locator('md-library-card .pill-author').first()).toHaveText('black-forest-labs');

    // 搜索在客户端过滤（筛选条上的搜索框，没有单独的 data-testid，按无障碍名定位）
    await page.getByRole('searchbox', { name: '搜索名称或路径' }).fill('gpt2');
    await expect(page.locator('md-library-card')).toHaveCount(1);
    await page.screenshot({ path: ART + '/61-library-card.png', fullPage: false });
  });

  test('模型库：重新下载回到原仓库、原版本与原文件', async ({ page }) => {
    const model = {
      id: 'm-flux', name: 'FLUX.1-dev', repo_id: 'black-forest-labs/FLUX.1-dev',
      source: 'huggingface', local_path: 'E:/mock/models/diffusion_models/FLUX.1-dev',
      size_bytes: 23.8 * 1024 ** 3, file_count: 1, tags: [], created_at: '2026-11-14T10:00:00',
      files: [{ id: 'f1', path: 'flux1-dev.safetensors', size: 23.8 * 1024 ** 3 }],
      precision: 'BF16', params: '12.00 B', hasWeights: false, isDemo: false,
      folder: 'diffusion_models', folderLabel: '扩散模型', task: 'text_to_image', taskLabel: '文生图',
      revision: 'abc123', needGb: 22.8,
      vram: { level: 'missing', text: '缺少权重', hint: '目录里没有权重文件' },
    };
    await page.route((url) => url.pathname === '/api/library', (route) => route.fulfill({ json: [model] }));
    await page.route((url) => url.pathname === '/api/library/facets', (route) => route.fulfill({
      json: { folder: [], task: [], source: [], publisher: [], allFolders: [], allTasks: [] },
    }));
    await page.route((url) => url.pathname === '/api/library/gpu', (route) => route.fulfill({
      json: { name: 'RTX 4090', vramMb: 16384, vramGb: 16, vramText: '16 GB' },
    }));
    await page.route((url) => url.pathname === '/api/covers', (route) => route.fulfill({ json: { covers: {} } }));
    await page.route((url) => url.pathname === '/api/settings', (route) => route.fulfill({
      json: { sources: { huggingface: { label: 'Hugging Face' } }, download: { strategy: 'direct' }, default_strategy: 'direct' },
    }));
    await page.route((url) => url.pathname === '/api/tasks', (route) => route.fulfill({ json: [] }));
    let resolveBody: any = null;
    await page.route((url) => url.pathname === '/api/resolve', (route) => {
      resolveBody = route.request().postDataJSON();
      return route.fulfill({ json: {
        repo_id: 'black-forest-labs/FLUX.1-dev', display_name: 'FLUX.1-dev', revision: 'abc123',
        source: 'huggingface', target_folder: 'diffusion_models',
        files: [
          { path: 'flux1-dev.safetensors', size: 23.8 * 1024 ** 3, candidates: ['https://hf.co/a'], folder: 'diffusion_models' },
          { path: 'flux1-dev-fp8.safetensors', size: 12 * 1024 ** 3, candidates: ['https://hf.co/b'], folder: 'diffusion_models' },
        ],
      } });
    });

    await page.goto('/models');
    await page.getByRole('button', { name: '重新下载模型' }).click();

    // 不是去发现页按名字重搜，而是带着仓库 / 版本 / 原文件直接回下载页
    await expect(page).toHaveURL(/\/downloads\?/);
    await expect(page).toHaveURL(/source=huggingface/);
    await expect(page).toHaveURL(/repo_id=black-forest-labs%2FFLUX.1-dev/);
    await expect(page).toHaveURL(/revision=abc123/);
    await expect(page).toHaveURL(/files=flux1-dev.safetensors/);
    expect(resolveBody).toMatchObject({
      source: 'huggingface',
      repo_id: 'black-forest-labs/FLUX.1-dev',
      revision: 'abc123',
    });
    await expect(page.getByText(/已按上次下载恢复 1 个文件/)).toBeVisible();
    const row = page.locator('.file-table tbody tr').filter({ hasText: 'flux1-dev.safetensors' });
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();
    await page.screenshot({ path: ART + '/62-library-redownload.png', fullPage: true });
  });

  test('环境管理：显示本机设备与安装方案', async ({ page }) => {
    await page.goto('/environments');
    await expect(page.getByRole('heading', { name: '环境管理' })).toBeVisible();

    // 探测要跑 nvidia-smi / CIM，给足时间；硬件结论只放右栏「设备详情」
    await expect(page.locator('.env-side')).toContainText('显卡', { timeout: 20_000 });
    await expect(page.getByText(/这台电脑可以启用显卡加速|安装后即可使用/)).toHaveCount(0);

    // 左栏是基础环境 + ComfyUI 实例，右栏是展开的设备详情卡片
    await expect(page.getByText('待检测')).toHaveCount(0);
    await expect(page.locator('.env-layout')).toBeVisible();
    await expect(page.getByRole('heading', { name: '设备详情' })).toBeVisible();
    await expect(page.getByText('检测时间')).toBeVisible();
    // 基础环境是「一次装好的三项」列表，ComfyUI 版本归实例卡
    await expect(page.getByRole('heading', { name: '基础环境' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ComfyUI 实例' })).toBeVisible();
    // 已装显示实测版本，未装显示「—」；两种情况都算正常，不与本机安装状态耦合
    await expect(page.locator('.env-list-row').nth(0)).toContainText(/3\.13\.18|—/);
    await expect(page.locator('.env-list')).toContainText('PyTorch');
    await expect(page.locator('.env-list')).toContainText('CUDA 运行时');
    await expect(page.locator('.env-list')).not.toContainText('ComfyUI');
    // 列表下方不再堆解释性文案
    await expect(page.getByText('三项一次装到')).toHaveCount(0);
    await expect(page.locator('.panel-lead')).toHaveCount(0);
    // 实例卡：本机有没有已装实例都不影响这条用例
    const rows = page.locator('.instance-meta');
    if (await rows.count()) {
      // 正在安装中的实例还没写 instance.json，会显示「未登记」，别当成安装失败
      await expect(rows.first()).toContainText(/ComfyUI|未登记/);
    }
    await expect(page.getByRole('button', { name: '安装实例' })).toBeVisible();
    await page.screenshot({ path: ART + '/12-comfy-env.png', fullPage: true });

    // 「安装」与「环境检测」互斥：未安装只有安装，装好后只有检测（不再叫「重新检测」）
    await expect(page.getByRole('button', { name: '重新检测' })).toHaveCount(0);
    const installBtn = page.getByRole('button', { name: '安装', exact: true });
    const checkBtn = page.getByRole('button', { name: '环境检测' });
    expect(await installBtn.count() + await checkBtn.count()).toBe(1);
    if (await checkBtn.count()) {
      await page.route((url) => url.pathname === '/api/comfy/env/check', (route) =>
        route.fulfill({
          json: {
            ok: true, python: '3.13.18', torch: '2.14.1+cu130', backend: 'cuda',
            accelerator: true, issues: [], checked_at: '',
          },
        }));
      await checkBtn.click();
      await expect(page.locator('.check-box')).toContainText('环境正常');
      await expect(checkBtn).toBeEnabled({ timeout: 20_000 });
    } else {
      await expect(installBtn).toBeVisible();
    }
  });

  test('环境管理：检测出问题时修复会强制重装', async ({ page }) => {
    let previewUrl = '';
    let cachedEnv: any = null;
    // 「环境检测」只在已安装时出现；本用例验证的是装好但 torch 坏了
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) cachedEnv = await (await route.fetch()).json();
      await route.fulfill({
        json: { ...cachedEnv, runtime: { ...cachedEnv.runtime, ready: true } },
      });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));
    await page.route((url) => url.pathname === '/api/comfy/env/check', (route) =>
      route.fulfill({
        json: {
          ok: false, python: '3.13.18', torch: null, backend: null, accelerator: null,
          checked_at: '',
          issues: [{
            code: 'torch-missing', title: 'PyTorch 不可用',
            detail: '共享环境里没有可导入的 PyTorch。', fix: 'install',
          }],
        },
      }));
    // 修复请求必须带 repair=true，否则后端会走「复用已有依赖」跳过重装
    await page.route((url) => url.pathname === '/api/comfy/install/preview', async (route) => {
      previewUrl = route.request().url();
      const response = await route.fetch();
      await route.fulfill({ response });
    });

    await page.goto('/environments');
    await page.getByRole('button', { name: '环境检测' }).click();
    await expect(page.getByText('PyTorch 不可用')).toBeVisible();
    await page.getByRole('button', { name: '修复' }).click();
    expect(previewUrl).toContain('repair=true');
    await expect(page.getByText('安装基础环境')).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('环境管理：基础环境未安装时给出状态与来源提示', async ({ page }) => {
    let cachedEnv: any = null;
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      const runtime = {
        ...cachedEnv.runtime,
        ready: false,
        python_ready: false,
        python_cached: false,
        torch_ready: false,
        torch_version: null,
        cuda_runtime: null,
      };
      await route.fulfill({ json: { ...cachedEnv, runtime } });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));

    await page.goto('/environments');
    await expect(page.locator('ui-badge').first()).toContainText('未安装');
    // 未安装时三行都不显示版本号：计划值（3.13.18 / 13.0）不能当成已装值
    await expect(page.locator('.env-list')).not.toContainText('3.13.18');
    await expect(page.locator('.env-list')).not.toContainText('13.0');
    await expect(page.locator('.env-list-row').nth(0)).toContainText('—');
    // 未安装时才出现「安装」；实例入口此时必须禁用，避免建出跑不起来的实例
    await expect(page.getByRole('button', { name: '安装', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '环境检测' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '安装实例' })).toBeDisabled();
    await page.screenshot({ path: ART + '/16-comfy-runtime-missing.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('环境管理：昇腾等异种设备与统一内存有专属结论', async ({ page }) => {
    // 真机只有 N 卡，用 mock 覆盖探测结果来验证异种硬件的界面分支
    let cachedEnv: any = null;
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      const gpu = {
        vendor: 'ascend', name: 'Ascend 910B ×2', driver_version: '', vram_mb: null,
        compute_cap: null, source: 'davinci', is_discrete: true, memory_shared: false,
      };
      const device = {
        ...cachedEnv.device,
        os: 'linux', arch: 'x86_64', memory_gb: 128, unified_memory: true,
        gpus: [gpu], primary_gpu: gpu,
      };
      const plan = {
        ...cachedEnv.plan,
        tier: 'limited', backend: 'cpu', torch_channel: 'cpu',
        actions: [{
          level: 'warn', title: '将以 CPU 运行，NPU 加速需另行配置',
          detail: '昇腾依赖 CANN 驱动和 torch_npu，本项目不会自动安装这一套。', url: null,
        }],
      };
      await route.fulfill({ json: { ...cachedEnv, device, plan } });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));

    await page.goto('/environments');
    await expect(page.getByText('将以 CPU 运行，NPU 加速需另行配置')).toBeVisible();
    await expect(page.locator('.env-side').getByText('128 GB').first()).toBeVisible();
    await expect(page.getByText('显卡与 CPU 共用（统一内存）')).toBeVisible();
    await expect(page.getByText('与系统内存共用，无独立显存')).toBeVisible();
    // 共享环境里可能残留 CUDA 版 torch，但非 NVIDIA 方案不能自相矛盾地显示 CUDA 版本号
    await expect(page.locator('.env-list-row').filter({ hasText: 'CUDA 运行时' })).toContainText('不适用');
    // 列表下方不再堆解释性文案
    await expect(page.getByText('三项一次装到')).toHaveCount(0);
    await page.screenshot({ path: ART + '/17-comfy-ascend-unified.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('环境管理：基础环境安装预演不含 ComfyUI 实例步骤', async ({ page }) => {
    let cachedEnv: any = null;
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      await route.fulfill({
        json: {
          ...cachedEnv,
          runtime: {
            ...cachedEnv.runtime, ready: false, python_ready: false, torch_ready: false,
            torch_version: null, cuda_runtime: null,
          },
        },
      });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));

    await page.goto('/environments');
    const installButton = page.getByRole('button', { name: '安装', exact: true });
    await expect(installButton).toBeEnabled({ timeout: 20_000 });
    await installButton.click();
    await expect(page.getByText('安装基础环境')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('.preview-steps').getByText(/安装 PyTorch|复用已有依赖环境/),
    ).toBeVisible();
    await expect(page.getByText('验证安装结果')).toBeVisible();
    // 基础环境的安装里绝不能再夹带克隆代码 / 接入模型目录
    await expect(page.getByText('获取 ComfyUI 代码')).toHaveCount(0);
    await expect(page.getByText('接入共享模型目录')).toHaveCount(0);
    await expect(page.getByText(/预计占用约/)).toBeVisible();
    await page.screenshot({ path: ART + '/13-comfy-install-preview.png', fullPage: true });

    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('安装基础环境')).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('环境管理：点安装立刻弹出弹层，不等预演返回', async ({ page }) => {
    let cachedEnv: any = null;
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      await route.fulfill({ json: { ...cachedEnv, runtime: { ...cachedEnv.runtime, ready: false } } });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));
    // 故意拖慢预演：弹层必须先出来，不能被这个请求挡住
    await page.route((url) => url.pathname === '/api/comfy/install/preview', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await route.fetch();
      await route.fulfill({ response });
    });

    await page.goto('/environments');
    const installButton = page.getByRole('button', { name: '安装', exact: true });
    await expect(installButton).toBeEnabled({ timeout: 20_000 });

    const started = Date.now();
    await installButton.click();
    await expect(page.locator('.preview-loading')).toBeVisible({ timeout: 1_000 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await page.getByRole('button', { name: '准备中…' }).isDisabled()).toBe(true);

    // 预演回来后自动换成真实步骤，按钮恢复可点
    await expect(page.locator('.preview-steps')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.preview-loading')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认安装' })).toBeEnabled();
    await page.getByRole('button', { name: '取消' }).click();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('环境管理：实例卡安装只装 ComfyUI 代码', async ({ page }) => {
    let previewUrl = '';
    let cachedEnv: any = null;
    const spec = {
      name: 'v-mock', workspace: 'E:/mock/v-mock', comfy_dir: '', environment: '',
      python: '3.13', channel: 'cu130',
    };
    const steps = [
      { key: 'prepare', title: '准备工作目录', detail: '', command: null, estimated_gb: 0 },
      { key: 'clone', title: '获取 ComfyUI 代码', detail: '', command: null, estimated_gb: 0.5 },
      { key: 'models', title: '接入共享模型目录', detail: '', command: null, estimated_gb: 0 },
      { key: 'requirements', title: '安装 ComfyUI 依赖', detail: '', command: null, estimated_gb: 0 },
      { key: 'verify', title: '验证安装结果', detail: '', command: null, estimated_gb: 0 },
    ];
    // 保证基础环境显示为已安装，实例入口才可用
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      await route.fulfill({
        json: { ...cachedEnv, runtime: { ...cachedEnv.runtime, ready: true } },
      });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));
    await page.route((url) => url.pathname === '/api/comfy/install/preview', (route) => {
      previewUrl = route.request().url();
      route.fulfill({ json: { kind: 'instance', spec, steps, total_gb: 0.5 } });
    });

    await page.goto('/environments');
    await expect(page.getByRole('button', { name: '安装实例' })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: '安装实例' }).click();
    expect(previewUrl).toContain('kind=instance');
    await expect(page.getByText('安装 ComfyUI 实例')).toBeVisible();
    await expect(page.getByText('获取 ComfyUI 代码')).toBeVisible();
    // 限定在预演步骤里，避免基础环境列表的「待安装 PyTorch」被算进来
    await expect(page.locator('.preview-steps')).not.toContainText('准备运行环境');
    await expect(page.locator('.preview-steps')).not.toContainText('安装 PyTorch');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('环境管理：安装实例可以选 ComfyUI 版本', async ({ page }) => {
    let cachedEnv: any = null;
    let previewUrl = '';
    const spec = {
      name: 'v0.44.2', workspace: 'E:/mock/v0.44.2', comfy_dir: '', environment: '',
      python: '3.13.18', channel: 'cu130', tag: 'v0.44.2',
    };
    const steps = [
      { key: 'prepare', title: '准备工作目录', detail: '', command: null, estimated_gb: 0 },
      { key: 'clone', title: '获取 ComfyUI 代码', detail: '从镜像获取代码 · v0.44.2', command: null, estimated_gb: 0.1 },
      { key: 'verify', title: '验证安装结果', detail: '', command: null, estimated_gb: 0 },
    ];
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      await route.fulfill({
        json: { ...cachedEnv, runtime: { ...cachedEnv.runtime, ready: true } },
      });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));
    await page.route((url) => url.pathname === '/api/comfy/install/preview', (route) => {
      previewUrl = route.request().url();
      route.fulfill({ json: { kind: 'instance', spec, steps, total_gb: 0.1 } });
    });

    await page.goto('/environments');
    await expect(page.getByRole('button', { name: '安装实例' })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: '安装实例' }).click();

    const picker = page.locator('#comfy-tag');
    await expect(picker).toBeVisible();
    // 默认跟最新版走，请求里不带 tag
    await expect(picker).toHaveValue('');
    expect(previewUrl).not.toContain('tag=');

    // 选定版本后要重新预演：确认安装前看到的就是这个版本的步骤
    await picker.selectOption('v0.44.2');
    await expect.poll(() => previewUrl).toContain('tag=v0.44.2');
    await expect(picker).toHaveValue('v0.44.2');
    await page.screenshot({ path: ART + '/18-comfy-version-picker.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('环境管理：安装中左右双栏显示实时进度与执行日志', async ({ page }) => {
    // 让基础环境显示为未安装，才能从基础环境卡触发「安装」
    let cachedEnv: any = null;
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      await route.fulfill({
        json: {
          ...cachedEnv,
          runtime: {
            ...cachedEnv.runtime, ready: false, python_ready: false, torch_ready: false,
            torch_version: null, cuda_runtime: null,
          },
        },
      });
    });
    // 用假事件流驱动界面，避免为了测 UI 真下 2GB torch
    const steps = [
      { key: 'prepare', title: '准备工作目录', detail: '', command: null, estimated_gb: 0 },
      { key: 'runtime', title: '准备运行环境', detail: '', command: null, estimated_gb: 0.2 },
      { key: 'torch', title: '安装 PyTorch', detail: '', command: null, estimated_gb: 3 },
      { key: 'verify', title: '验证安装结果', detail: '', command: null, estimated_gb: 0 },
    ];
    const spec = {
      name: 'v-mock', workspace: 'E:/mock/v-mock', comfy_dir: '', environment: '',
      python: '3.13', channel: 'cu130',
    };
    const at = Math.floor(Date.now() / 1000) - 12;
    // overall 由后端按步骤权重算好：torch 权重远大于「准备目录」，所以进到
    // torch 34% 时总进度才 42%（按步骤数平均分会错误地显示 59%）
    const events = [
      { type: 'step_start', key: 'torch', title: '安装 PyTorch', index: 3, total: 4, overall: 12.6, at },
      { type: 'log', line: '== [3/4] 安装 PyTorch', at },
      { type: 'log', line: '$ python -m pip install torch --progress-bar raw', at },
      {
        type: 'progress', key: 'torch', phase: 'download',
        label: 'torch-2.9.1-cp313-win_amd64.whl',
        done: 734003200, size: 2147483648, percent: 34.2, speed: 12582912, eta: 112,
        overall: 42.0, at,
      },
      { type: 'log', line: 'Successfully installed torch-2.9.1', at },
      { type: 'step_done', key: 'torch', ok: true, message: '完成', overall: 86.4, at },
    ];
    const mockJob = (status: string) => ({
      id: 'mockjob', status, kind: 'environment', name: spec.name, workspace: spec.workspace, spec, steps,
      total_events: events.length, events,
      result: status === 'done'
        ? { ok: true, message: '安装完成，用时 12 秒', log_path: '', instance: null }
        : null,
    });

    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));
    await page.route((url) => url.pathname === '/api/comfy/install/preview', (route) =>
      route.fulfill({ json: { spec, steps, total_gb: 3.2 } }));
    await page.route((url) => url.pathname === '/api/comfy/install', (route) =>
      route.fulfill({ json: { id: 'mockjob' } }));
    let calls = 0;
    await page.route((url) => url.pathname === '/api/comfy/install/mockjob', (route) => {
      calls += 1;
      // 多保持几轮 running，断言才有机会在「安装中」抓到总进度数字
      route.fulfill({ json: mockJob(calls < 6 ? 'running' : 'done') });
    });

    await page.goto('/environments');
    const startButton = page.getByRole('button', { name: '安装', exact: true });
    await expect(startButton).toBeEnabled({ timeout: 20_000 });

    await startButton.click();
    await expect(page.getByText('安装基础环境')).toBeVisible();
    await page.getByRole('button', { name: '确认安装' }).click();

    await expect(page.getByText('正在安装基础环境')).toBeVisible();
    await expect(page.locator('.install-grid')).toBeVisible();
    await expect(page.locator('.install-left')).toBeVisible();
    await expect(page.locator('.install-right')).toBeVisible();
    // 左栏：实时速度、传输量、剩余时间、总进度
    await expect(page.getByText('下载速度')).toBeVisible();
    await expect(page.locator('.metric').first()).toContainText('MB/s');
    await expect(page.locator('.metrics')).toContainText('734.00 MB');
    // 总进度用后端下发的 overall（按步骤权重）：mock 每次轮询都回放完整事件流，
    // 所以「安装中」看到的是流末尾 step_done 的 86%（按步骤数平均分会是 59%）
    await expect(page.locator('.ring-label')).toContainText('86%');
    await expect(page.locator('.ring-label')).not.toContainText('59%');
    // 右栏：执行日志
    await expect(page.getByText('执行日志')).toBeVisible();
    await expect(page.locator('.log-view')).toContainText('Successfully installed torch');
    // 啰嗦文案（版本、体积、绝对路径、命令细节）都不该再出现
    await expect(page.getByText(/便携版/)).toHaveCount(0);
    await expect(page.locator('.install-left')).not.toContainText('E:/mock');
    await expect(page.locator('.install-left')).not.toContainText('下载 Python');
    await page.screenshot({ path: ART + '/14-comfy-install-progress.png', fullPage: true });
  });

  test('环境管理：转后台后实例卡显示安装中，点一下回到进度弹层', async ({ page }) => {
    let cachedEnv: any = null;
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      // 基础环境就绪（否则「安装实例」禁用）；实例列表清空，安装中的那一行由前端渲染
      await route.fulfill({
        json: {
          ...cachedEnv,
          runtime: { ...cachedEnv.runtime, ready: true },
          device: { ...cachedEnv.device, instances: [] },
        },
      });
    });

    const steps = [
      { key: 'prepare', title: '准备工作目录', detail: '', command: null, estimated_gb: 0 },
      { key: 'clone', title: '获取 ComfyUI 代码', detail: '', command: null, estimated_gb: 0.5 },
      { key: 'requirements', title: '安装 ComfyUI 依赖', detail: '', command: null, estimated_gb: 1.5 },
      { key: 'verify', title: '验证安装结果', detail: '', command: null, estimated_gb: 0 },
    ];
    const spec = {
      name: 'v-bg', workspace: 'E:/mock/v-bg', comfy_dir: '', environment: '',
      python: '3.13', channel: 'cu130',
    };
    const at = Math.floor(Date.now() / 1000) - 30;
    const events = [
      { type: 'step_start', key: 'requirements', title: '安装 ComfyUI 依赖', index: 3, total: 4, overall: 14.0, at },
      {
        type: 'progress', key: 'requirements', phase: 'download',
        label: '依赖包（3/20）', done: 3000000, size: 60000000, percent: 42.0,
        speed: 900000, eta: 60, overall: 47.0, at,
      },
    ];
    const job = {
      id: 'bgjob', status: 'running', kind: 'instance', name: 'v-bg', workspace: spec.workspace,
      spec, steps, total_events: events.length, events, result: null,
    };
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));
    await page.route((url) => url.pathname === '/api/comfy/install/preview', (route) =>
      route.fulfill({ json: { spec, steps, total_gb: 2 } }));
    await page.route((url) => url.pathname === '/api/comfy/install', (route) =>
      route.fulfill({ json: { id: 'bgjob' } }));
    await page.route((url) => url.pathname === '/api/comfy/install/bgjob', (route) =>
      route.fulfill({ json: job }));

    await page.goto('/environments');
    await page.getByRole('button', { name: '安装实例' }).click();
    await page.getByRole('button', { name: '确认安装' }).click();
    await expect(page.getByText('正在安装 ComfyUI 实例')).toBeVisible();
    await expect(page.locator('.ring-label')).toContainText('47%');

    // 后台运行：弹层收起，但实例卡里留一条可以点回去的提示
    await page.getByRole('button', { name: '后台运行' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    const hint = page.locator('.instance-row.installing');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('v-bg');
    await expect(hint).toContainText('47%');
    await expect(hint).toContainText('安装 ComfyUI 依赖');
    await page.screenshot({ path: ART + '/15-comfy-install-background.png', fullPage: true });

    await hint.click();
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('.ring-label')).toContainText('47%');
  });

  test('环境管理：删除实例并识别未登记的残留目录', async ({ page }) => {
    let deleted = '';
    let cachedEnv: any = null;
    // 沿用真实探测结果，只替换实例列表，避免为了测 UI 去动真机目录。
    // 首次抓取后缓存下来，后续 refresh=true 直接用缓存响应，测试收尾不会有挂起的 fetch。
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      const instances = deleted
        ? []
        : [
            {
              name: 'v-mock-a', path: 'E:/mock/v-mock-a', version: '0.44.0',
              python: '3.13.18', port: null, created_at: null, registered: true,
            },
            {
              name: 'v-mock-b', path: 'E:/mock/v-mock-b', version: null,
              python: null, port: null, created_at: null, registered: false,
            },
          ];
      await route.fulfill({ json: { ...cachedEnv, device: { ...cachedEnv.device, instances } } });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));
    await page.route((url) => url.pathname.startsWith('/api/comfy/instances/'), (route) => {
      deleted = route.request().url().split('/').pop() || '';
      route.fulfill({ json: { deleted } });
    });
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/environments');
    await expect(page.locator('.instance-row')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByText('未登记')).toBeVisible();
    await page.screenshot({ path: ART + '/15-comfy-instance-delete.png', fullPage: true });

    await page.locator('.instance-row', { hasText: 'v-mock-a' }).getByRole('button', { name: '删除' }).click();
    await expect(page.locator('.instance-row', { hasText: 'v-mock-a' })).toHaveCount(0);
    expect(deleted).toBe('v-mock-a');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('环境管理：删除失败时显示后端真实原因', async ({ page }) => {
    let cachedEnv: any = null;
    await page.route((url) => url.pathname === '/api/comfy/env', async (route) => {
      if (!cachedEnv) {
        const response = await route.fetch();
        cachedEnv = await response.json();
      }
      const instances = [{
        name: 'v-fail', path: 'E:/mock/v-fail', version: null,
        python: null, port: null, created_at: null, registered: true,
      }];
      await route.fulfill({ json: { ...cachedEnv, device: { ...cachedEnv.device, instances } } });
    });
    await page.route((url) => url.pathname === '/api/comfy/install/current', (route) =>
      route.fulfill({ json: { job: null } }));
    await page.route((url) => url.pathname.startsWith('/api/comfy/instances/'), (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        json: { detail: '删除失败：目录被占用' },
      }));
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/environments');
    await expect(page.locator('.instance-row')).toHaveCount(1, { timeout: 20_000 });
    await page.locator('.instance-row').getByRole('button', { name: '删除' }).click();
    await expect(page.getByText('删除失败：目录被占用')).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // ---------------- 节点发现 / 节点管理 ----------------
  // 节点清单要打外网拉 5MB 的 ComfyUI-Manager JSON，E2E 里固定返回，
  // 真实抓取与归一化由 backend/tests/test_nodes.py 覆盖。
  async function mockNodes(page: any) {
    await page.route((url: URL) => url.pathname === '/api/nodes', (route: any) =>
      route.fulfill({
        json: {
          total: 2,
          done: true,
          installed_count: 1,
          items: [
            {
              id: 'city96/comfyui-gguf', name: 'ComfyUI-GGUF', author: 'city96',
              repo: 'https://github.com/city96/ComfyUI-GGUF', source: 'manager',
              description: '加载 GGUF 量化模型。', tags: [], nodes: ['UnetLoaderGGUF', 'CLIPLoaderGGUF'],
              node_count: 6, install_type: 'git-clone', installable: true,
              preemptions: [], needs: [], installed: true,
            },
            {
              id: 'ltdrdata/comfyui-impact-pack', name: 'ComfyUI Impact Pack', author: 'Dr.Lt.Data',
              repo: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack', source: 'manager',
              description: '检测、分割、细节增强。', tags: [], nodes: ['SAMLoader', 'DetailerForEach'],
              node_count: 202, install_type: 'git-clone', installable: true,
              preemptions: [], needs: ['segment-anything'], installed: false,
            },
          ],
        },
      }));
    await page.route((url: URL) => url.pathname === '/api/nodes/stats', (route: any) =>
      route.fulfill({
        json: {
          catalog: 6038, installed: 1, disabled: 1, node_classes: 45849,
          core_nodes: 1081, dir: 'E:/mock/workspace/custom_nodes', runtime: '3.13.18',
        },
      }));
    await page.route((url: URL) => url.pathname === '/api/nodes/installed', (route: any) =>
      route.fulfill({
        json: {
          items: [
            {
              name: 'comfyui-gguf', dir: 'comfyui-gguf', path: 'E:/mock/custom_nodes/comfyui-gguf',
              disabled: false, repo: 'https://github.com/city96/ComfyUI-GGUF', id: 'city96/comfyui-gguf',
              title: 'ComfyUI-GGUF', description: '', node_count: 6, nodes: ['UnetLoaderGGUF'],
              tracked: true, requirements: true, commit: '6ea2651', size: 1048576,
            },
            {
              name: 'handmade', dir: 'handmade.disabled', path: 'E:/mock/custom_nodes/handmade.disabled',
              disabled: true, repo: '', id: '', title: 'handmade', description: '', node_count: 0,
              nodes: [], tracked: false, requirements: false, commit: '', size: 2048,
            },
          ],
        },
      }));
    await page.route((url: URL) => url.pathname === '/api/nodes/missing', (route: any) =>
      route.fulfill({
        json: {
          scanned: 5,
          missing_files: 1,
          core_nodes: 1081,
          installed_nodes: 6,
          providers: [
            {
              id: 'JPS-GER/comfyui_jps-nodes', name: 'JPS Custom Nodes for ComfyUI', author: 'JPS',
              repo: 'https://github.com/JPS-GER/ComfyUI_JPS-Nodes', node_count: 72,
              installable: true, covers: ['SDXL Resolutions (JPS)'], files: 2,
            },
          ],
          workflows: [
            {
              name: 'flux_img2img_1_2', file: '🟢 F.1 img2img 1.3/flux_img2img_1_2.json',
              path: 'E:/mock/workflows/a.json', used: 17, missing: 3,
              providers: [
                {
                  id: 'JPS-GER/comfyui_jps-nodes', name: 'JPS Custom Nodes for ComfyUI', author: 'JPS',
                  repo: 'https://github.com/JPS-GER/ComfyUI_JPS-Nodes', node_count: 72,
                  installable: true, covers: ['SDXL Resolutions (JPS)'],
                },
              ],
              unknown: ['HintImageEnchance'],
            },
          ],
        },
      }));
    await page.route((url: URL) => url.pathname === '/api/nodes/job', (route: any) =>
      route.fulfill({ json: { job: null } }));
  }

  test('节点发现：列表显示已装状态与节点规模', async ({ page }) => {
    await mockNodes(page);
    await page.goto('/nodes/discover');

    await expect(page.getByRole('heading', { name: '发现节点' })).toBeVisible();
    await expect(page.locator('.nd-card')).toHaveCount(2);
    // 已装的那张给徽章，未装的给安装按钮
    await expect(page.locator('.nd-card').first().getByText('已安装').first()).toBeVisible();
    await expect(page.locator('.nd-card').nth(1).getByRole('button', { name: '安装' })).toBeVisible();
    // 节点类数现在在状态槽右侧（统一骨架 ④ 的「大小」位）
    await expect(page.locator('.nd-card .acard-size').nth(1)).toHaveText('202 节点类');
    await page.screenshot({ path: ART + '/19-nodes-discover.png', fullPage: true });
  });

  test('节点发现：点安装后显示进度条', async ({ page }) => {
    await mockNodes(page);
    await page.route((url: URL) => url.pathname === '/api/nodes/install', (route: any) =>
      route.fulfill({ json: { id: 'job-1' } }));
    await page.route((url: URL) => url.pathname === '/api/nodes/job/job-1', (route: any) =>
      route.fulfill({
        json: {
          id: 'job-1', node: 'ltdrdata/comfyui-impact-pack', name: 'ComfyUI Impact Pack',
          status: 'running', stage: '下载代码', percent: 45, dir: '', error: '',
          logs: [{ at: 1, line: '克隆 https://github.com/ltdrdata/ComfyUI-Impact-Pack' }], next: 1,
        },
      }));

    await page.goto('/nodes/discover');
    await page.locator('.nd-card').nth(1).getByRole('button', { name: '安装' }).click();
    await expect(page.locator('.nd-progress').first()).toHaveText('45%');
    await expect(page.locator('.nd-log')).toContainText('克隆');
    await page.screenshot({ path: ART + '/20-nodes-installing.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('节点管理：已装列表、启停状态与缺节点检测', async ({ page }) => {
    await mockNodes(page);
    await page.goto('/nodes');

    await expect(page.getByRole('heading', { name: '节点管理' })).toBeVisible();
    await expect(page.locator('.nd-card')).toHaveCount(2);
    // 「已禁用」在统计条里也有一个，限定在卡片内取
    await expect(page.locator('.nd-card').nth(1).getByText('已禁用').first()).toBeVisible();
    await expect(page.locator('.nd-card').nth(1).getByText('清单未收录').first()).toBeVisible();

    await page.getByRole('button', { name: /检测缺失/ }).click();
    await expect(page.getByText('5 个工作流里有 1 个缺节点')).toBeVisible();
    await expect(page.getByText('JPS Custom Nodes for ComfyUI').first()).toBeVisible();
    // 明细默认折叠，展开后能看到「清单未收录」的节点名
    await page.locator('.nl-details summary').click();
    await expect(page.getByText('HintImageEnchance')).toBeVisible();
    await page.screenshot({ path: ART + '/21-nodes-library.png', fullPage: true });
  });

  test('我的工作流：按主模型显示家族厂标', async ({ page }) => {
    // 家族判定在前端做（core/cover.ts 的 FAMILIES 表），
    // 后端只给主模型文件名 —— 这里 mock 一下接口，固定三个家族的输入。
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({
        json: {
          dir: 'E:/mock/workflows',
          total: 4,
          groups: [],
          items: [
            {
              name: 'flux_img2img_1_2', path: 'E:/mock/workflows/flux_img2img_1_2.json',
              folder: '', size: 15981, mtime: 1730000000, nodes: 17, format: 'ui',
              main_model: 'flux1-dev.sft', model_slots: [],
            },
            {
              name: 'qwen_edit', path: 'E:/mock/workflows/qwen_edit.json',
              folder: '', size: 96740, mtime: 1730000000, nodes: 8, format: 'ui',
              main_model: 'qwen_image_2.1_int8_convrot.safetensors', model_slots: [],
            },
            {
              name: 'minimax_broken', path: 'E:/mock/workflows/minimax_broken.json',
              folder: '', size: 71924, mtime: 1730000000, nodes: 0, format: 'broken',
              main_model: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', model_slots: [],
            },
            {
              name: 'pony_portrait', path: 'E:/mock/workflows/pony_portrait.json',
              folder: '', size: 42118, mtime: 1730000000, nodes: 6, format: 'ui',
              main_model: 'ponyDiffusionV6XL.safetensors', model_slots: [],
            },
          ],
        },
      }));

    await page.goto('/workflows');
    await expect(page.getByRole('heading', { name: '工作流' })).toBeVisible();

    const marks = page.locator('ui-family-mark');
    await expect(marks).toHaveCount(4);
    // 有官方资产用 symbol（MiniMax 的官方 symbol 已接入，不再回落家族码）
    await expect(page.locator('ui-family-mark img.fm-logo[alt="flux"]')).toHaveCount(1);
    await expect(page.locator('ui-family-mark img.fm-logo[alt="qwen"]')).toHaveCount(1);
    await expect(page.locator('ui-family-mark img.fm-logo[alt="minimax"]')).toHaveCount(1);
    // Pony 也补上了位图临摹标（2026-11-21），走品牌标而不是家族码
    await expect(page.locator('ui-family-mark img.fm-logo[alt="pony"]')).toHaveCount(1);
    // 25 个家族现在都有矢量或位图临摹资产 —— 「认得出家族但没有资产 → 回落家族码」
    // 这条降级路径当前**没有可用样本**了（认不出家族时按规矩什么都不画，
    // 见 family-mark.component.ts）。这条断言留着是为了哪天又有家族没资产时能立刻发现。
    await expect(page.locator('ui-family-mark .fm-code')).toHaveCount(0);
    await page.screenshot({ path: ART + '/24-workflow-family-mark.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：卡片四态映射与唯一主按钮', async ({ page }) => {
    // 四态各一条：解析失败 / API 格式 / 缺依赖 / 就绪。
    // 后端的依赖比对由 test_workflow_deps.py 覆盖，这里固定响应验证呈现。
    const base = {
      folder: '', size: 20000, mtime: 1730000000, nodes: 10,
      main_model: 'flux1-dev.sft', model_slots: [],
    };
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({
        json: {
          dir: 'E:/mock/workflows', total: 4, groups: [],
          items: [
            {
              ...base, name: 'a_broken', path: 'E:/mock/a.json', format: 'broken',
              nodes: 0, error: 'JSON 语法错误 · 第 12 行',
              deps: { have: [], missing: [] }, node_deps: { have: [], missing: [], unknown: [] },
            },
            {
              ...base, name: 'b_api', path: 'E:/mock/b.json', format: 'api',
              deps: { have: [{ file: 'flux1-dev.sft', directory: 'diffusion_models', node: 'UNETLoader', url: '' }], missing: [] },
              node_deps: { have: [], missing: [], unknown: [] },
            },
            {
              ...base, name: 'c_missing', path: 'E:/mock/c.json', format: 'ui',
              deps: {
                have: [],
                missing: [
                  { file: 'flux1-dev.sft', directory: 'diffusion_models', node: 'UNETLoader', url: '' },
                  { file: 'ae.sft', directory: 'vae', node: 'VAELoader', url: '' },
                ],
              },
              node_deps: {
                have: [],
                missing: [{ id: 'jps/x', name: 'JPS Nodes', author: 'JPS', repo: '', node_count: 9, installable: true, covers: ['SDXL Resolutions (JPS)'] }],
                unknown: [],
              },
            },
            {
              ...base, name: 'd_ready', path: 'E:/mock/d.json', format: 'ui',
              deps: { have: [{ file: 'flux1-dev.sft', directory: 'diffusion_models', node: 'UNETLoader', url: '' }], missing: [] },
              node_deps: { have: [], missing: [], unknown: [] },
            },
          ],
        },
      }));

    await page.goto('/workflows');
    const cards = page.locator('app-workflow-card');
    await expect(cards).toHaveCount(4);

    // 每张卡只有一个主按钮 —— 三个生命周期操作是先后关系不是并列
    for (let i = 0; i < 4; i++) {
      await expect(cards.nth(i).locator('.wc-primary')).toHaveCount(1);
    }

    // 主按钮统一是「编辑」：缺不缺依赖都不换入口
    for (let i = 0; i < 4; i++) {
      await expect(cards.nth(i).locator('.wc-primary')).toContainText('编辑');
    }

    // 使用 / 补齐依赖收进 ⋯：缺依赖才有补齐，API / 坏文件不能直接用画布
    await cards.nth(2).locator('.wc-kebab').click();
    await expect(page.getByRole('menuitem', { name: '补齐依赖' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '使用工作流' })).toBeEnabled();
    await page.keyboard.press('Escape');

    await cards.nth(3).locator('.wc-kebab').click();
    await expect(page.getByRole('menuitem', { name: '补齐依赖' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '使用工作流' })).toBeEnabled();
    await page.keyboard.press('Escape');

    await cards.nth(1).locator('.wc-kebab').click();
    await expect(page.getByRole('menuitem', { name: '使用工作流' })).toBeDisabled();
    await page.keyboard.press('Escape');

    // 徽标：坏文件不戴缺失提示，API 用橙色提示，缺依赖用红色，就绪用中性计数
    await expect(cards.nth(0).locator('.wc-broken-title')).toHaveText('无法解析');
    await expect(cards.nth(1).locator('.wc-note')).toContainText('API 格式');
    await expect(cards.nth(2).locator('.wc-dep')).toContainText('缺 2 模型');
    await expect(cards.nth(2).locator('.wc-dep')).toContainText('1 节点包');
    await expect(cards.nth(3).locator('.wc-count')).toContainText('依赖');

    // 状态筛选：只留缺依赖那一张
    await page.getByRole('button', { name: /^缺依赖/ }).click();
    await expect(page.locator('app-workflow-card')).toHaveCount(1);
    await page.screenshot({ path: ART + '/25-workflow-cards.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：补齐依赖抽屉按卡填充', async ({ page }) => {
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({
        json: {
          dir: 'E:/mock/workflows', total: 1, groups: [],
          items: [{
            name: 'flux_img2img_1_2', path: 'E:/mock/a.json', folder: '',
            size: 15981, mtime: 1730000000, nodes: 17, format: 'ui',
            main_model: 'flux1-dev.sft', model_slots: [],
            deps: {
              have: [],
              missing: [{ file: 'ae.sft', directory: 'vae', node: 'VAELoader', url: '' }],
            },
            node_deps: {
              have: [],
              missing: [{ id: 'jps/x', name: 'JPS Custom Nodes', author: 'JPS', repo: '', node_count: 9, installable: true, covers: ['SDXL Resolutions (JPS)'] }],
              unknown: ['Power Lora Loader (rgthree)'],
            },
          }],
        },
      }));

    await page.goto('/workflows');
    await page.locator('app-workflow-card .wc-kebab').first().click();
    await page.getByRole('menuitem', { name: '补齐依赖' }).click();

    const drawer = page.locator('.dr');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('缺失模型');
    await expect(drawer).toContainText('ae.sft');
    await expect(drawer).toContainText('缺失节点包');
    await expect(drawer).toContainText('JPS Custom Nodes');
    // 查不到归属的节点如实标注，不猜成某个包
    await expect(drawer).toContainText('Power Lora Loader (rgthree)');
    // 主按钮只补节点包 —— 模型走下载任务
    await expect(drawer.locator('.dr-ops .primary')).toHaveText('补齐节点包');

    // 排序下拉层必须留在抽屉下面：抽屉是模态的，页内浮层不能压上来
    const sortZ = await page.locator('.wf-sort-wrap').evaluate((el) => Number(getComputedStyle(el).zIndex));
    const drawerZ = await page.locator('.dr').evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(sortZ).toBeLessThan(drawerZ);
    const sortCovered = await page.evaluate(() => {
      const btn = document.querySelector('.wf-sort-wrap > .cb-select');
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !hit || !btn.contains(hit);
    });
    expect(sortCovered).toBe(true);

    await page.screenshot({ path: ART + '/26-workflow-drawer.png', fullPage: false });
    await page.locator('.dr-mask').click({ position: { x: 5, y: 5 } });
    await expect(drawer).toBeHidden();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // ---------------- 卡片交互：封面 / 溢出菜单 / 重命名 / 删除 / 去找 ----------------
  // 封面解析要打 Civitai，E2E 里固定返回一张内联 SVG：
  // 既证明 img 真的渲染了，也不用依赖外网。
  const COVER_ITEM = {
    name: 'flux_img2img_1_2',
    key: '🟢 F.1 img2img 1.3/flux_img2img_1_2.json',
    path: 'E:/mock/workflows/flux_img2img_1_2.json',
    folder: '🟢 F.1 img2img 1.3',
    size: 15981, mtime: 1730000000, nodes: 17, format: 'ui',
    main_model: 'flux1-dev.sft', model_slots: [],
    title: '人像高清修复', group: '人像', cover: '',
    deps: {
      have: [{ file: 'flux1-dev.sft', directory: 'diffusion_models', node: 'UNETLoader', url: '' }],
      missing: [{ file: 'ae.sft', directory: 'vae', node: 'VAELoader', url: '' }],
    },
    node_deps: {
      have: [],
      missing: [{ id: 'jps/x', name: 'JPS Nodes', author: 'JPS', repo: '', node_count: 9, installable: true, covers: ['SDXL Resolutions (JPS)'] }],
      unknown: [],
    },
  };

  const COVER_SVG = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="448" height="280"><rect width="448" height="280" fill="#3b2f4a"/></svg>',
  );

  async function mockLocalWorkflows(page: any) {
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({
        json: {
          dir: 'E:/mock/workflows', total: 1, groups: [{ name: '人像', count: 1 }],
          items: [COVER_ITEM],
        },
      }));
    await page.route((url: URL) => url.pathname === '/api/workflows/covers', (route: any) =>
      route.fulfill({ json: { covers: { [COVER_ITEM.key]: COVER_SVG } } }));
  }

  test('我的工作流：远程封面渲染成真实图片', async ({ page }) => {
    await mockLocalWorkflows(page);
    await page.goto('/workflows');

    const img = page.locator('app-workflow-card img.wc-cover-img');
    await expect(img).toHaveCount(1);
    // 图真的解码出来了才算渲染成功（src 有值不等于图能显示）
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 5000 })
      .toBeGreaterThan(0);
    await page.screenshot({ path: ART + '/27-workflow-cover.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：溢出菜单含完整动作并贴着卡片弹出', async ({ page }) => {
    await mockLocalWorkflows(page);
    await page.goto('/workflows');

    await page.locator('app-workflow-card .wc-kebab').click();
    const menu = page.locator('.wf-menu');
    await expect(menu).toBeVisible();
    // 7 项：使用 / 补齐依赖（这张卡缺件）/ 变更封面 / 重命名 / 更换分组 / 打开文件夹 / 删除
    await expect(menu.getByRole('menuitem')).toHaveText([
      /使用工作流/, /补齐依赖/, /变更封面/, /^重命名$/, /^更换分组$/, /打开文件夹/, /^删除$/,
    ]);
    await expect(menu.getByRole('menuitem')).toHaveCount(7);

    // 菜单是 fixed 定位且贴着按钮：不该跑到视口外
    const box = await menu.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: ART + '/28-workflow-menu.png' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：⋯ 菜单「更换分组」只切这一条的组', async ({ page }) => {
    await mockLocalWorkflows(page);
    let patchBody: any = null;
    await page.route((url: URL) => url.pathname === '/api/workflows/local/meta', (route: any) => {
      patchBody = route.request().postDataJSON();
      return route.fulfill({
        json: { title: patchBody.title, group: patchBody.group, file: '', key: COVER_ITEM.key, folder: '' },
      });
    });

    await page.goto('/workflows');
    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: '更换分组' }).click();
    const dlg = page.getByRole('dialog', { name: '更换分组' });
    await expect(dlg).toBeVisible();
    // 只做切换：不掺和组的增删改，工具栏的管理入口仍在
    await expect(page.getByTestId('lw-groups-manage')).toBeVisible();
    await expect(dlg).not.toContainText('新建分组');
    await expect(dlg.locator('.gs-item')).toHaveCount(2); // 未分组 + 人像
    await expect(dlg.locator('.gs-item.on')).toContainText('人像');
    await expect(dlg.locator('.gs-item[data-group="人像"] b')).toHaveText('1');

    await dlg.getByTestId('gs-none').click();
    await expect(dlg.getByTestId('gs-none')).toHaveClass(/on/);
    await page.screenshot({ path: ART + '/50-workflow-switch-group.png', fullPage: true });
    await dlg.getByTestId('gs-save').click();
    await expect.poll(() => patchBody && patchBody.group).toBe('');
    expect(patchBody.rename_file).toBe(false);
    expect(patchBody.title).toBe('人像高清修复');
    await expect(dlg).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：重命名与分组走后端并刷新列表', async ({ page }) => {
    let patchBody: any = null;
    await mockLocalWorkflows(page);
    await page.route((url: URL) => url.pathname === '/api/workflows/local/meta', (route: any) => {
      patchBody = route.request().postDataJSON();
      route.fulfill({ json: { title: patchBody.title, group: patchBody.group, file: '', key: COVER_ITEM.key } });
    });

    await page.goto('/workflows');
    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: /重命名/ }).click();

    const dialog = page.getByRole('dialog', { name: '重命名与分组' });
    await expect(dialog).toBeVisible();
    // 打开时焦点应当已经进入对话框（键盘用户不用从头 Tab）
    await expect(dialog.locator('input').first()).toBeFocused();
    // 分组改成真 select：已有组做候选，当前值也要选中（不是空的）
    const groupSelect = dialog.getByTestId('lw-edit-group');
    await expect(groupSelect.locator('option')).toHaveText(['未分组', /人像/]);
    await expect(groupSelect).toHaveValue('人像');

    await dialog.locator('input').first().fill('新名字');
    await dialog.getByRole('button', { name: '保存' }).click();

    await expect.poll(() => patchBody?.title).toBe('新名字');
    expect(patchBody.path).toBe(COVER_ITEM.path);
    expect(patchBody.rename_file).toBe(false);
    await page.screenshot({ path: ART + '/29-workflow-rename.png' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：删除需要二次确认', async ({ page }) => {
    let deleted = false;
    await mockLocalWorkflows(page);
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) => {
      if (route.request().method() === 'DELETE') {
        deleted = true;
        return route.fulfill({ json: { deleted: COVER_ITEM.path, key: COVER_ITEM.key } });
      }
      return route.fallback();
    });

    await page.goto('/workflows');
    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: /删除/ }).click();

    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('人像高清修复');

    // 取消不删
    await confirm.getByRole('button', { name: '取消' }).click();
    await expect(confirm).toBeHidden();
    expect(deleted).toBe(false);

    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: /删除/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click();
    await expect.poll(() => deleted).toBe(true);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：缺模型的「去找」跳到模型发现页并带关键词', async ({ page }) => {
    await mockLocalWorkflows(page);
    await page.goto('/workflows');

    await page.locator('app-workflow-card .wc-kebab').first().click();
    await page.getByRole('menuitem', { name: '补齐依赖' }).click();
    const row = page.locator('.dr-row').filter({ hasText: 'ae.sft' });
    await row.getByRole('button', { name: '去找' }).click();

    await expect(page).toHaveURL(/\/models\/discover\?q=ae\.sft/);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // ---------------- 无障碍 ----------------
  test('无障碍：表单标签与控件真正关联', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();

    // label 上的 for 必须指向真实存在的控件 id，点标签才能聚焦输入框
    const result = await page.evaluate(() => {
      const pairs: Array<{ for: string; ok: boolean }> = [];
      document.querySelectorAll('ui-field label.field-label').forEach((label) => {
        const id = label.getAttribute('for') || '';
        const bound = id ? document.getElementById(id) : null;
        pairs.push({ for: id, ok: !!bound });
      });
      return pairs;
    });
    expect(result.length).toBeGreaterThan(3);
    expect(result.every((pair) => pair.ok)).toBe(true);
  });

  test('我的工作流：列表视图与卡片功能对齐', async ({ page }) => {
    await mockLocalWorkflows(page);
    await page.goto('/workflows');
    await page.getByRole('button', { name: '列表视图' }).click();

    const row = page.locator('.lw-row').first();
    await expect(row).toBeVisible();
    // 缩略图：卡片有封面，列表也得有，否则认不出是同一件资产
    await expect(row.locator('.lw-thumb img')).toHaveCount(1);
    // 徽标与卡片同一套四态：缺 1 模型 + 1 节点包
    await expect(row.locator('.lw-badge')).toHaveText('缺 1 模型 · 1 节点包');
    // 主按钮统一是「编辑」；缺依赖时 ⋯ 里才有「补齐依赖」
    await expect(row.locator('.lw-primary')).toHaveText('编辑');
    await expect(row.locator('.lw-fmt')).toHaveText('UI');

    await row.locator('.lw-kebab').click();
    await expect(page.locator('.wf-menu')).toBeVisible();
    await expect(page.locator('.wf-menu').getByRole('menuitem')).toHaveCount(7);
    await page.keyboard.press('Escape');
    await expect(page.locator('.wf-menu')).toHaveCount(0);

    // 抽屉从 ⋯ 进入
    await row.locator('.lw-kebab').click();
    await page.getByRole('menuitem', { name: '补齐依赖' }).click();
    await expect(page.locator('.dr')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dr')).toHaveCount(0);

    await page.screenshot({ path: ART + '/30-workflow-list.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：分组筛选按组收窄，也能只看未分组', async ({ page }) => {
    const ready = (key: string, title: string, group: string) => ({
      ...COVER_ITEM,
      key,
      path: `E:/mock/workflows/${key}`,
      title,
      group,
      cover: '',
      deps: { have: COVER_ITEM.deps.have, missing: [] },
      node_deps: { have: [], missing: [], unknown: [] },
    });
    const rows = [
      { ...COVER_ITEM, cover: '' }, // 人像 · 缺依赖
      ready('b.json', '人像放大 · 二遍', '人像'),
      ready('c.json', '商品图换背景', '电商'),
      ready('d.json', '还没归类的一条', ''),
    ];
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({ json: { dir: 'E:/mock/workflows', total: rows.length, groups: [], items: rows } }));
    // 不 mock 这个接口就会拿假路径去打真后端，把测试键写进真实封面缓存
    await page.route((url: URL) => url.pathname === '/api/workflows/covers', (route: any) =>
      route.fulfill({ json: { covers: {} } }));
    await page.goto('/workflows');

    // 分组与健康度都收进「筛选」浮层（VIS §3.7.8）
    await page.getByRole('button', { name: /^筛选/ }).click();
    const pop = page.locator('.sf-pop');
    await expect(pop).toBeVisible();
    const groupFacet = pop.locator('.sf-facet').filter({ hasText: '分组' });
    // 分组 chip 的数字是「这个组有几条」，未分组单独一个入口。
    await expect(groupFacet.locator('.ps-chip')).toHaveText([
      /\s*电商\s*1$/,
      /\s*人像\s*2$/,
      /\s*未分组\s*1$/,
    ]);

    await groupFacet.getByRole('button', { name: /^人像/ }).click();
    await expect(page.locator('app-workflow-card')).toHaveCount(2);
    await expect(page.locator('.ps-count')).toContainText('2');
    await expect(page.locator('.ps-count')).toContainText('4');

    await groupFacet.getByRole('button', { name: /^未分组/ }).click();
    await expect(page.locator('app-workflow-card')).toHaveCount(1);
    await expect(page.locator('app-workflow-card h3')).toHaveText('还没归类的一条');

    // 分组与状态是交集，chip 数字按「其他条件已生效」重算
    await pop.locator('.sf-pop-clear').click();
    await expect(page.locator('app-workflow-card')).toHaveCount(4);
    const statusFacet = pop.locator('.sf-facet').filter({ hasText: '健康度' });
    await statusFacet.getByRole('button', { name: /^缺依赖/ }).click();
    await expect(page.locator('app-workflow-card')).toHaveCount(1);
    await expect(groupFacet.locator('.ps-chip')).toHaveText([
      /\s*电商\s*0$/,
      /\s*人像\s*1$/,
      /\s*未分组\s*0$/,
    ]);

    await page.screenshot({ path: ART + '/33-workflow-groups.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：深色主题下厂标有底衬且换成反白资产', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('md-theme', 'dark'));
    await mockLocalWorkflows(page);
    await page.goto('/workflows');

    const mark = page.locator('app-workflow-card ui-family-mark .fm');
    await expect(mark).toHaveClass(/plate/);
    // 深色主题必须换 -dark 资产：黑标压在深色底衬上是隐形的
    await expect(page.locator('app-workflow-card ui-family-mark img.fm-logo')).toHaveAttribute(
      'src',
      /flux-dark\.svg$/,
    );
    // 底衬跟着主题走：深色主题是深底 + 白标
    const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(20, 20, 23)');
    await page.screenshot({ path: ART + '/31-workflow-dark-mark.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：变更分组自动同步文件夹，无需手动整理', async ({ page }) => {
    await mockLocalWorkflows(page);
    let organizeCalls = 0;
    let patchBody: any = null;
    await page.route((url: URL) => url.pathname === '/api/workflows/local/organize', (route: any) => {
      organizeCalls += 1;
      return route.fulfill({ json: { moved: 0, items: [] } });
    });
    await page.route((url: URL) => url.pathname === '/api/workflows/local/meta', (route: any) => {
      patchBody = route.request().postDataJSON();
      return route.fulfill({
        json: {
          title: patchBody.title, group: patchBody.group, file: '',
          key: '人像/a.json', moved: true, folder: '人像',
        },
      });
    });

    await page.goto('/workflows');
    // 手动整理入口已经整个移除，管理与确认弹层都不该出现
    await page.getByTestId('lw-groups-manage').click();
    const manager = page.getByRole('dialog', { name: '分组管理' });
    await expect(manager.getByTestId('gm-organize')).toHaveCount(0);
    await expect(manager).not.toContainText('按分组整理');
    await expect(page.getByRole('alertdialog', { name: '按分组整理目录' })).toHaveCount(0);
    await manager.getByTestId('gm-close').click();

    // 改完分组保存，目录同步由后端在保存时做掉，前端不再补一次请求
    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: /重命名/ }).click();
    const dialog = page.getByRole('dialog', { name: '重命名与分组' });
    await dialog.getByTestId('lw-edit-group').selectOption('人像');
    await dialog.getByRole('button', { name: '保存' }).click();

    await expect.poll(() => patchBody?.group).toBe('人像');
    expect(organizeCalls).toBe(0);
    const toast = page.getByTestId('wf-toast');
    await expect(toast).toContainText('人像');
    expect(await toast.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    await page.screenshot({ path: ART + '/32-workflow-organize.png', fullPage: true });
    await toast.getByTestId('wf-toast-close').click();
    await expect(toast).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：分组管理可新建、改名、删除；变更分组只给加新组', async ({ page }) => {
    await mockLocalWorkflows(page);
    const defined: string[] = [];
    const calls: string[] = [];
    await page.route((url: URL) => url.pathname === '/api/workflows/groups', (route: any) => {
      const req = route.request();
      const body = req.method() === 'POST' || req.method() === 'PATCH' ? req.postDataJSON() : {};
      calls.push(req.method());
      if (req.method() === 'POST') {
        if (!defined.includes(body.name)) defined.push(body.name);
      } else if (req.method() === 'PATCH') {
        const i = defined.indexOf(body.old);
        if (i >= 0) defined[i] = body.name;
        return route.fulfill({ json: { old: body.old, name: body.name, renamed: 1, moved: 0 } });
      } else if (req.method() === 'DELETE') {
        const name = new URL(req.url()).searchParams.get('name') || '';
        const i = defined.indexOf(name);
        if (i >= 0) defined.splice(i, 1);
        return route.fulfill({ json: { name, cleared: 0 } });
      }
      return route.fulfill({ json: { groups: [], defined } });
    });

    await page.goto('/workflows');
    await page.getByRole('button', { name: '分组管理' }).click();
    const dlg = page.getByRole('dialog', { name: '分组管理' });
    await expect(dlg).toBeVisible();

    // 新建空组：条目里汇总不出来，也得出现在管理框和筛选条上
    await dlg.getByTestId('gm-new-name').fill('电商');
    await dlg.getByTestId('gm-add').click();
    await expect(dlg.locator('.gm-row[data-group="电商"] .gm-name')).toContainText('0');
    await page.screenshot({ path: ART + '/45-workflow-group-manager-open.png', fullPage: true });

    // 改名只在管理框里
    await dlg.getByTestId('gm-rename-电商').click();
    await dlg.getByTestId('gm-rename-input').fill('商品图');
    await dlg.getByTestId('gm-rename-save').click();
    await expect(dlg.locator('.gm-row[data-group="商品图"]')).toBeVisible();

    // 删除要二次确认，确认后该行收起
    await dlg.getByTestId('gm-delete-商品图').click();
    await expect(dlg.getByTestId('gm-delete-save')).toBeVisible();
    await dlg.getByTestId('gm-delete-save').click();
    await expect(dlg.locator('.gm-row[data-group="商品图"]')).toHaveCount(0);
    await dlg.getByTestId('gm-close').click();

    // 「变更分组」里不再有「+ 新分组」，改为跳到分组管理；改名也不在这里
    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: /重命名/ }).click();
    const edit = page.getByRole('dialog', { name: '重命名与分组' });
    await expect(edit).not.toContainText('改名');
    await expect(edit).not.toContainText('+ 新分组');
    const groupSelect = edit.getByTestId('lw-edit-group');
    await expect(groupSelect.locator('option')).toHaveCount(2); // 未分组 + 人像

    // 点「分组管理」叠开管理框，编辑框不能被关掉
    await edit.getByTestId('lw-group-manager-link').click();
    const nested = page.getByRole('dialog', { name: '分组管理' });
    await expect(nested).toBeVisible();
    await expect(edit).toBeVisible();
    await nested.getByTestId('gm-new-name').fill('试拍');
    await nested.getByTestId('gm-add').click();
    await expect.poll(() => defined).toContain('试拍');

    // 关闭管理框后，之前那条工作流的分组下拉要拿到新组
    await nested.getByTestId('gm-close').click();
    await expect(nested).toHaveCount(0);
    await expect(edit).toBeVisible();
    await expect(groupSelect.locator('option', { hasText: '试拍' })).toHaveCount(1);
    await groupSelect.selectOption('试拍');
    await expect(groupSelect).toHaveValue('试拍');

    // 管理框里改名，回来时已选中的值也要跟着改（不能挂着旧组名）
    await edit.getByTestId('lw-group-manager-link').click();
    const nested2 = page.getByRole('dialog', { name: '分组管理' });
    await nested2.getByTestId('gm-rename-试拍').click();
    await nested2.getByTestId('gm-rename-input').fill('商品图');
    await nested2.getByTestId('gm-rename-save').click();
    await nested2.getByTestId('gm-close').click();
    await expect(groupSelect).toHaveValue('商品图');

    expect(calls).toEqual(expect.arrayContaining(['POST', 'PATCH', 'DELETE']));
    await page.screenshot({ path: ART + '/43-workflow-group-manager.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：封面管理是候选画廊，点选即固定、可换一批与恢复自动', async ({ page }) => {
    await mockLocalWorkflows(page);
    const svg = (fill: string) => 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="448" height="280"><rect width="448" height="280" fill="${fill}"/></svg>`,
    );
    const next = svg('#244');
    const third = svg('#422');
    const offsets: number[] = [];
    const currents: string[] = [];
    let chosen: any = null;
    let reset = 0;
    await page.route((url: URL) => url.pathname === '/api/workflows/covers/candidates', (route: any) => {
      const body = route.request().postDataJSON();
      offsets.push(body.offset);
      currents.push(body.current);
      expect(body.key).toBe(COVER_ITEM.key);
      return route.fulfill({ json: { key: body.key, covers: [next, third] } });
    });
    await page.route((url: URL) => url.pathname === '/api/workflows/covers/choose', (route: any) => {
      chosen = route.request().postDataJSON();
      return route.fulfill({ json: { key: chosen.key, cover: chosen.url, pinned: true, source: 'manual' } });
    });
    await page.route((url: URL) => url.pathname === '/api/workflows/covers/reset', (route: any) => {
      reset += 1;
      return route.fulfill({ json: { key: COVER_ITEM.key, pinned: false } });
    });

    await page.goto('/workflows');
    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: '变更封面' }).click();
    const dlg = page.getByRole('dialog', { name: '封面管理' });
    await expect(dlg).toBeVisible();
    const gallery = dlg.getByTestId('cm-gallery');
    await expect(gallery).toBeVisible();
    await expect(gallery.locator('.cm-cell')).toHaveCount(3); // 当前 + 2 张候选
    await expect(gallery.locator('.cm-cell.on')).toHaveAttribute('data-url', COVER_SVG);
    await expect(dlg).not.toContainText('封面的选取规则');
    expect(offsets).toEqual([0]);
    expect(currents[0]).toBe(COVER_SVG);

    // 点第二格就钉住：卡片、画廊选中态一起更新
    await gallery.locator('.cm-cell').nth(1).click();
    await expect.poll(() => chosen?.url).toBe(next);
    const img = page.locator('app-workflow-card img.wc-cover-img');
    await expect(img).toHaveAttribute('src', next);
    await expect(gallery.locator('.cm-cell.on')).toHaveAttribute('data-url', next);
    await page.screenshot({ path: ART + '/44-workflow-cover-manager.png', fullPage: true });

    // 换一批：只把 offset 往后推，当前封面不动
    await dlg.getByTestId('cm-reload').click();
    await expect.poll(() => offsets.length).toBe(2);
    expect(offsets[1]).toBe(4);
    expect(currents[1]).toBe(next);
    await expect(gallery.locator('.cm-cell.on')).toHaveAttribute('data-url', next);

    // 「恢复自动封面」收进管理框，菜单里不再多一条
    await dlg.getByTestId('cm-reset').click();
    await expect.poll(() => reset).toBe(1);
    await expect(dlg).toHaveCount(0);
    await expect(img).toHaveAttribute('src', COVER_SVG);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：封面管理框支持自定义 URL 与本地上传', async ({ page }) => {
    await mockLocalWorkflows(page);
    const custom = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="448" height="280"><rect width="448" height="280" fill="#a3f"/></svg>',
    );
    const bodies: Array<Record<string, string>> = [];
    await page.route((url: URL) => url.pathname === '/api/workflows/covers/custom', (route: any) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: { key: COVER_ITEM.key, cover: custom, pinned: true, source: 'custom' },
      });
    });

    await page.goto('/workflows');
    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: '变更封面' }).click();
    const dlg = page.getByRole('dialog', { name: '封面管理' });

    // 自定义区默认折叠，展开后才出现地址与上传控件
    await expect(dlg.getByTestId('cm-url')).toHaveCount(0);
    await dlg.getByTestId('cm-fold').click();
    await expect(dlg.getByTestId('cm-fold')).toHaveAttribute('aria-expanded', 'true');

    // 非 http(s) 地址在前端就拦下，不发给后端
    await dlg.getByTestId('cm-url').fill('javascript:alert(1)');
    await dlg.getByTestId('cm-url-apply').click();
    await expect(dlg.locator('.cm-error')).toContainText('http');
    expect(bodies).toHaveLength(0);

    await dlg.getByTestId('cm-url').fill('https://img.example/my.png');
    await dlg.getByTestId('cm-url-apply').click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0].url).toBe('https://img.example/my.png');
    const img = page.locator('app-workflow-card img.wc-cover-img');
    await expect(img).toHaveAttribute('src', custom);
    await expect(dlg.locator('.cm-cell.on img')).toHaveAttribute('src', custom);
    await expect(page.getByTestId('wf-toast')).toContainText('已设为自定义封面');

    // 上传走 FileReader → data URI，后端把图内容寻址落到本机
    await dlg.getByTestId('cm-file').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1].data).toContain('data:image/png;base64,');
    await page.screenshot({ path: ART + '/46-workflow-cover-custom.png', fullPage: true });
    await dlg.getByTestId('cm-close').click();
    await expect(dlg).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：深色主题下封面管理框与悬浮提示可读', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('md-theme', 'dark'));
    await mockLocalWorkflows(page);
    const next = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="448" height="280"><rect width="448" height="280" fill="#244"/></svg>',
    );
    await page.route((url: URL) => url.pathname === '/api/workflows/covers/candidates', (route: any) =>
      route.fulfill({ json: { key: COVER_ITEM.key, covers: [next] } }));
    await page.route((url: URL) => url.pathname === '/api/workflows/covers/choose', (route: any) => {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: { key: body.key, cover: body.url, pinned: true, source: 'manual' } });
    });

    await page.goto('/workflows');
    await page.locator('app-workflow-card .wc-kebab').click();
    await page.getByRole('menuitem', { name: '变更封面' }).click();
    const dlg = page.getByRole('dialog', { name: '封面管理' });
    await expect(dlg).toBeVisible();
    expect(await dlg.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(20, 20, 23)');

    await dlg.locator('.cm-cell').nth(1).click();
    const toast = page.getByTestId('wf-toast');
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(20, 20, 23)');
    await page.screenshot({ path: ART + '/47-workflow-cover-dark.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：无分组在卡片与列表里都是灰度禁用标签', async ({ page }) => {
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({
        json: {
          dir: 'E:/mock/workflows', total: 1, groups: [],
          items: [{ ...COVER_ITEM, group: '', title: '无分组示例', key: 'no-group.json' }],
        },
      }));
    await page.route((url: URL) => url.pathname === '/api/workflows/covers', (route: any) =>
      route.fulfill({ json: { covers: {} } }));

    await page.goto('/workflows');
    const tag = page.locator('app-workflow-card .wc-tag.is-none');
    await expect(tag).toHaveText('未分组');
    // 是「一枚灰底弱描边的标签」，不是没有底和框的一行淡字
    expect(await tag.evaluate((el) => getComputedStyle(el).height)).toBe('16px');
    expect(await tag.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await tag.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    // UI | API 双段紧跟在分组标签之后
    await expect(page.locator('app-workflow-card .wc-meta > :first-child')).toHaveClass(/wc-fmt/);
    await page.screenshot({ path: ART + '/51-workflow-no-group-tag.png', fullPage: true });

    await page.getByRole('button', { name: '列表视图' }).click();
    const listTag = page.locator('.lw-grp.is-none');
    await expect(listTag).toHaveText('未分组');
    expect(await listTag.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('我的工作流：搜索在前、排序与视图收右、数量是标签', async ({ page }) => {
    await mockLocalWorkflows(page);
    await page.goto('/workflows');

    const filters = page.locator('.ps-filters');
    // 统一骨架固定顺序：搜索在最前，排序 / 视图收在右端
    await expect(filters.locator('> :first-child')).toHaveClass(/ps-search/);
    await expect(filters.locator('.ps-view')).toBeVisible();

    // 分组数量是小标签，不是跟在名字后的裸数字
    await page.getByRole('button', { name: /^筛选/ }).click();
    const pop = page.locator('.sf-pop');
    const badge = pop.locator('.sf-facet').filter({ hasText: '分组' }).locator('.ps-chip b').first();
    expect(await badge.evaluate((el) => getComputedStyle(el).borderRadius)).not.toBe('0px');
    await page.screenshot({ path: ART + '/49-workflow-sort-menu.png', fullPage: true });
    await pop.getByRole('button', { name: '完成' }).click();

    // 排序是原生 select：三项，选完即生效
    const sortSelect = page.locator('.ps-select select');
    await expect(sortSelect.locator('option')).toHaveCount(3);
    await sortSelect.selectOption('name');
    await expect(sortSelect).toHaveValue('name');

    // 卡片正文不再写「节点/依赖」，空出来的位置是分组标签；规格与分组的数字标签一致
    const tag = page.locator('app-workflow-card .wc-tag').first();
    await expect(tag).toHaveText('人像');
    await expect(page.locator('app-workflow-card .wc-tag')).toHaveCount(1);
    // 主按钮现在是「编辑」，所以只在标签区断言计数已撤掉
    await expect(page.locator('app-workflow-card .wc-meta')).not.toContainText('节点');
    await expect(page.locator('app-workflow-card .wc-meta')).not.toContainText('依赖');
    // 封面左下不再重复一次分组名
    await expect(page.locator('app-workflow-card .wc-grp')).toHaveCount(0);
    const chipSpec = (loc: typeof tag) =>
      loc.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.height, s.borderRadius, s.fontVariantNumeric].join('|');
      });
    // 卡上这一格是**分类标签**（VIS §3.7.2）：一律中性胶囊 .pill。
    // 工具栏里那个是「分组数量」的数字片 —— 两者不是同一件东西，不比规格。
    const tagStyle = await tag.evaluate((el) => {
      const s = getComputedStyle(el);
      return { h: s.height, r: s.borderRadius, bg: s.backgroundColor };
    });
    expect(tagStyle.h).toBe('16px');
    expect(tagStyle.r).toMatch(/999px|^50%$/);
    expect(
      await chipSpec(
        page.locator('.sf-pop').locator('.sf-facet').filter({ hasText: '分组' }).locator('.ps-chip b').first(),
      ),
    ).not.toBe(
      await chipSpec(tag),
    );
    await page.screenshot({ path: ART + '/48-workflow-toolbar.png', fullPage: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('工作流编辑器：从卡片主按钮直接进入编辑器', async ({ page }) => {
    await mockLocalWorkflows(page);
    await page.route((url: URL) => url.pathname === '/api/workflows/file', (route: any) =>
      route.fulfill({
        json: {
          path: 'E:/mock/workflows/flux_img2img_1_2.json', name: 'flux_img2img_1_2', folder: '',
          format: 'ui', size: 100, mtime: 1700000000,
          data: { nodes: [{ id: 1, type: 'KSampler', pos: [60, 60], size: [210, 120], inputs: [], outputs: [], widgets_values: [] }], links: [], version: 0.4 },
          raw: '{}', error: '',
        },
      }));
    await page.route((url: URL) => url.pathname === '/api/workflows/object-info', (route: any) =>
      route.fulfill({ json: { available: false, source: '', fetched_at: 0, nodes: {} } }));

    await page.goto('/workflows');
    await page.locator('app-workflow-card .wc-primary').click();

    await expect(page).toHaveURL(/\/workflows\/edit\?path=/);
    await expect(page.locator('.node')).toHaveCount(1);
    await expect(page.locator('.fmt-badge')).toHaveText('UI');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // ---------------- 工作流编辑器：UI / API / 坏 JSON ----------------
  const EDITOR_UI = {
    last_node_id: 2,
    last_link_id: 1,
    nodes: [
      {
        id: 1, type: 'UNETLoader', pos: [80, 80], size: [210, 100],
        inputs: [], outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
        widgets_values: ['flux1-dev.sft', 'default'],
        properties: { 'Node name for S&R': 'UNETLoader' },
      },
      {
        id: 2, type: 'KSampler', pos: [500, 80], size: [210, 220],
        inputs: [
          { name: 'model', type: 'MODEL', link: 1 },
          { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: null },
          { name: 'steps', type: 'INT', widget: { name: 'steps' }, link: null },
          { name: 'cfg', type: 'FLOAT', widget: { name: 'cfg' }, link: null },
          { name: 'sampler_name', type: 'COMBO', widget: { name: 'sampler_name' }, link: null },
          { name: 'scheduler', type: 'COMBO', widget: { name: 'scheduler' }, link: null },
        ],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: [] }],
        widgets_values: [42, 'randomize', 20, 8, 'euler', 'normal'],
      },
    ],
    links: [[1, 1, 0, 2, 0, 'MODEL']],
    version: 0.4,
  };

  const EDITOR_INFO = {
    available: true,
    source: 'mock',
    fetched_at: 1,
    nodes: {
      UNETLoader: {
        input: { required: { unet_name: [['flux1-dev.sft']], weight_dtype: [['default', 'fp8']] } },
        input_order: { required: ['unet_name', 'weight_dtype'] },
        output: ['MODEL'], output_name: ['MODEL'], display_name: 'UNETLoader', category: 'loaders',
      },
      KSampler: {
        input: { required: {
          model: ['MODEL'],
          seed: ['INT', { default: 0, min: 0, max: 100, control_after_generate: true }],
          steps: ['INT', { default: 20, min: 1, max: 100 }],
          cfg: ['FLOAT', { default: 8, min: 0, max: 30, step: 0.1 }],
          sampler_name: [['euler', 'dpmpp_2m']],
          scheduler: [['normal', 'karras']],
        } },
        input_order: { required: ['model', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler'] },
        output: ['LATENT'], output_name: ['LATENT'], display_name: 'KSampler', category: 'sampling',
      },
    },
  };

  async function mockEditor(page: any, file: Record<string, unknown>, saveBody?: { value: any }) {
    await page.route((url: URL) => url.pathname === '/api/workflows/file', async (route: any) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            path: 'E:/mock/a.json', name: 'a', folder: '', format: 'ui',
            size: 100, mtime: 1700000000, data: file, raw: JSON.stringify(file), error: '',
          },
        });
        return;
      }
      if (saveBody) saveBody.value = route.request().postDataJSON();
      await route.fulfill({
        json: {
          path: 'E:/mock/a.json', name: 'a', format: 'ui',
          size: 120, mtime: 1700000001, backup: 'E:/mock/a.json.bak',
        },
      });
    });
    await page.route((url: URL) => url.pathname === '/api/workflows/object-info', (route: any) =>
      route.fulfill({ json: EDITOR_INFO }));
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({ json: { dir: '', total: 0, groups: [], items: [] } }));
  }

  test('工作流编辑器：UI 文件画布、参数与 JSON 同步', async ({ page }) => {
    await mockEditor(page, EDITOR_UI);
    await page.goto('/workflows/edit?path=' + encodeURIComponent('E:/mock/a.json'));

    const nodes = page.locator('.node');
    await expect(nodes).toHaveCount(2);
    await expect(page.locator('.fmt-badge')).toHaveText('UI');

    // 供给线（加载器 → 消费者）默认收起；开关能展开，选中消费者时也会自动出现
    const wires = page.locator('svg.wires path.wire');
    await expect(wires).toHaveCount(0);
    await page.getByTestId('wf-supply').click();
    await expect(wires).toHaveCount(1);
    // 需要拐弯的线走顶部/底部总线，且是正交折线 + 圆角，不是贝塞尔
    await expect(page.locator('.bus-rail')).toHaveCount(1);
    const wireD = await wires.first().getAttribute('d');
    expect(wireD).toContain('Q');
    expect(wireD).not.toContain('C');
    // 关掉总线走线 → 短连线退回列间直连，不再挂总线
    await page.getByTestId('wf-bus-route').click();
    await expect(page.locator('.bus-rail')).toHaveCount(0);
    await expect(wires).toHaveCount(1);
    await page.getByTestId('wf-bus-route').click();
    await page.getByTestId('wf-supply').click();
    await expect(wires).toHaveCount(0);

    // 节点定义到了以后，控件名要认回来，而不是「参数 1」
    const ks = nodes.filter({ has: page.locator('.n-title', { hasText: 'KSampler' }) }).first();
    await ks.click();
    await expect(wires).toHaveCount(1);
    const insp = page.locator('.insp');
    await expect(insp.locator('.flabel').first()).toHaveText('种子');
    await expect(insp.locator('.fnum').first()).toHaveValue('42');
    await expect(insp.locator('.flabel')).toContainText(['种子', '生成后', '步数', 'CFG', '采样器', '调度器']);

    // JSON 视图与画布是同一份数据
    await page.getByRole('button', { name: 'UI JSON', exact: true }).click();
    const area = page.locator('.jsonarea');
    await expect(area).toHaveValue(/"KSampler"/);
    await expect(area).toHaveValue(/"widgets_values"/);
    await page.screenshot({ path: ART + '/52-workflow-editor-json.png', fullPage: false });

    // API JSON 不能粘进 UI 文件：拒绝应用，而不是当成空工作流保存
    await area.fill(JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } }));
    await page.getByRole('button', { name: '应用到画布', exact: true }).click();
    await expect(page.locator('.jsonerr')).toContainText('API 格式');

    await page.getByRole('button', { name: '画布', exact: true }).click();
    await expect(page.locator('.status')).toContainText('2 节点');
    await page.screenshot({ path: ART + '/53-workflow-editor-canvas.png', fullPage: false });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('工作流编辑器：改参数保存时原样带回未知字段', async ({ page }) => {
    const saved: { value: any } = { value: null };
    await mockEditor(page, EDITOR_UI, saved);
    await page.goto('/workflows/edit?path=' + encodeURIComponent('E:/mock/a.json'));

    const ks = page.locator('.node').filter({ has: page.locator('.n-title', { hasText: 'KSampler' }) }).first();
    await ks.click();
    const seed = page.locator('.insp .fnum').first();
    await seed.fill('43');
    await seed.blur();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('已保存');
    await expect(page.locator('.toast')).toContainText('.bak');

    expect(saved.value).toBeTruthy();
    expect(saved.value.path).toBe('E:/mock/a.json');
    const nodes = saved.value.data.nodes;
    expect(nodes[1].widgets_values[0]).toBe(43);
    // 位置、尺寸、未知字段不能因为过一次编辑器就变形
    expect(nodes[0].pos).toEqual([80, 80]);
    expect(nodes[0].size).toEqual([210, 100]);
    expect(nodes[0].properties['Node name for S&R']).toBe('UNETLoader');
    // 没有 title 的节点不该被强塞一个
    expect(nodes[0].title).toBeUndefined();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('工作流编辑器：API 文件不出 UI JSON，保存写回 API 格式', async ({ page }) => {
    const api = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'krea2.safetensors' } },
      '2': { class_type: 'VAEDecode', inputs: { samples: ['1', 0], vae: ['1', 2] } },
    };
    const saved: { value: any } = { value: null };
    await page.route((url: URL) => url.pathname === '/api/workflows/file', async (route: any) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            path: 'E:/mock/api.json', name: 'api', folder: '', format: 'api',
            size: 80, mtime: 1700000000, data: api, raw: JSON.stringify(api), error: '',
          },
        });
        return;
      }
      saved.value = route.request().postDataJSON();
      await route.fulfill({
        json: {
          path: 'E:/mock/api.json', name: 'api', format: 'api',
          size: 90, mtime: 1700000001, backup: 'E:/mock/api.json.bak',
        },
      });
    });
    await page.route((url: URL) => url.pathname === '/api/workflows/object-info', (route: any) =>
      route.fulfill({ json: { available: false, source: '', fetched_at: 0, nodes: {} } }));
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({ json: { dir: '', total: 0, groups: [], items: [] } }));

    await page.goto('/workflows/edit?path=' + encodeURIComponent('E:/mock/api.json'));
    await expect(page.locator('.fmt-badge')).toHaveText('API');
    await expect(page.locator('.node')).toHaveCount(2);
    // API 格式没有布局信息：UI JSON 明确禁用
    await expect(page.getByRole('button', { name: 'UI JSON', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'API', exact: true }).click();
    const area = page.locator('.jsonarea');
    await expect(area).toHaveValue(/"class_type": "VAEDecode"/);
    await area.fill(JSON.stringify({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'other.safetensors' } },
      '2': { class_type: 'VAEDecode', inputs: { samples: ['1', 0], vae: ['1', 2] } },
    }, null, 2));
    await page.getByRole('button', { name: '应用到画布', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('已应用到画布');
    await page.getByRole('button', { name: '画布', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('已保存');
    expect(saved.value.data['1'].inputs.ckpt_name).toBe('other.safetensors');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('工作流编辑器：坏 JSON 先在文本里修，再应用回画布', async ({ page }) => {
    await page.route((url: URL) => url.pathname === '/api/workflows/file', (route: any) =>
      route.fulfill({
        json: {
          path: 'E:/mock/bad.json', name: 'bad', folder: '', format: 'broken',
          size: 20, mtime: 1700000000, data: null, raw: '{"nodes": [}', error: 'JSON 语法错误',
        },
      }));
    await page.route((url: URL) => url.pathname === '/api/workflows/object-info', (route: any) =>
      route.fulfill({ json: { available: false, source: '', fetched_at: 0, nodes: {} } }));
    await page.route((url: URL) => url.pathname === '/api/workflows/local', (route: any) =>
      route.fulfill({ json: { dir: '', total: 0, groups: [], items: [] } }));

    await page.goto('/workflows/edit?path=' + encodeURIComponent('E:/mock/bad.json'));
    await expect(page.locator('.fmt-badge')).toHaveText('语法错误');
    await expect(page.getByRole('button', { name: '画布', exact: true })).toBeDisabled();
    await expect(page.locator('.jsonarea')).toHaveValue('{"nodes": [}');

    await page.locator('.jsonarea').fill(JSON.stringify({ nodes: [{ id: 1, type: 'KSampler', pos: [40, 40], size: [210, 120], widgets_values: [] }], links: [], version: 0.4 }, null, 2));
    await page.getByRole('button', { name: '应用到画布', exact: true }).click();
    await expect(page.locator('.fmt-badge')).toHaveText('UI');
    await page.getByRole('button', { name: '画布', exact: true }).click();
    await expect(page.locator('.node')).toHaveCount(1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

});
