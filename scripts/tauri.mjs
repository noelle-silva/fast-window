import { spawn } from 'node:child_process'
import process from 'node:process'
import { assertHostTauriBuildAllowed, hostDevProfileEnv } from './lib/host-tauri-build-policy.mjs'

const HOST_DEV_CONFIG = 'src-tauri/tauri.conf.dev.json'
const HOST_FAST_DEV_CONFIG = 'src-tauri/tauri.fast.conf.json'
const HOST_DEV_PROFILE_CONFIGS = [HOST_DEV_CONFIG]
const HOST_FAST_DEV_PROFILE_CONFIGS = [HOST_DEV_CONFIG, HOST_FAST_DEV_CONFIG]

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts })
}

function waitExit(p) {
  return new Promise(resolve => p.on('exit', code => resolve(code ?? 0)))
}

function withConfigFiles(tauriArgs, configFiles) {
  const separatorIndex = tauriArgs.indexOf('--')
  const insertIndex = separatorIndex === -1 ? tauriArgs.length : separatorIndex
  const configArgs = configFiles.flatMap(configFile => ['--config', configFile])

  return [
    ...tauriArgs.slice(0, insertIndex),
    ...configArgs,
    ...tauriArgs.slice(insertIndex),
  ]
}

function parseHostWrapperArgs(rawArgs) {
  const separatorIndex = rawArgs.indexOf('--')
  const wrapperArgEndIndex = separatorIndex === -1 ? rawArgs.length : separatorIndex
  const wrapperArgs = rawArgs.slice(0, wrapperArgEndIndex)
  const passthroughArgs = separatorIndex === -1 ? [] : rawArgs.slice(separatorIndex)

  return {
    fastDev: wrapperArgs.includes('--fast'),
    args: [
      ...wrapperArgs.filter(arg => arg !== '--fast'),
      ...passthroughArgs,
    ],
  }
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const { fastDev, args } = parseHostWrapperArgs(rawArgs)
  const isDev = (args[0] || '').trim() === 'dev'
  try {
    assertHostTauriBuildAllowed(args)
  } catch (error) {
    console.error(String(error?.message || error))
    process.exit(1)
    return
  }

  const runTauri = (tauriArgs, opts = {}) => run('pnpm', ['exec', 'tauri', ...tauriArgs], opts)

  if (isDev) {
    const configFiles = fastDev ? HOST_FAST_DEV_PROFILE_CONFIGS : HOST_DEV_PROFILE_CONFIGS
    const code = await waitExit(runTauri(withConfigFiles(args, configFiles), { env: hostDevProfileEnv() }))
    process.exit(code)
    return
  }

  // build 与其它透传子命令（info / icon / signer 等）直接交给 tauri
  const code = await waitExit(runTauri(args))
  process.exit(code)
}

await main()
