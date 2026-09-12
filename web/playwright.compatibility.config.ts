import { defineConfig } from '@playwright/test'

// UI compatibility only: API responses in this suite are explicitly mocked.
// The runner suite exercises the Rust API and Hermes protocol fixture separately.
export default defineConfig({
  testDir: './compatibility',
  outputDir: 'test-results/compatibility-artifacts',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5186', viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } },
  ],
  webServer: { command: 'npm run dev -- --port 5186', url: 'http://127.0.0.1:5186', timeout: 30_000 },
})
