import path from 'node:path'

import { cleanupUploadedReleaseAsset, ensureReleaseAsset } from './github-release-assets.mjs'
import { assertAppPublishVersionPolicy, upsertStoreApp } from './fast-window-dev-store-catalog.mjs'
import {
  DEFAULT_DOWNLOAD_BRANCH,
  DEFAULT_DOWNLOAD_OWNER,
  DEFAULT_DOWNLOAD_REPO,
  STORE_CATALOG_FILE,
  assertWritableToken,
  loadRemoteCatalog,
  loadProtocolEnv,
  pickGithubToken,
  writeRemoteJsonFile,
} from './fast-window-dev-store-remote.mjs'
import {
  artifactFacts,
  buildCatalogIcon,
  manifestFacts,
  readManifest,
  readVersion,
} from './fast-window-dev-store-common.mjs'

// 发布边界：manifest 读应用协议目录，凭据只读中央协议目录，应用侧不持有发布凭据。
export async function publishArtifactToStore({ protocolDir, credentialsDir, artifactPath }) {
  if (String(credentialsDir ?? '').trim() === '') {
    throw new Error('缺少发布凭据目录：发布模式必须由中央工具传入主仓库协议目录路径')
  }
  const root = path.dirname(path.resolve(protocolDir))
  const artifact = await artifactFacts(artifactPath)
  const manifest = manifestFacts(readManifest(protocolDir))
  const version = readVersion(root, manifest.versionSource)
  const icon = buildCatalogIcon(root, manifest.icon)
  await loadProtocolEnv(credentialsDir)

  const options = {
    owner: DEFAULT_DOWNLOAD_OWNER,
    repo: DEFAULT_DOWNLOAD_REPO,
    branch: DEFAULT_DOWNLOAD_BRANCH,
    appId: manifest.id,
    message: 'Update catalog.json',
  }
  const authToken = pickGithubToken()
  if (!authToken) {
    throw new Error('缺少发布凭据：请在中央协议目录 .fast-window-dev-protocol/.env 或环境变量中提供 GITHUB_TOKEN')
  }
  await assertWritableToken(options, authToken)
  const remote = await loadRemoteCatalog(options, authToken, 'api')
  assertAppPublishVersionPolicy(remote.catalog, manifest.id, version)

  const tag = `v${manifest.id}-${version}`
  const downloadUrl = `https://github.com/${options.owner}/${options.repo}/releases/download/${tag}/${artifact.fileName}`
  const catalogEntry = {
    type: manifest.type,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version,
    icon,
    platforms: {
      windows: { downloadUrl, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
    },
    commands: manifest.commands,
  }

  const release = await ensureReleaseAsset(options, {
    tag,
    name: tag,
    body: `Automated release for ${manifest.id} ${version}`,
    assetName: artifact.fileName,
    assetPath: artifact.path,
    contentType: 'application/zip',
  }, authToken)

  let catalogCommitUrl = ''
  try {
    const nextCatalog = upsertStoreApp(remote.catalog, catalogEntry)
    catalogCommitUrl = await writeRemoteJsonFile(options, STORE_CATALOG_FILE, remote.catalogSha, nextCatalog, authToken)
  } catch (error) {
    try {
      await cleanupUploadedReleaseAsset(options, release, authToken)
    } catch (cleanupError) {
      throw new Error(`商店目录更新失败，且远端清理失败。写回错误：${error?.message || error}；清理错误：${cleanupError?.message || cleanupError}`)
    }
    throw error
  }

  return {
    appId: manifest.id,
    version,
    tag,
    fileName: artifact.fileName,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    releaseUrl: release.releaseUrl,
    assetUrl: release.assetUrl,
    catalogUrl: `https://raw.githubusercontent.com/${options.owner}/${options.repo}/${options.branch}/${STORE_CATALOG_FILE}`,
    catalogCommitUrl,
  }
}
