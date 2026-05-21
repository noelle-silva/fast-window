import path from 'node:path'
import {
  DEFAULT_V5_APP_OUT_DIR,
  buildV5AppPackage,
  compareSemverStrict,
  getV5AppConfig,
  loadV5AppVersion,
  parseSemverStrict,
  upsertStoreApp,
  writeV5StoreCatalog,
} from './v5-app-packaging.mjs'
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
} from './v5-download-store.mjs'
import { cleanupUploadedReleaseAsset, ensureReleaseAsset } from './github-release-assets.mjs'

export const DEFAULT_V5_APP_PUBLISH_MESSAGE = 'Update catalog.json'

export function defaultV5AppPublishOptions() {
  return {
    owner: DEFAULT_DOWNLOAD_OWNER,
    repo: DEFAULT_DOWNLOAD_REPO,
    branch: DEFAULT_DOWNLOAD_BRANCH,
    outDir: DEFAULT_V5_APP_OUT_DIR,
    noBuild: false,
    dryRun: false,
    force: false,
    message: DEFAULT_V5_APP_PUBLISH_MESSAGE,
  }
}

function findPublishedApp(catalog, appId) {
  return catalog.apps.find(app => String(app?.id || '').trim() === appId) || null
}

export function assertV5AppPublishVersionPolicy(catalog, appId, version, force) {
  const published = findPublishedApp(catalog, appId)
  if (!published) return
  const publishedVersion = String(published.version || '').trim()
  const cmp = compareSemverStrict(version, publishedVersion)
  if (cmp === 0 && !force) throw new Error(`该 v5 app 版本已发布，严禁覆盖: ${appId}@${version}。如必须覆盖，请显式传入 --force。`)
  if (cmp < 0 && !force) throw new Error(`v5 app 版本号必须递增: ${appId} 云端=${publishedVersion} 本地=${version}。如必须覆盖，请显式传入 --force。`)
}

async function prepareV5AppPublish(rawOpts) {
  await loadDotEnvIfPresent()
  const opts = { ...defaultV5AppPublishOptions(), ...rawOpts }
  const authToken = pickGithubToken()
  if (!opts.dryRun) await assertWritableToken(opts, authToken)
  const config = await getV5AppConfig(opts.appId)
  const version = String(opts.version || '').trim() || await loadV5AppVersion(config)
  if (!parseSemverStrict(version)) throw new Error(`v5 app 发布版本号必须是 x.y.z 格式: ${version}`)
  const tag = `v${opts.appId}-${version}`
  const baseUrl = `https://github.com/${opts.owner}/${opts.repo}/releases/download/${tag}`
  const remote = await loadCatalogOrMigrateIndex(opts, authToken, opts.dryRun ? 'public' : 'api')
  assertV5AppPublishVersionPolicy(remote.catalog, opts.appId, version, opts.force)
  return { opts, authToken, config, version, tag, baseUrl, remote }
}

export async function planV5AppPublishToDownload(rawOpts) {
  const { opts, version, tag, remote } = await prepareV5AppPublish(rawOpts)
  return {
    appId: opts.appId,
    version,
    tag,
    catalogSource: remote.source,
    downloadUrl: `https://github.com/${opts.owner}/${opts.repo}/releases/download/${tag}/${opts.appId}-${version}-windows.zip`,
  }
}

async function ensureReleaseAndUpload(opts, result, authToken) {
  return ensureReleaseAsset(opts, {
    tag: result.tag,
    name: result.tag,
    body: `Automated v5 app release for ${result.appId} ${result.version}`,
    assetName: result.zipName,
    assetPath: result.zipPath,
    contentType: 'application/zip',
  }, authToken)
}

export async function publishV5AppToDownload(rawOpts) {
  const { opts, authToken, config, tag, baseUrl, remote } = await prepareV5AppPublish(rawOpts)

  const result = await buildV5AppPackage(config, { outDir: opts.outDir, baseUrl, noBuild: opts.noBuild })
  result.tag = tag

  const nextCatalog = upsertStoreApp(remote.catalog, result.catalogEntry)
  const catalogPath = path.join(opts.outDir, 'catalog.release.json')
  await writeV5StoreCatalog(catalogPath, nextCatalog)

  if (opts.dryRun) {
    return {
      dryRun: true,
      appId: result.appId,
      version: result.version,
      tag: result.tag,
      zipPath: result.zipPath,
      catalogPath,
      catalogSource: remote.source,
      downloadUrl: result.downloadUrl,
    }
  }

  const release = await ensureReleaseAndUpload(opts, result, authToken)
  let commitUrl = ''
  try {
    commitUrl = await writeRemoteJsonFile(opts, V5_STORE_CATALOG_FILE, remote.catalogSha, nextCatalog, authToken)
  } catch (error) {
    try {
      await cleanupUploadedReleaseAsset(opts, release, authToken)
    } catch (cleanupError) {
      throw new Error(`catalog 写回失败，且远端发布清理失败。写回错误: ${error?.message || error}；清理错误: ${cleanupError?.message || cleanupError}`)
    }
    throw error
  }

  return {
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
  }
}
