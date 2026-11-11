import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', workers: 1, timeout: 60000,
  use: { baseURL: 'http://localhost:8080', viewport: { width: 1440, height: 1000 }, trace: 'off', screenshot: 'only-on-failure' },
  outputDir: 'test-results', reporter: 'list',
});
