import { spawn } from 'node:child_process'
import process from 'node:process'

function run(cmd, args) {
  return spawn(cmd, args, { stdio: 'inherit', shell: true })
}

const procs = [
  run('pnpm', ['run', 'plugins:watch']),
  run('pnpm', ['run', 'dev']),
]

function killAll(code) {
  for (const p of procs) {
    if (!p.killed) p.kill()
  }
  process.exit(code)
}

for (const p of procs) {
  p.on('exit', (code) => {
    killAll(code ?? 0)
  })
}

process.on('SIGINT', () => killAll(0))
process.on('SIGTERM', () => killAll(0))
