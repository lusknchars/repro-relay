import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

test('a fresh browser database is created through postgres and repeated setup preserves it', () => {
  const target = new URL(process.env.DATABASE_URL || 'postgres://relay:relay_local_only@127.0.0.1:55478/relay')
  const name = `relay_bootstrap_${randomBytes(6).toString('hex')}_e2e`
  target.pathname = '/' + name
  const maintenance = new URL(target)
  maintenance.pathname = '/postgres'
  const psql = (db, sql) => spawnSync('psql', [db.href, '-Atc', sql], {encoding:'utf8'})
  const exists = () => psql(maintenance, `SELECT 1 FROM pg_database WHERE datname='${name}'`).stdout.trim()
  assert.equal(exists(), '')
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./prepare-e2e-db.mjs', import.meta.url))], {
        env:{...process.env, DATABASE_URL:target.href, E2E_DATABASE_URL:target.href}, encoding:'utf8',
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(exists(), '1')
      if (attempt === 0) assert.equal(psql(target, 'CREATE TABLE bootstrap_marker (id int); INSERT INTO bootstrap_marker VALUES (7)').status, 0)
    }
    assert.equal(psql(target, 'SELECT id FROM bootstrap_marker').stdout.trim(), '7')
  } finally {
    // Only the random database created by this test is removed.
    assert.equal(psql(maintenance, `DROP DATABASE IF EXISTS ${name}`).status, 0)
  }
})
