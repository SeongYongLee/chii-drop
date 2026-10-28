import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser', testMatch: '*.spec.js', workers: 1,
  timeout: 90000, expect: { timeout: 20000 }, retries: 0,
  outputDir: 'artifacts/browser', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:5217', serviceWorkers: 'block',
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
    { name: 'webkit-mobile', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'node test/browser/server.mjs', url: 'http://127.0.0.1:5217/health', reuseExistingServer: false },
});
