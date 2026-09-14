import './prepare-e2e-db.mjs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const executable = fileURLToPath(new URL(`../target/debug/relay-api${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
const child = spawn(executable, [], {stdio: 'inherit', env: process.env})
child.on('error', () => { console.error('Cannot start Relay test API. Run cargo build -p relay-api first.'); process.exit(1) })
child.on('exit', code => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
