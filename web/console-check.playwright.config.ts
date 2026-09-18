import { defineConfig } from '@playwright/test'
// Local-only runner for the console spec on a free port; every API call is mocked in the spec.
export default defineConfig({
  testDir: './reptest-tests', testMatch: 'hermes-console.spec.ts', outputDir: 'test-results/console-check',
  workers: 1, timeout: 60_000,
  use: {baseURL: 'http://127.0.0.1:5291', viewport: {width: 1440, height: 940}, colorScheme: 'light', trace: 'retain-on-failure'},
  webServer: [{command: 'npm run dev -- --port 5291', url: 'http://127.0.0.1:5291', timeout: 60_000}],
})
