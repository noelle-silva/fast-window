import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_DOWNLOAD_BRANCH,
  DEFAULT_DOWNLOAD_OWNER,
  DEFAULT_DOWNLOAD_REPO,
  V5_STORE_CATALOG_FILE,
  loadCatalogOrMigrateIndex,
  loadDotEnvIfPresent,
  writeRemoteJsonFile,
} from './v5-download-store.mjs'
import { compareSemverStrict, parseSemverStrict, rootDir, run, sha256FileHex } from './v5-app-packaging.mjs'
import { cleanupUploadedReleaseAsset, ensureReleaseAsset } from './github-release-assets.mjs'
import { managedHostTauriBuildEnv } from './host-tauri-build-policy.mjs'
import { resolveHostPublishTokens } from './host-publish-tokens.mjs'
import {
  applyHostVersionPlan,
  defaultHostVersionDeclaration,
  publicHostVersionPlan,
  resolveHostVersionPlan,
} from './host-versioning.mjs'

export const DEFAULT_HOST_OUT_DIR = path.join(rootDir, '.tmp', 'dist-host')
export const DEFAULT_HOST_PUBLISH_MESSAGE = 'Update catalog.json'
export const DEFAULT_HOST_RELEASE_OWNER = 'noelle-silva'
export const DEFAULT_HOST_RELEASE_REPO = 'fast-window'
export const HOST_CATALOG_ID = 'fast-window'
export const HOST_CATALOG_NAME = 'Fast Window'

export function defaultHostPublishOptions() {
  return {
    releaseOwner: DEFAULT_HOST_RELEASE_OWNER,
    releaseRepo: DEFAULT_HOST_RELEASE_REPO,
    catalogOwner: DEFAULT_DOWNLOAD_OWNER,
    catalogRepo: DEFAULT_DOWNLOAD_REPO,
    catalogBranch: DEFAULT_DOWNLOAD_BRANCH,
    outDir: DEFAULT_HOST_OUT_DIR,
    noBuild: false,
    dryRun: false,
    force: false,
    message: DEFAULT_HOST_PUBLISH_MESSAGE,
    versionDeclaration: defaultHostVersionDeclaration(),
  }
}

function releaseRepoOptions(opts) {
  return {
    owner: normalizeRepoPart(opts.releaseOwner, 'releaseOwner'),
    repo: normalizeRepoPart(opts.releaseRepo, 'releaseRepo'),
    branch: 'main',
    force: opts.force,
  }
}

function catalogRepoOptions(opts) {
  return {
    owner: normalizeRepoPart(opts.catalogOwner, 'catalogOwner'),
    repo: normalizeRepoPart(opts.catalogRepo, 'catalogRepo'),
    branch: normalizeRepoPart(opts.catalogBranch, 'catalogBranch'),
    message: opts.message,
    appId: 'host',
  }
}

function normalizeRepoPart(value, field) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${field} 不能为空`)
  if (/\s/.test(text)) throw new Error(`${field} 不允许包含空白字符`)
  return text
}

async function listMsiFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') throw new Error(`MSI 输出目录不存在，请先构建宿主: ${dir}`)
    throw error
  })
  return entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.msi')).map(entry => path.join(dir, entry.name))
}

async function findBuiltHostMsi(version) {
  const msiDir = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'msi')
  const files = await listMsiFiles(msiDir)
  const matches = files.filter(file => path.basename(file).includes(version))
  if (matches.length !== 1) {
    const found = files.map(file => path.basename(file)).join(', ') || '(none)'
    throw new Error(`无法唯一定位宿主 MSI ${version}。目录: ${msiDir}；发现: ${found}`)
  }
  return matches[0]
}

async function buildHostMsiArtifact(opts, version) {
  if (!parseSemverStrict(version)) throw new Error(`宿主 MSI 版本号必须是 x.y.z 格式: ${version}`)
  if (!opts.noBuild) await run('pnpm', ['run', 'tauri', 'build', '-b', 'msi'], rootDir, { env: managedHostTauriBuildEnv() })

  const builtMsi = await findBuiltHostMsi(version)
  await fs.mkdir(opts.outDir, { recursive: true })
  const msiName = `${HOST_CATALOG_ID}-${version}-windows-x64.msi`
  const msiPath = path.join(opts.outDir, msiName)
  await fs.copyFile(builtMsi, msiPath)

  const sha256 = await sha256FileHex(msiPath)
  const sizeBytes = (await fs.stat(msiPath)).size
  return { version, msiName, msiPath, sha256, sizeBytes }
}

export async function buildHostMsiPackage(rawOpts = {}) {
  const opts = { ...defaultHostPublishOptions(), ...rawOpts }
  const versionPlan = await resolveHostVersionPlan(opts.versionDeclaration, { allowKeep: true, commandName: 'host:build:msi' })
  if (opts.dryRun) {
    return {
      dryRun: true,
      action: 'host-build-msi',
      versionPlan: publicHostVersionPlan(versionPlan),
      wouldRunTauriBuild: !opts.noBuild,
      outDir: opts.outDir,
      msiName: `${HOST_CATALOG_ID}-${versionPlan.targetVersion}-windows-x64.msi`,
    }
  }

  const appliedVersion = await applyHostVersionPlan(versionPlan, { dryRun: false })
  const artifact = await buildHostMsiArtifact(opts, versionPlan.targetVersion)
  return { ...artifact, action: 'host-build-msi', versionPlan: appliedVersion }
}

function assertHostPublishVersionPolicy(catalog, version, force) {
  const publishedVersion = String(catalog?.host?.version || '').trim()
  if (!publishedVersion) return
  const cmp = compareSemverStrict(version, publishedVersion)
  if (cmp === 0 && !force) throw new Error(`该宿主版本已发布，严禁覆盖: ${version}。如必须覆盖，请显式传入 --force。`)
  if (cmp < 0 && !force) throw new Error(`宿主版本号必须递增: 云端=${publishedVersion} 本地=${version}。如必须覆盖，请显式传入 --force。`)
}

function upsertHostCatalogEntry(catalog, entry) {
  return {
    ...catalog,
    catalogVersion: 2,
    generatedAt: new Date().toISOString(),
    host: entry,
    apps: Array.isArray(catalog.apps) ? catalog.apps : [],
    plugins: Array.isArray(catalog.plugins) ? catalog.plugins : [],
  }
}

async function prepareHostPublish(rawOpts) {
  await loadDotEnvIfPresent()
  const opts = { ...defaultHostPublishOptions(), ...rawOpts }
  const releaseOpts = releaseRepoOptions(opts)
  const catalogOpts = catalogRepoOptions(opts)
  const tokens = await resolveHostPublishTokens({ releaseOpts, catalogOpts, dryRun: opts.dryRun })
  const versionPlan = await resolveHostVersionPlan(opts.versionDeclaration, { allowKeep: true, commandName: 'host:publish' })
  const version = versionPlan.targetVersion
  const tag = `vhost-${version}`
  const baseUrl = `https://github.com/${releaseOpts.owner}/${releaseOpts.repo}/releases/download/${tag}`
  const remote = await loadCatalogOrMigrateIndex(catalogOpts, tokens.catalogToken, opts.dryRun ? 'public' : 'api')
  assertHostPublishVersionPolicy(remote.catalog, version, opts.force)
  return { opts, releaseOpts, catalogOpts, tokens, versionPlan, version, tag, baseUrl, remote }
}

export async function planHostPublish(rawOpts) {
  const { releaseOpts, catalogOpts, versionPlan, version, tag, remote } = await prepareHostPublish(rawOpts)
  return {
    version,
    tag,
    versionPlan: publicHostVersionPlan(versionPlan),
    releaseRepository: `${releaseOpts.owner}/${releaseOpts.repo}`,
    catalogRepository: `${catalogOpts.owner}/${catalogOpts.repo}`,
    catalogBranch: catalogOpts.branch,
    catalogSource: remote.source,
    downloadUrl: `https://github.com/${releaseOpts.owner}/${releaseOpts.repo}/releases/download/${tag}/${HOST_CATALOG_ID}-${version}-windows-x64.msi`,
  }
}

export async function publishHostMsi(rawOpts) {
  const { opts, releaseOpts, catalogOpts, tokens, versionPlan, version, tag, baseUrl, remote } = await prepareHostPublish(rawOpts)
  const downloadUrl = `${baseUrl}/${HOST_CATALOG_ID}-${version}-windows-x64.msi`

  if (opts.dryRun) {
    return {
      dryRun: true,
      action: 'host-publish',
      version,
      tag,
      versionPlan: publicHostVersionPlan(versionPlan),
      releaseRepository: `${releaseOpts.owner}/${releaseOpts.repo}`,
      catalogRepository: `${catalogOpts.owner}/${catalogOpts.repo}`,
      catalogBranch: catalogOpts.branch,
      catalogSource: remote.source,
      downloadUrl,
      wouldRunTauriBuild: !opts.noBuild,
      wouldUploadReleaseAsset: true,
      wouldWriteCatalog: true,
    }
  }

  const appliedVersion = await applyHostVersionPlan(versionPlan, { dryRun: false })
  const artifact = await buildHostMsiArtifact(opts, version)
  const hostEntry = {
    id: HOST_CATALOG_ID,
    name: HOST_CATALOG_NAME,
    version: artifact.version,
    platforms: {
      windows: {
        installerType: 'msi',
        downloadUrl,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      },
    },
  }
  const nextCatalog = upsertHostCatalogEntry(remote.catalog, hostEntry)
  const catalogPath = path.join(opts.outDir, 'catalog.release.json')
  await fs.writeFile(catalogPath, JSON.stringify(nextCatalog, null, 2) + '\n', 'utf8')

  const release = await ensureReleaseAsset({ ...releaseOpts, force: opts.force }, {
    tag,
    name: tag,
    body: `Automated Fast Window host MSI release for ${artifact.version}`,
    assetName: artifact.msiName,
    assetPath: artifact.msiPath,
    contentType: 'application/octet-stream',
  }, tokens.releaseToken)

  let commitUrl = ''
  try {
    commitUrl = await writeRemoteJsonFile(catalogOpts, V5_STORE_CATALOG_FILE, remote.catalogSha, nextCatalog, tokens.catalogToken)
  } catch (error) {
    try {
      await cleanupUploadedReleaseAsset(releaseOpts, release, tokens.releaseToken)
    } catch (cleanupError) {
      throw new Error(`catalog 写回失败，且远端宿主发布清理失败。写回错误: ${error?.message || error}；清理错误: ${cleanupError?.message || cleanupError}`)
    }
    throw error
  }

  return {
    action: 'host-publish',
    version: artifact.version,
    tag,
    versionPlan: appliedVersion,
    releaseRepository: `${releaseOpts.owner}/${releaseOpts.repo}`,
    catalogRepository: `${catalogOpts.owner}/${catalogOpts.repo}`,
    catalogBranch: catalogOpts.branch,
    releaseUrl: release.releaseUrl,
    assetUrl: release.assetUrl,
    msiName: artifact.msiName,
    msiPath: artifact.msiPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    catalogPath,
    catalogUrl: `https://raw.githubusercontent.com/${catalogOpts.owner}/${catalogOpts.repo}/${catalogOpts.branch}/${V5_STORE_CATALOG_FILE}`,
    catalogCommitUrl: commitUrl,
  }
}
