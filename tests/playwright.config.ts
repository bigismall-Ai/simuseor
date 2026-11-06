import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// tests/ 的上一级就是项目根，后端和 .venv 都在那里
const repoRoot = resolve(__dirname, '..');

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
    baseURL: 'http://127.0.0.1:8000',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command:
      process.platform === 'win32'
        ? '.venv\\Scripts\\python.exe backend/run.py'
        : '.venv/bin/python backend/run.py',
    cwd: repoRoot,
    url: 'http://127.0.0.1:8000/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
