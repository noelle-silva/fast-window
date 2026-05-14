import path from 'node:path'
import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import { isSafeId, rootDir } from './lib/v5-app-packaging.mjs'
import { defaultV5AppPublishOptions, publishV5AppToDownload } from './lib/v5-app-publishing.mjs'

function usage() {
  console.log('Usage: node scripts/publish-v5-app-to-download.mjs --app <id> [--dry-run] [--no-build] [--force]')
}

function parseArgs(argv) {
  const out = { ...defaultV5AppPublishOptions(), appId: '' }
  const args = scriptArgs(argv)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--app' && i + 1 < args.length) out.appId = String(args[++i] || '').trim()
    else if (arg === '--owner' && i + 1 < args.length) out.owner = String(args[++i] || '').trim() || out.owner
    else if (arg === '--repo' && i + 1 < args.length) out.repo = String(args[++i] || '').trim() || out.repo
    else if (arg === '--branch' && i + 1 < args.length) out.branch = String(args[++i] || '').trim() || out.branch
    else if (arg === '--out' && i + 1 < args.length) out.outDir = path.resolve(rootDir, String(args[++i] || '').trim())
    else if (arg === '--message' && i + 1 < args.length) out.message = String(args[++i] || '').trim() || out.message
    else if (arg === '--no-build') out.noBuild = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--force') out.force = true
    else throw new Error(`未知参数: ${arg}`)
  }
  if (!out.appId) throw new Error('Usage: node scripts/publish-v5-app-to-download.mjs --app <id> [--dry-run] [--no-build] [--force]')
  if (!isSafeId(out.appId)) throw new Error(`app id 不合法: ${out.appId}`)
  return out
}

async function main() {
  const result = await publishV5AppToDownload(parseArgs(process.argv))
  console.log(JSON.stringify(result, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
