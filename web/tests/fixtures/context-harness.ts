import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve('test-results/autonomy-repository')
const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: 'pipe' })
export function harness() { run('python3', ['../integrations/context-harness/worker.py', '--repo', root, '--api', 'http://127.0.0.1:8180/api/v1', '--once']) }
export function fixture() {
  mkdirSync(resolve(root, 'nested'), { recursive: true })
  const instructions = `Browser workflow fixture ${Date.now()}. Preserve every evidence source and revision.\n`.repeat(60)
  writeFileSync(resolve(root, 'AGENTS.md'), instructions)
  writeFileSync(resolve(root, 'nested/AGENTS.md'), instructions)
  run('git', ['-C', root, 'init', '-q'])
  run('git', ['-C', root, 'add', 'AGENTS.md', 'nested/AGENTS.md'])
  run('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Controlled context harness fixture'])
  harness()
}
