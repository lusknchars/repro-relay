// Keep the previous UI's guest-isolation regression tests. The default bundle
// is the supplied Reptest frontend; these tests explicitly use legacy-dist.
import { mkdir, symlink, realpath } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const cwd = path.join(root, 'web/test-results/legacy-guest-server')
const bundle = await realpath(path.join(root, 'web/legacy-dist'))
await mkdir(path.join(cwd, 'web'), { recursive: true })
try { await symlink(bundle, path.join(cwd, 'web/dist'), 'dir') }
catch (error) { if (error.code !== 'EEXIST') throw error }
const child = spawn(path.join(root, 'target/debug/relay-api'), [], { cwd, stdio: 'inherit', env: process.env })
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
