import path from 'node:path'
import process from 'node:process'
import {
  DEFAULT_V5_APP_PROFILE,
  getV5AppConfig,
  isSafeId,
  normalizeV5AppProfile,
  rootDir,
  stageV5AppPackage,
} from './lib/v5-app-packaging.mjs'
import { inferV5AppIdFromCwd } from './lib/v5-app-versioning.mjs'

function usage() {
  console.log([
    'Usage:',
    '  node scripts/stage-v5-app.mjs --app <id> [--profile release|dev] [--no-build] [--stage-dir <dir>]',
    '  node ../../scripts/stage-v5-app.mjs [--profile release|dev] [--no-build]   # from apps/<id>',
  ].join('\n'))
}

function parseArgs(argv) {
  const out = { appId: '', noBuild: false, profile: DEFAULT_V5_APP_PROFILE, stageDir: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') continue
    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--app' && i + 1 < argv.length) {
      out.appId = String(argv[++i] || '').trim()
      continue
    }
    if (arg === '--stage-dir' && i + 1 < argv.length) {
      const stageDir = String(argv[++i] || '').trim()
      if (!stageDir) throw new Error('--stage-dir 不能为空')
      out.stageDir = path.resolve(process.cwd(), stageDir)
      continue
    }
    if (arg === '--profile' && i + 1 < argv.length) {
      out.profile = normalizeV5AppProfile(argv[++i])
      continue
    }
    if (arg === '--no-build') {
      out.noBuild = true
      continue
    }
    throw new Error(`未知参数: ${arg}`)
  }
  if (!out.appId) out.appId = inferV5AppIdFromCwd(process.cwd(), rootDir)
  if (!out.appId) throw new Error('无法确定 v5 app id，请使用 --app <id>，或在 apps/<id> 目录内执行')
  if (!isSafeId(out.appId)) throw new Error(`app id 不合法: ${out.appId}`)
  return out
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const config = await getV5AppConfig(opts.appId)
  const result = await stageV5AppPackage(config, {
    noBuild: opts.noBuild,
    profile: opts.profile,
    ...(opts.stageDir ? { stageDir: opts.stageDir } : {}),
  })
  console.log(JSON.stringify({
    appId: result.appId,
    profile: result.profile,
    version: result.version,
    stageDir: result.stageDir,
    executablePath: result.executablePath,
    manifestPath: result.manifestPath,
  }, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
