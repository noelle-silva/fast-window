import { removeStoreApp } from './fast-window-dev-store-catalog.mjs'
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
import { manifestFacts, readManifest } from './fast-window-dev-store-common.mjs'

// 下架边界：凭据只读中央协议目录；dry-run 只读公开目录做预演，不写远程。
export async function unpublishAppFromStore({ protocolDir, credentialsDir, dryRun = false }) {
  if (String(credentialsDir ?? '').trim() === '') {
    throw new Error('缺少发布凭据目录：下架模式必须由中央工具传入主仓库协议目录路径')
  }
  const manifest = manifestFacts(readManifest(protocolDir))
  await loadProtocolEnv(credentialsDir)

  const options = {
    owner: DEFAULT_DOWNLOAD_OWNER,
    repo: DEFAULT_DOWNLOAD_REPO,
    branch: DEFAULT_DOWNLOAD_BRANCH,
    appId: manifest.id,
    message: 'Remove catalog.json entry',
  }

  const authToken = pickGithubToken()
  if (!dryRun) {
    if (!authToken) {
      throw new Error('缺少发布凭据：请在中央协议目录 .fast-window-dev-protocol/.env 或环境变量中提供 GITHUB_TOKEN')
    }
    await assertWritableToken(options, authToken)
  }

  const remote = await loadRemoteCatalog(options, authToken, dryRun ? 'public' : 'api')
  const { catalog, removed } = removeStoreApp(remote.catalog, manifest.id)

  const catalogUrl = `https://raw.githubusercontent.com/${options.owner}/${options.repo}/${options.branch}/${STORE_CATALOG_FILE}`
  if (dryRun) {
    return {
      appId: manifest.id,
      removed: { id: removed.id, version: removed.version, name: removed.name },
      dryRun: true,
      catalogUrl,
      catalogCommitUrl: '',
    }
  }

  const catalogCommitUrl = await writeRemoteJsonFile(options, STORE_CATALOG_FILE, remote.catalogSha, catalog, authToken)
  return {
    appId: manifest.id,
    removed: { id: removed.id, version: removed.version, name: removed.name },
    dryRun: false,
    catalogUrl,
    catalogCommitUrl,
  }
}
