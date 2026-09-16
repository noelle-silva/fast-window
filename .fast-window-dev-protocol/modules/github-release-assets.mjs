import fs from 'node:fs/promises'
import { githubJson, githubUpload, repoApiBase } from './v5-download-store.mjs'

export async function listReleaseAssets(opts, releaseId, authToken) {
  const apiBase = repoApiBase(opts)
  const assets = []
  for (let page = 1; page <= 10; page++) {
    const batch = await githubJson('GET', `${apiBase}/releases/${releaseId}/assets?per_page=100&page=${page}`, authToken)
    if (!Array.isArray(batch)) throw new Error('GitHub release assets 响应格式不合法')
    assets.push(...batch)
    if (batch.length < 100) break
  }
  return assets
}

export async function cleanupCreatedRelease(opts, releaseId, tag, authToken) {
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

export async function ensureReleaseAsset(opts, asset, authToken) {
  const apiBase = repoApiBase(opts)
  let release = null
  let createdRelease = false
  try {
    release = await githubJson('GET', `${apiBase}/releases/tags/${encodeURIComponent(asset.tag)}`, authToken)
  } catch (error) {
    if (Number(error?.status || 0) !== 404) throw error
  }
  if (!release) {
    release = await githubJson('POST', `${apiBase}/releases`, authToken, {
      tag_name: asset.tag,
      name: asset.name || asset.tag,
      body: asset.body || `Automated release for ${asset.tag}`,
      draft: false,
      prerelease: false,
    })
    createdRelease = true
  }

  const uploadUrl = String(release.upload_url || '').split('{')[0]
  const releaseId = Number(release.id || 0)
  if (!uploadUrl || !releaseId) throw new Error('GitHub API release 响应缺少 upload_url 或 id')

  const assets = await listReleaseAssets(opts, releaseId, authToken)
  const existed = assets.find(item => String(item?.name || '') === asset.assetName)
  if (existed?.id && !opts.force) throw new Error(`GitHub Release asset 已存在，拒绝覆盖: ${asset.assetName}。如必须覆盖，请显式传入 --force。`)

  let uploaded = null
  try {
    const uploadName = existed?.id ? `${asset.assetName}.tmp-${Date.now()}` : asset.assetName
    uploaded = await githubUpload(`${uploadUrl}?name=${encodeURIComponent(uploadName)}`, authToken, await fs.readFile(asset.assetPath), asset.contentType)
    if (existed?.id) {
      await githubJson('DELETE', `${apiBase}/releases/assets/${existed.id}`, authToken)
      uploaded = await githubJson('PATCH', `${apiBase}/releases/assets/${Number(uploaded?.id || 0)}`, authToken, { name: asset.assetName })
    }
  } catch (error) {
    if (createdRelease) {
      try {
        await cleanupCreatedRelease(opts, releaseId, asset.tag, authToken)
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
    tag: asset.tag,
    createdRelease,
    uploadedAssetId: Number(uploaded?.id || 0),
    releaseUrl: String(release.html_url || '').trim(),
    assetUrl: String(uploaded?.browser_download_url || '').trim(),
  }
}

export async function cleanupUploadedReleaseAsset(opts, release, authToken) {
  const apiBase = repoApiBase(opts)
  if (release.createdRelease && release.releaseId) {
    await cleanupCreatedRelease(opts, release.releaseId, release.tag, authToken)
    return
  }
  if (release.uploadedAssetId) await githubJson('DELETE', `${apiBase}/releases/assets/${release.uploadedAssetId}`, authToken)
}
