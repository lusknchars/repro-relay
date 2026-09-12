// Explicit synthetic data. No fixture URL is fetched and no external message is sent.
const base = 'http://127.0.0.1:8178/api/v1'
async function request(path, body, key) {
  const response = await fetch(`${base}${path}`, {method:body ? 'POST':'GET',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body ? JSON.stringify(body):undefined})
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}
let first = await request('/cases', {
  title:'Demo: CSV export stops after changing the date range', project:'Demo / Atlas',
  url:'https://example.com/demo/reports', build:'demo-build-104',
  description:'The report loads correctly, but Export CSV produces no file after changing the date range.',
  expected:'Download a CSV containing the rows for the selected date range.',
}, 'repro-relay-demo-export-v1')
if (first.revision === 1) {
  first = await request(`/cases/${first.id}/observations`, {revision:1,result:'reproduced',author:'Demo fixture',
    build:'demo-build-104',observed:'Fixture observation: no download appeared after Export. This is synthetic data for the walkthrough.',
    steps:'1. Open Reports.\n2. Select Last month.\n3. Click Export CSV.',evidence_url:'https://example.com/demo/export-trace'})
  await request(`/cases/${first.id}/memory`, {revision:first.revision,reviewer:'Demo fixture'})
}
await request('/cases', {
  title:'Demo: CSV export fails on a custom date range',project:'Demo / Atlas',
  url:'https://example.com/demo/reports',build:'demo-build-104',
  description:'A second synthetic report with matching terms so you can inspect related reviewed memory.',
  expected:'Download a CSV for the custom date range.',
}, 'repro-relay-demo-related-v1')
console.log('Two labeled demo cases are available. All evidence is synthetic.')
