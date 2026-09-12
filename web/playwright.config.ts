import { defineConfig } from '@playwright/test'
export default defineConfig({
  outputDir: 'test-results/workflow-artifacts',
  testDir: './tests', testIgnore: 'guest.spec.ts', fullyParallel: false, workers: 1, timeout: 45_000,
  use: {baseURL: 'http://127.0.0.1:5180', viewport: {width: 1512,height: 982}, trace: 'retain-on-failure'},
  webServer: [
    {command: '../target/debug/relay-api', url: 'http://127.0.0.1:8180/api/v1/health', timeout: 30_000,
      env: {REPRO_PORT: '8180', DATABASE_URL: process.env.E2E_DATABASE_URL || 'postgres://relay:relay_local_only@127.0.0.1:55478/relay_e2e'}},
    {command: 'npm run dev -- --port 5180', url: 'http://127.0.0.1:5180', timeout: 30_000,
      env: {REPRO_API_URL: 'http://127.0.0.1:8180'}},
  ],
})
