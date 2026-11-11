import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', workers: 1, timeout: 60000,
  // Compose serves the SPA over HTTPS with a local self-signed certificate (Part C).
  use: { baseURL: process.env.E2E_BASE_URL ?? 'https://localhost:8443', ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, trace: 'off', screenshot: 'only-on-failure' },
  outputDir: 'test-results', reporter: 'list',
});
