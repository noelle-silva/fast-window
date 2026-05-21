import path from 'node:path'
import process from 'node:process'
import { scriptArgs } from './v5-cli-args.mjs'
import { rootDir } from './v5-app-packaging.mjs'
import { defaultHostPublishOptions, publishHostMsiToDownload } from './host-publishing.mjs'
import { consumeHostVersionArg, hostVersionUsageLines } from './host-versioning.mjs'
import { hostPublishTokenUsageLines } from './host-publish-tokens.mjs'

export function hostPublishUsage(commandName = 'node scripts/publish-host-msi.mjs') {
  return [
    'Usage:',
    `  ${commandName} --keep-version [--dry-run] [--no-build] [--force]`,
    `  ${commandName} --bump patch [--dry-run] [--force]`,
    `  ${commandName} --version 1.7.1 [--dry-run] [--force]`,
    '',
    ...hostVersionUsageLines({ allowKeep: true }),
    '',
    'Release target (host MSI asset):',
    '  --release-owner <owner>   GitHub owner for host MSI releases (default: noelle-silva)',
    '  --release-repo <repo>     GitHub repo for host MSI releases (default: fast-window)',
    '',
    'Catalog target (update metadata):',
    '  --catalog-owner <owner>   GitHub owner for catalog.json (default: noelle-silva)',
    '  --catalog-repo <repo>     GitHub repo for catalog.json (default: fast-window-plugins-download)',
    '  --catalog-branch <branch> catalog branch (default: main)',
    '',
    ...hostPublishTokenUsageLines(),
    '',
    'Publish options:',
    '  --out <dir>       local artifact output dir',
    '  --message <text>  catalog commit message',
    '  --no-build        reuse an existing Tauri MSI for the declared version',
    '  --dry-run         preview without writing versions, building, uploading, or writing catalog',
    '  --force           allow replacing an existing release asset/catalog version',
  ].join('\n')
}

export function parseHostPublishArgs(argv, commandName) {
  const out = { ...defaultHostPublishOptions() }
  const args = scriptArgs(argv)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') {
      console.log(hostPublishUsage(commandName))
      process.exit(0)
    }
    if (arg === '--release-owner' && i + 1 < args.length) out.releaseOwner = String(args[++i] || '').trim() || out.releaseOwner
    else if (arg === '--release-repo' && i + 1 < args.length) out.releaseRepo = String(args[++i] || '').trim() || out.releaseRepo
    else if (arg === '--catalog-owner' && i + 1 < args.length) out.catalogOwner = String(args[++i] || '').trim() || out.catalogOwner
    else if (arg === '--catalog-repo' && i + 1 < args.length) out.catalogRepo = String(args[++i] || '').trim() || out.catalogRepo
    else if (arg === '--catalog-branch' && i + 1 < args.length) out.catalogBranch = String(args[++i] || '').trim() || out.catalogBranch
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

export async function runHostPublishCli(argv, commandName) {
  const result = await publishHostMsiToDownload(parseHostPublishArgs(argv, commandName))
  console.log(JSON.stringify(result, null, 2))
}
