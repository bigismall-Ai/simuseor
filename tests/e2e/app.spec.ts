import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// 截图固定落在 tests/artifacts/，与执行目录无关
const ART = resolve(__dirname, '../artifacts');

test.describe('Model Downloader Web UI', () => {
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

    // 探测要跑 nvidia-smi / CIM，给足时间；徽章必须是三种结论之一
    await expect(page.getByText(/可启用显卡加速|可用，但有性能限制|当前无法安装/)).toBeVisible({
      timeout: 20_000,
    });

    // 设备卡不能停在占位文案上
    await expect(page.getByText('待检测')).toHaveCount(0);
    await expect(page.getByText('检测时间')).toBeVisible();
    await page.screenshot({ path: ART + '/12-comfy-env.png', fullPage: true });

    // 重新检测（带 refresh=true，绕过服务端 60 秒缓存）
    await page.getByRole('button', { name: '重新检测' }).click();
    await expect(page.getByRole('button', { name: '重新检测' })).toBeEnabled({ timeout: 20_000 });
  });
});
