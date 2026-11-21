import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// tests/ 的上一级就是项目根，后端和 .venv 都在那里
const repoRoot = resolve(__dirname, '..');

/**
 * 用本机已装的 Chromium，而不是 Playwright 自带的那份。
 *
 * 为什么：本机缓存里的浏览器版本与 tests/node_modules 里 Playwright 期望的版本
 * 对不上（期望 chromium_headless_shell-1248，实际只有 chromium-1234），
 * 于是每条用例都在 browserType.launch 就挂掉 —— **报的是「浏览器不存在」，
 * 不是断言失败**，看起来像全盘崩，其实一条都没跑到。
 *
 * 做法：优先用 Playwright 自带的；没有就退到本机 ms-playwright 缓存里已装的那份
 * （VIS 工具链 `vis-render.mjs` 用的也是它）。**不下载任何东西**，
 * 也不会在别的机器上把 E2E 弄坏 —— 路径不存在时就不设，走 Playwright 默认。
 */
const CHROMIUM_FALLBACK = 'C:/Users/Moc/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
let launchOptions: { executablePath?: string } | undefined;
try {
  const { chromium } = require('@playwright/test');
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) launchOptions = { executablePath: bundled };
  else if (existsSync(CHROMIUM_FALLBACK)) launchOptions = { executablePath: CHROMIUM_FALLBACK };
} catch {
  if (existsSync(CHROMIUM_FALLBACK)) launchOptions = { executablePath: CHROMIUM_FALLBACK };
}

// ─────────────────────────────────────────────────────────────────────────────
// E2E 端口：刻意用 8123 而不是 8000
// ─────────────────────────────────────────────────────────────────────────────
// 理由（2026-11-17 实测踩坑）：
//   1. 开发时 8000 常年跑着主仓库的 dev server（`backend/run.py`）。
//   2. 旧配置的 `reuseExistingServer: true` 会让 Playwright 直接复用那个进程，
//      于是**测到的是主仓库的 dist，而不是当前 worktree 的构建** ——
//      在 worktree 里跑 E2E 会得到「绿的但不是我的代码」的假通过。
//   3. 多 worktree 并行时更要命：大家抢同一个 8000。
//
// 做法：E2E 独占 8123，`reuseExistingServer: false` —— 端口被占就报错，
// 绝不静默复用别人的服务。测的就是本目录的构建。
const E2E_PORT = Number(process.env.E2E_PORT || 8123);
const baseURL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: resolve(__dirname, 'e2e'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: resolve(__dirname, 'test-results'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: resolve(__dirname, 'playwright-report') }],
  ],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    launchOptions,
  },
  webServer: {
    command:
      process.platform === 'win32'
        ? `.venv\\Scripts\\python.exe backend/run.py --port ${E2E_PORT}`
        : `.venv/bin/python backend/run.py --port ${E2E_PORT}`,
    cwd: repoRoot,
    url: `${baseURL}/api/health`,
    // 绝不静默复用已有服务：端口被占就报错，避免测到别的 worktree 的构建。
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
