import { spawn } from 'node:child_process'
import process from 'node:process'

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts })
}

function killProc(p) {
  if (!p || p.killed) return
  try {
    p.kill()
  } catch {}
}

function killAll(procs) {
  for (const p of procs) killProc(p)
}

function waitExit(p) {
  return new Promise(resolve => p.on('exit', code => resolve(code ?? 0)))
}

async function main() {
  const args = process.argv.slice(2)
  const sub = (args[0] || '').trim()
  const isDev = sub === 'dev'
  const isBuild = sub === 'build'

  const runTauri = (tauriArgs) => run('pnpm', ['exec', 'tauri', ...tauriArgs])

  if (isDev) {
    const watch = run('pnpm', ['run', 'plugins:watch'])
    const tauri = runTauri(args)
    const procs = [watch, tauri]

    const shutdown = (code) => {
      killAll(procs)
      process.exit(code)
    }

    process.on('SIGINT', () => shutdown(0))
    process.on('SIGTERM', () => shutdown(0))

    const code = await waitExit(tauri)
    shutdown(code)
    return
  }

  if (isBuild) {
    const code1 = await waitExit(run('pnpm', ['run', 'plugins:build']))
    if (code1 !== 0) process.exit(code1)
    const code2 = await waitExit(run('node', ['scripts/prepare-tauri-resources.mjs']))
    if (code2 !== 0) process.exit(code2)
    const code3 = await waitExit(runTauri(args))
    process.exit(code3)
    return
  }

  // passthrough (info, icon, signer, etc.)
  const code = await waitExit(runTauri(args))
  process.exit(code)
}

await main()
