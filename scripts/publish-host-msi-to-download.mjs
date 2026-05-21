import path from 'node:path'
import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import { rootDir } from './lib/v5-app-packaging.mjs'
import { defaultHostPublishOptions, publishHostMsiToDownload } from './lib/host-publishing.mjs'
import { consumeHostVersionArg, hostVersionUsageLines } from './lib/host-versioning.mjs'

function usage() {
  console.log([
    'Usage:',
    '  node scripts/publish-host-msi-to-download.mjs --keep-version [--dry-run] [--no-build] [--force]',
    '  node scripts/publish-host-msi-to-download.mjs --bump patch [--dry-run] [--force]',
    '  node scripts/publish-host-msi-to-download.mjs --version 1.6.12 [--dry-run] [--force]',
    '',
    ...hostVersionUsageLines({ allowKeep: true }),
    '',
    'Publish options:',
    '  --owner <owner>   GitHub owner',
    '  --repo <repo>     GitHub download repository',
    '  --branch <branch> catalog branch',
    '  --out <dir>       local artifact output dir',
    '  --message <text>  catalog commit message',
    '  --no-build        reuse an existing Tauri MSI for the declared version',
    '  --dry-run         preview without writing versions, building, uploading, or writing catalog',
    '  --force           allow replacing an existing release asset/catalog version',
  ].join('\n'))
}

function parseArgs(argv) {
  const out = { ...defaultHostPublishOptions() }
  const args = scriptArgs(argv)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--owner' && i + 1 < args.length) out.owner = String(args[++i] || '').trim() || out.owner
    else if (arg === '--repo' && i + 1 < args.length) out.repo = String(args[++i] || '').trim() || out.repo
    else if (arg === '--branch' && i + 1 < args.length) out.branch = String(args[++i] || '').trim() || out.branch
    else if (arg === '--out' && i + 1 < args.length) out.outDir = path.resolve(rootDir, String(args[++i] || '').trim())
    else if (arg === '--message' && i + 1 < args.length) out.message = String(args[++i] || '').trim() || out.message
    else if (arg === '--no-build') out.noBuild = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--force') out.force = true
    else {
      const nextIndex = consumeHostVersionArg(out.versionDeclaration, args, i)
      if (nextIndex >= 0) i = nextIndex
      else throw new Error(`未知参数: ${arg}`)
    }
  }
  return out
}

async function main() {
  const result = await publishHostMsiToDownload(parseArgs(process.argv))
  console.log(JSON.stringify(result, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
