import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// 截图固定落在 tests/artifacts/，与执行目录无关
const ART = resolve(__dirname, '../artifacts');

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

    await page.getByRole('link', { name: '模型库' }).click();
    await expect(page.getByText('本地模型库')).toBeVisible();
    await page.screenshot({ path: ART + '/02-library.png', fullPage: true });
  });

  test('设置页：保存配置并测试代理', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: '测试代理' }).first().click();
    await expect(page.getByText(/代理 .*可用/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByText('设置已保存')).toBeVisible();
    await page.screenshot({ path: ART + '/07-settings-proxy.png', fullPage: true });
  });

  test('demo 源：解析 → 勾选 → 下载 → 入库', async ({ page }) => {
    await page.goto('/downloads?demo=1');

    await page.locator('select').first().selectOption('demo');
    await page.getByPlaceholder('如 microsoft/Phi-3-mini-4k-instruct').fill('demo/text-gen-1.5');
    await page.getByRole('button', { name: '解析文件' }).click();

    await expect(page.getByText('model.safetensors').first()).toBeVisible();
    await expect(page.getByText('5 个文件')).toBeVisible();
    await page.screenshot({ path: ART + '/04-resolved-files.png', fullPage: true });

    await page.getByRole('button', { name: '开始下载' }).click();
    const firstTask = page.locator('.task').first();
    await expect(firstTask).toContainText('demo/text-gen-1.5');
    await expect(firstTask.locator('.head').getByText(/下载中|已完成/).first()).toBeVisible();
    await page.screenshot({ path: ART + '/05-downloading.png', fullPage: true });

    await expect(firstTask.locator('.head').getByText('已完成').first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: ART + '/06-task-completed.png', fullPage: true });

    await page.getByRole('link', { name: '模型库' }).click();
    await expect(page.getByText('text-gen-1.5').first()).toBeVisible();
    await page.screenshot({ path: ART + '/08-library-after-download.png', fullPage: true });

    await page.getByTitle('收藏').first().click();
    await expect(page.getByText('★').first()).toBeVisible();
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
    await page.goto('/discover?demo=1');
    await expect(page.getByRole('heading', { name: '模型发现' })).toBeVisible();
    await page.getByRole('button', { name: 'Demo', exact: true }).click();
    await page.getByPlaceholder('搜索模型关键词，如 qwen / lora / flux').fill('text');
    await page.getByTestId('search-btn').click();
    await expect(page.getByText('text-gen-1.5').first()).toBeVisible();
    // URL 同步了筛选状态
    await expect(page).toHaveURL(/\/discover\?.*source=demo/);
    await page.screenshot({ path: ART + '/10-discover.png', fullPage: true });

    // 行内弹层：解析 → 创建任务
    await page.getByTestId('card-download').first().click();
    await expect(page.getByTestId('dialog-files')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('dialog-create').click();
    await expect(page.getByText('已创建下载任务')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: ART + '/11-discover-to-download.png', fullPage: true });

    // 跳到下载任务页验证任务存在
    await page.getByTestId('dialog-goto-tasks').click();
    await expect(page).toHaveURL(/\/downloads/);
    await expect(page.locator('.task').first()).toContainText('demo/', { timeout: 15_000 });
  });

  test('环境管理：显示本机设备与安装方案', async ({ page }) => {
    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
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

    await page.goto('/comfy');
    await expect(page.locator('.instance-row')).toHaveCount(1, { timeout: 20_000 });
    await page.locator('.instance-row').getByRole('button', { name: '删除' }).click();
    await expect(page.getByText('删除失败：目录被占用')).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
