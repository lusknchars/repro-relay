import { spawnSync } from 'node:child_process'

// Bootstrap through an existing maintenance database, never through the database
// we are about to create. A retained local relay_e2e used to hide this CI failure.
const target = new URL(process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || 'postgres://relay:relay_local_only@127.0.0.1:55478/relay')
if (!process.env.E2E_DATABASE_URL) target.pathname = '/relay_e2e'
const name = target.pathname.slice(1)
if (!/^[a-z][a-z0-9_]*_e2e$/.test(name)) throw new Error('The browser-test database name must end in _e2e.')
const maintenance = new URL(target)
maintenance.pathname = '/postgres'
const check = spawnSync('psql', [maintenance.href, '-Atc', `SELECT 1 FROM pg_database WHERE datname='${name}'`], {encoding: 'utf8'})
if (check.status !== 0) {
  console.error(check.error?.code === 'ENOENT'
    ? 'PostgreSQL client missing. Add psql and createdb to PATH.'
    : 'Cannot reach the PostgreSQL maintenance database. Start the test database server and check its connection settings.')
  process.exit(1)
}
if (check.stdout.trim() !== '1') {
  const result = spawnSync('createdb', ['--maintenance-db', maintenance.href, name], {stdio: 'inherit'})
  if (result.status !== 0) process.exit(1)
}
console.log('Isolated browser-test database is ready.')
