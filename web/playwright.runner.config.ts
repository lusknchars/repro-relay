import { defineConfig } from '@playwright/test'
export default defineConfig({
  outputDir:'test-results/runner-artifacts', testDir:'./tests',testMatch:'runner.spec.ts',workers:1,timeout:60_000,
  use:{baseURL:'http://127.0.0.1:5180',viewport:{width:1440,height:960},trace:'retain-on-failure'},
  webServer:[
    {command:'node ../scripts/hermes-fixture.mjs',url:'http://127.0.0.1:8654/health',env:{REPRO_FIXTURE_ONLY:'1'}},
    {command:'../target/debug/relay-api',url:'http://127.0.0.1:8182/api/v1/health',timeout:30_000,env:{REPRO_PORT:'8182',DATABASE_URL:process.env.E2E_DATABASE_URL||'postgres://relay:relay_local_only@127.0.0.1:55478/relay_e2e',REPRO_HERMES_URL:'http://127.0.0.1:8654',REPRO_HERMES_KEY:'browser-fixture-key'}},
    {command:'npm run dev -- --port 5180',url:'http://127.0.0.1:5180',env:{REPRO_API_URL:'http://127.0.0.1:8182'}},
  ],
})
