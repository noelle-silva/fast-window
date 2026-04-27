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

function withDevSyncDisabledEnv() {
  return {
    ...process.env,
    FAST_WINDOW_SKIP_PLUGIN_DEV_SYNC: process.env.FAST_WINDOW_SKIP_PLUGIN_DEV_SYNC || '1',
  }
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const skipPluginWatch = process.env.FAST_WINDOW_SKIP_PLUGIN_WATCH === '1' || rawArgs.includes('--no-plugin-watch')
  const skipPluginDevSync = process.env.FAST_WINDOW_SKIP_PLUGIN_DEV_SYNC === '1' || rawArgs.includes('--no-plugin-dev-sync')
  const args = rawArgs.filter(arg => arg !== '--no-plugin-watch' && arg !== '--no-plugin-dev-sync')
  const sub = (args[0] || '').trim()
  const isDev = sub === 'dev'
  const isBuild = sub === 'build'

  const runTauri = (tauriArgs, opts = {}) => run('pnpm', ['exec', 'tauri', ...tauriArgs], opts)
  const pluginFilter = String(process.env.FAST_WINDOW_PLUGIN || '').trim()

  if (isDev) {
    if (skipPluginWatch) {
      const opts = skipPluginDevSync ? { env: withDevSyncDisabledEnv() } : {}
      const code = await waitExit(runTauri(args, opts))
      process.exit(code)
      return
    }

    const watch = run('pnpm', pluginFilter ? ['run', 'plugins:watch', '--', '--plugin', pluginFilter] : ['run', 'plugins:watch'])
    const tauri = runTauri(args, skipPluginDevSync ? { env: withDevSyncDisabledEnv() } : {})
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
    const code = await waitExit(runTauri(args))
    process.exit(code)
    return
  }

  // passthrough (info, icon, signer, etc.)
  const code = await waitExit(runTauri(args))
  process.exit(code)
}

await main()
