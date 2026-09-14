import { defineConfig } from '@playwright/test'

const channel = process.env.REPRO_BROWSER_CHANNEL
if (channel && channel !== 'msedge') throw new Error('REPRO_BROWSER_CHANNEL must be msedge or unset.')

// Tests the supplied default frontend, independently of the retained backend UI.
export default defineConfig({
  testDir: './reptest-tests',
  outputDir: 'test-results/exact-reptest',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5187', viewport: { width: 1440, height: 940 }, colorScheme: 'light', ...(channel ? { channel } : {}) },
  webServer: { command: 'npm run dev -- --port 5187', url: 'http://127.0.0.1:5187', timeout: 30_000 },
})
