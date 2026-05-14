import fs from 'node:fs/promises'
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
  githubJson,
  githubUpload,
  loadCatalogOrMigrateIndex,
  loadDotEnvIfPresent,
  pickGithubToken,
  repoApiBase,
  writeRemoteJsonFile,
} from './v5-download-store.mjs'

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

async function cleanupCreatedRelease(opts, releaseId, tag, authToken) {
  const apiBase = repoApiBase(opts)
  const errors = []
  try {
    await githubJson('DELETE', `${apiBase}/releases/${releaseId}`, authToken)
  } catch (error) {
    errors.push(`Release 删除失败: ${error?.message || error}`)
  }
  try {
    await githubJson('DELETE', `${apiBase}/git/refs/tags/${encodeURIComponent(tag)}`, authToken)
  } catch (error) {
    if (Number(error?.status || 0) !== 404) errors.push(`tag 删除失败: ${error?.message || error}`)
  }
  if (errors.length) throw new Error(errors.join('；'))
}

async function ensureReleaseAndUpload(opts, result, authToken) {
  const apiBase = repoApiBase(opts)
  let release = null
  let createdRelease = false
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
    createdRelease = true
  }

  const uploadUrl = String(release.upload_url || '').split('{')[0]
  const releaseId = Number(release.id || 0)
  if (!uploadUrl || !releaseId) throw new Error('GitHub API release 响应缺少 upload_url 或 id')
  const assets = await listReleaseAssets(apiBase, releaseId, authToken)
  const existed = assets.find(asset => String(asset?.name || '') === result.zipName)
  if (existed?.id && !opts.force) throw new Error(`GitHub Release asset 已存在，拒绝覆盖: ${result.zipName}。如必须覆盖，请显式传入 --force。`)
  let uploaded = null
  try {
    const uploadName = existed?.id ? `${result.zipName}.tmp-${Date.now()}` : result.zipName
    uploaded = await githubUpload(`${uploadUrl}?name=${encodeURIComponent(uploadName)}`, authToken, await fs.readFile(result.zipPath), 'application/zip')
    if (existed?.id) {
      await githubJson('DELETE', `${apiBase}/releases/assets/${existed.id}`, authToken)
      uploaded = await githubJson('PATCH', `${apiBase}/releases/assets/${Number(uploaded?.id || 0)}`, authToken, { name: result.zipName })
    }
  } catch (error) {
    if (createdRelease) {
      try {
        await cleanupCreatedRelease(opts, releaseId, result.tag, authToken)
      } catch (cleanupError) {
        throw new Error(`GitHub Release asset 上传流程失败，且新建 Release 清理失败。上传流程错误: ${error?.message || error}；清理错误: ${cleanupError?.message || cleanupError}`)
      }
      throw error
    }
    if (uploaded?.id) {
      try {
        await githubJson('DELETE', `${apiBase}/releases/assets/${Number(uploaded.id)}`, authToken)
      } catch (cleanupError) {
        throw new Error(`GitHub Release asset 上传流程失败，且临时 asset 清理失败。上传流程错误: ${error?.message || error}；清理错误: ${cleanupError?.message || cleanupError}`)
      }
    }
    throw error
  }
  return {
    releaseId,
    tag: result.tag,
    createdRelease,
    uploadedAssetId: Number(uploaded?.id || 0),
    releaseUrl: String(release.html_url || '').trim(),
    assetUrl: String(uploaded?.browser_download_url || '').trim(),
  }
}

async function cleanupFailedUpload(opts, release, authToken) {
  const apiBase = repoApiBase(opts)
  if (release.createdRelease && release.releaseId) {
    await cleanupCreatedRelease(opts, release.releaseId, release.tag, authToken)
    return
  }
  if (release.uploadedAssetId) await githubJson('DELETE', `${apiBase}/releases/assets/${release.uploadedAssetId}`, authToken)
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
      await cleanupFailedUpload(opts, release, authToken)
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
