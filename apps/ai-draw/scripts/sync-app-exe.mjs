import path from 'node:path'
import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import {
  DEFAULT_V5_APP_PROFILE,
  loadAppConfig,
  normalizeV5AppProfile,
  rootDir,
  syncV5AppExecutable,
} from './lib/v5-app-packaging.mjs'

const usageLine = [
  '用法：node scripts/sync-app-exe.mjs [--profile release|dev] [--no-build] [--stage-dir <dir>]',
  '说明：只同步 staging 入口 exe，不重建整个应用目录；stdout 输出 JSON 结果，日志走 stderr。',
].join('\n')

function parseArgs(argv) {
  const out = { noBuild: false, profile: DEFAULT_V5_APP_PROFILE, stageDir: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      console.log(usageLine)
      process.exit(0)
    }
    if (arg === '--profile' && i + 1 < argv.length) {
      out.profile = normalizeV5AppProfile(argv[++i])
      continue
    }
    if (arg === '--stage-dir' && i + 1 < argv.length) {
      const stageDir = String(argv[++i] || '').trim()
      if (!stageDir) throw new Error('--stage-dir 不能为空')
      out.stageDir = path.resolve(rootDir, stageDir)
      continue
    }
    if (arg === '--no-build') {
      out.noBuild = true
      continue
    }
    throw new Error(`未知参数: ${arg}`)
  }
  return out
}

async function main() {
  const opts = parseArgs(scriptArgs(process.argv))
  const config = await loadAppConfig()
  const result = await syncV5AppExecutable(config, {
    noBuild: opts.noBuild,
    profile: opts.profile,
    ...(opts.stageDir ? { stageDir: opts.stageDir } : {}),
  })
  console.log(JSON.stringify({
    appId: result.appId,
    profile: result.profile,
    version: result.version,
    stageDir: result.stageDir,
    packageDir: result.packageDir,
    executablePath: result.executablePath,
    manifestPath: result.manifestPath,
  }))
}

await main().catch(error => {
  process.stderr.write(`${String(error?.message || error)}\n`)
  process.exitCode = 1
})
