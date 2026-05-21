import path from 'node:path'
import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import { rootDir } from './lib/v5-app-packaging.mjs'
import { buildHostMsiPackage, defaultHostPublishOptions } from './lib/host-publishing.mjs'
import { consumeHostVersionArg, hostVersionUsageLines } from './lib/host-versioning.mjs'

function usage() {
  console.log([
    'Usage:',
    '  node scripts/build-host-msi.mjs --keep-version',
    '  node scripts/build-host-msi.mjs --bump patch',
    '  node scripts/build-host-msi.mjs --version 1.6.12',
    '',
    ...hostVersionUsageLines({ allowKeep: true }),
    '',
    'Build options:',
    '  --out <dir>      copy MSI to output dir after Tauri build',
    '  --no-build       reuse an existing Tauri MSI for the declared version',
    '  --dry-run        preview version/build plan without writing files or building',
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
    if (arg === '--out' && i + 1 < args.length) out.outDir = path.resolve(rootDir, String(args[++i] || '').trim())
    else if (arg === '--no-build') out.noBuild = true
    else if (arg === '--dry-run') out.dryRun = true
    else {
      const nextIndex = consumeHostVersionArg(out.versionDeclaration, args, i)
      if (nextIndex >= 0) i = nextIndex
      else throw new Error(`未知参数: ${arg}`)
    }
  }
  return out
}

async function main() {
  const result = await buildHostMsiPackage(parseArgs(process.argv))
  console.log(JSON.stringify(result, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
