import { defineConfig } from '@playwright/test'
export default defineConfig({
  outputDir: 'test-results/guest-artifacts',
  testDir:'./tests',testMatch:'guest.spec.ts',workers:1,timeout:45_000,
  use:{baseURL:'http://127.0.0.1:5190',viewport:{width:1440,height:960},trace:'retain-on-failure'},
  webServer:{command:'cd .. && target/debug/relay-api',url:'http://127.0.0.1:5190/api/v1/health',timeout:30_000,
    env:{REPRO_MODE:'guest',PUBLIC_ORIGIN:'http://127.0.0.1:5190',REPRO_PORT:'5190',DATABASE_URL:process.env.E2E_DATABASE_URL||'postgres://relay:relay_local_only@127.0.0.1:55478/relay_e2e'}},
})
