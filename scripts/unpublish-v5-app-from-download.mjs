import process from 'node:process'
import { removeStoreApp } from './lib/v5-app-packaging.mjs'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import { isSafeId } from './lib/v5-app-package-manifest.mjs'
import {
  DEFAULT_DOWNLOAD_BRANCH,
  DEFAULT_DOWNLOAD_OWNER,
  DEFAULT_DOWNLOAD_REPO,
  V5_STORE_CATALOG_FILE,
  assertWritableToken,
  loadCatalogOrMigrateIndex,
  loadDotEnvIfPresent,
  pickGithubToken,
  writeRemoteJsonFile,
} from './lib/v5-download-store.mjs'

function parseArgs(argv) {
  const out = {
    appId: '',
    owner: DEFAULT_DOWNLOAD_OWNER,
    repo: DEFAULT_DOWNLOAD_REPO,
    branch: DEFAULT_DOWNLOAD_BRANCH,
    dryRun: false,
    message: 'Remove app from catalog.json',
  }
  const args = scriptArgs(argv)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--app' && i + 1 < args.length) out.appId = String(args[++i] || '').trim()
    else if (arg === '--owner' && i + 1 < args.length) out.owner = String(args[++i] || '').trim() || DEFAULT_DOWNLOAD_OWNER
    else if (arg === '--repo' && i + 1 < args.length) out.repo = String(args[++i] || '').trim() || DEFAULT_DOWNLOAD_REPO
    else if (arg === '--branch' && i + 1 < args.length) out.branch = String(args[++i] || '').trim() || DEFAULT_DOWNLOAD_BRANCH
    else if (arg === '--message' && i + 1 < args.length) out.message = String(args[++i] || '').trim() || out.message
    else if (arg === '--dry-run') out.dryRun = true
    else throw new Error(`未知参数: ${arg}`)
  }
  if (!out.appId) throw new Error('Usage: node scripts/unpublish-v5-app-from-download.mjs --app <id> [--dry-run]')
  if (!isSafeId(out.appId)) throw new Error(`app id 不合法: ${out.appId}`)
  return out
}

async function main() {
  await loadDotEnvIfPresent()
  const opts = parseArgs(process.argv)
  const authToken = pickGithubToken()
  if (!opts.dryRun) await assertWritableToken(opts, authToken)

  const remote = await loadCatalogOrMigrateIndex(opts, authToken, opts.dryRun ? 'public' : 'api')
  const { catalog: nextCatalog, removed } = removeStoreApp(remote.catalog, opts.appId)

  if (opts.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      appId: opts.appId,
      removedVersion: String(removed.version || '').trim(),
      catalogSource: remote.source,
      remainingApps: nextCatalog.apps.map(app => String(app?.id || '').trim()).filter(Boolean),
    }, null, 2))
    return
  }

  const commitUrl = await writeRemoteJsonFile(opts, V5_STORE_CATALOG_FILE, remote.catalogSha, nextCatalog, authToken)
  console.log(JSON.stringify({
    appId: opts.appId,
    removedVersion: String(removed.version || '').trim(),
    catalogUrl: `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch}/${V5_STORE_CATALOG_FILE}`,
    catalogCommitUrl: commitUrl,
  }, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
