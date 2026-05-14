import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import {
  DEFAULT_V5_APP_OUT_DIR,
  buildV5AppPackage,
  compareSemverStrict,
  getV5AppConfig,
  isSafeId,
  loadV5AppVersion,
  rootDir,
  upsertStoreApp,
  writeV5StoreCatalog,
} from './lib/v5-app-packaging.mjs'
import {
  DEFAULT_DOWNLOAD_BRANCH,
  DEFAULT_DOWNLOAD_OWNER,
  DEFAULT_DOWNLOAD_REPO,
  V5_STORE_CATALOG_FILE,
  assertWritableToken,
  githubJson,
  githubUpload,
  loadCatalogOrMigrateIndex,
  loadDotEnvIfPresent,
  pickGithubToken,
  repoApiBase,
  writeRemoteJsonFile,
} from './lib/v5-download-store.mjs'

function parseArgs(argv) {
  const out = {
    appId: '',
    owner: DEFAULT_DOWNLOAD_OWNER,
    repo: DEFAULT_DOWNLOAD_REPO,
    branch: DEFAULT_DOWNLOAD_BRANCH,
    outDir: DEFAULT_V5_APP_OUT_DIR,
    noBuild: false,
    dryRun: false,
    force: false,
    message: 'Update catalog.json',
  }
  const args = scriptArgs(argv)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--app' && i + 1 < args.length) out.appId = String(args[++i] || '').trim()
    else if (arg === '--owner' && i + 1 < args.length) out.owner = String(args[++i] || '').trim() || DEFAULT_DOWNLOAD_OWNER
    else if (arg === '--repo' && i + 1 < args.length) out.repo = String(args[++i] || '').trim() || DEFAULT_DOWNLOAD_REPO
    else if (arg === '--branch' && i + 1 < args.length) out.branch = String(args[++i] || '').trim() || DEFAULT_DOWNLOAD_BRANCH
    else if (arg === '--out' && i + 1 < args.length) out.outDir = path.resolve(rootDir, String(args[++i] || '').trim())
    else if (arg === '--message' && i + 1 < args.length) out.message = String(args[++i] || '').trim() || out.message
    else if (arg === '--no-build') out.noBuild = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--force') out.force = true
  }
  if (!out.appId) throw new Error('Usage: node scripts/publish-v5-app-to-download.mjs --app <id> [--dry-run] [--no-build] [--force]')
  if (!isSafeId(out.appId)) throw new Error(`app id 不合法: ${out.appId}`)
  return out
}

function findPublishedApp(catalog, appId) {
  return catalog.apps.find(app => String(app?.id || '').trim() === appId) || null
}

function assertVersionPolicy(catalog, appId, version, force) {
  const published = findPublishedApp(catalog, appId)
  if (!published) return
  const publishedVersion = String(published.version || '').trim()
  const cmp = compareSemverStrict(version, publishedVersion)
  if (cmp === 0 && !force) throw new Error(`该 v5 app 版本已发布，严禁覆盖: ${appId}@${version}。如必须覆盖，请显式传入 --force。`)
  if (cmp < 0 && !force) throw new Error(`v5 app 版本号必须递增: ${appId} 云端=${publishedVersion} 本地=${version}。如必须覆盖，请显式传入 --force。`)
}

async function listReleaseAssets(apiBase, releaseId, authToken) {
  const assets = []
  for (let page = 1; page <= 10; page++) {
    const batch = await githubJson('GET', `${apiBase}/releases/${releaseId}/assets?per_page=100&page=${page}`, authToken)
    if (!Array.isArray(batch)) throw new Error('GitHub release assets 响应格式不合法')
    assets.push(...batch)
    if (batch.length < 100) break
  }
  return assets
}

async function ensureReleaseAndUpload(opts, result, authToken) {
  const apiBase = repoApiBase(opts)
  let release = null
  try {
    release = await githubJson('GET', `${apiBase}/releases/tags/${encodeURIComponent(result.tag)}`, authToken)
  } catch (error) {
    if (Number(error?.status || 0) !== 404) throw error
  }
  if (!release) {
    release = await githubJson('POST', `${apiBase}/releases`, authToken, {
      tag_name: result.tag,
      name: result.tag,
      body: `Automated v5 app release for ${result.appId} ${result.version}`,
      draft: false,
      prerelease: false,
    })
  }

  const uploadUrl = String(release.upload_url || '').split('{')[0]
  const releaseId = Number(release.id || 0)
  if (!uploadUrl || !releaseId) throw new Error('GitHub API release 响应缺少 upload_url 或 id')
  const assets = await listReleaseAssets(apiBase, releaseId, authToken)
  const existed = assets.find(asset => String(asset?.name || '') === result.zipName)
  if (existed?.id) await githubJson('DELETE', `${apiBase}/releases/assets/${existed.id}`, authToken)
  const uploaded = await githubUpload(`${uploadUrl}?name=${encodeURIComponent(result.zipName)}`, authToken, await fs.readFile(result.zipPath), 'application/zip')
  return {
    releaseUrl: String(release.html_url || '').trim(),
    assetUrl: String(uploaded?.browser_download_url || '').trim(),
  }
}

async function main() {
  await loadDotEnvIfPresent()
  const opts = parseArgs(process.argv)
  const authToken = pickGithubToken()
  if (!opts.dryRun) await assertWritableToken(opts, authToken)
  const config = await getV5AppConfig(opts.appId)
  const version = await loadV5AppVersion(config)
  const tag = `v${opts.appId}-${version}`
  const baseUrl = `https://github.com/${opts.owner}/${opts.repo}/releases/download/${tag}`
  const remote = await loadCatalogOrMigrateIndex(opts, authToken, opts.dryRun ? 'public' : 'api')
  assertVersionPolicy(remote.catalog, opts.appId, version, opts.force)

  const result = await buildV5AppPackage(config, { outDir: opts.outDir, baseUrl, noBuild: opts.noBuild })
  result.tag = tag

  const nextCatalog = upsertStoreApp(remote.catalog, result.catalogEntry)
  const catalogPath = path.join(opts.outDir, 'catalog.release.json')
  await writeV5StoreCatalog(catalogPath, nextCatalog)

  if (opts.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      appId: result.appId,
      version: result.version,
      tag: result.tag,
      zipPath: result.zipPath,
      catalogPath,
      catalogSource: remote.source,
      downloadUrl: result.downloadUrl,
    }, null, 2))
    return
  }

  const release = await ensureReleaseAndUpload(opts, result, authToken)
  const commitUrl = await writeRemoteJsonFile(opts, V5_STORE_CATALOG_FILE, remote.catalogSha, nextCatalog, authToken)

  console.log(JSON.stringify({
    appId: result.appId,
    version: result.version,
    tag: result.tag,
    releaseUrl: release.releaseUrl,
    assetUrl: release.assetUrl,
    zipName: result.zipName,
    zipPath: result.zipPath,
    sha256: result.sha256,
    sizeBytes: result.sizeBytes,
    catalogPath,
    catalogUrl: `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch}/${V5_STORE_CATALOG_FILE}`,
    catalogCommitUrl: commitUrl,
  }, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
