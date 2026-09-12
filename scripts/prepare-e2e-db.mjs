import { spawnSync } from 'node:child_process'
const database = process.env.DATABASE_URL || 'postgres://relay:relay_local_only@127.0.0.1:55478/relay'
const check = spawnSync('psql', [database, '-Atc', "SELECT 1 FROM pg_database WHERE datname='relay_e2e'"], {encoding: 'utf8'})
if (check.status !== 0) {
  console.error('Could not reach PostgreSQL. Run make db and ensure psql is installed.')
  process.exit(1)
}
if (check.stdout.trim() !== '1') {
  const result = spawnSync('createdb', ['--maintenance-db', database, 'relay_e2e'], {stdio: 'inherit'})
  if (result.status !== 0) process.exit(1)
}
console.log('Isolated browser-test database is ready.')
