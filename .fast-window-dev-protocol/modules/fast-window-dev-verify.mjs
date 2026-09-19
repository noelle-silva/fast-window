import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { unpackZip } from '../app-template/fast-window-dev-tool.mjs'
import {
  artifactFacts,
  manifestFacts,
  normalizeRelativePath,
  readManifest,
  readVersion,
} from './fast-window-dev-store-common.mjs'

const reservedPackageDataDirName = 'data'

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function assertSameJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} 与源清单不一致：包内=${JSON.stringify(actual)}，源=${JSON.stringify(expected)}`)
  }
}

function comparePackagedManifest(packaged, manifest, version) {
  assertSameJson(packaged?.type, manifest.type, '清单 type')
  assertSameJson(packaged?.id, manifest.id, '清单 id')
  assertSameJson(packaged?.name, manifest.name, '清单 name')
  assertSameJson(packaged?.description, manifest.description, '清单 description')
  assertSameJson(packaged?.displayMode, manifest.displayMode, '清单 displayMode')
  assertSameJson(packaged?.commands, manifest.commands, '清单 commands')
  assertSameJson(packaged?.package?.windowsExecutable, manifest.executable, '清单 windowsExecutable')
  assertSameJson(packaged?.package?.icon, manifest.icon, '清单 icon')
  assertSameJson(String(packaged?.version ?? '').trim(), version, '包内版本')
}

function compareCatalogEntry(catalog, manifest, version, sha256) {
  const apps = Array.isArray(catalog?.apps) ? catalog.apps : []
  const entry = apps.find(app => String(app?.id ?? '').trim() === manifest.id)
  if (!entry) throw new Error(`本地商店目录中没有该应用条目：${manifest.id}`)
  assertSameJson(String(entry.version ?? '').trim(), version, '目录条目版本')
  const windows = entry.platforms?.windows
  assertSameJson(String(windows?.sha256 ?? '').trim().toLowerCase(), sha256, '目录条目 sha256')
  return {
    id: manifest.id,
    version: String(entry.version ?? '').trim(),
    sha256: String(windows?.sha256 ?? '').trim().toLowerCase(),
    downloadUrl: String(windows?.downloadUrl ?? '').trim(),
  }
}

// 校验边界：只读应用协议目录成品与源清单；可选与本地商店目录文件比对，不访问远程。
export async function verifyAppArtifact({ protocolDir, artifactPath, catalogPath }) {
  const root = path.dirname(path.resolve(protocolDir))
  const manifest = manifestFacts(readManifest(protocolDir))
  const version = readVersion(root, manifest.versionSource)

  const explicit = String(artifactPath ?? '').trim()
  const zipPath = explicit !== ''
    ? path.resolve(explicit)
    : path.join(protocolDir, 'dist', `${manifest.id}-${version}-windows.zip`)
  const artifact = await artifactFacts(zipPath)

  const checks = []
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-app-verify-'))
  try {
    unpackZip(artifact.path, tempDir)

    const packagedManifestPath = path.join(tempDir, 'fw-app.json')
    if (!(await pathExists(packagedManifestPath))) {
      throw new Error('商店包缺少 fw-app.json')
    }
    let packaged = null
    try {
      packaged = JSON.parse(await fs.readFile(packagedManifestPath, 'utf8'))
    } catch (error) {
      throw new Error(`解析商店包内 fw-app.json 失败：${error.message}`)
    }
    comparePackagedManifest(packaged, manifest, version)
    checks.push({ name: 'packaged-manifest', ok: true })

    const iconRel = normalizeRelativePath(manifest.icon, 'package.icon')
    if (!(await pathExists(path.join(tempDir, iconRel)))) {
      throw new Error(`商店包缺少图标：${iconRel}`)
    }
    checks.push({ name: 'icon', ok: true, detail: iconRel })

    const executableRel = normalizeRelativePath(manifest.executable, 'package.windowsExecutable')
    if (!(await pathExists(path.join(tempDir, executableRel)))) {
      throw new Error(`商店包缺少入口程序：${executableRel}`)
    }
    checks.push({ name: 'windows-executable', ok: true, detail: executableRel })

    if (await pathExists(path.join(tempDir, reservedPackageDataDirName))) {
      throw new Error(`商店包不允许包含保留数据目录：${reservedPackageDataDirName}`)
    }
    checks.push({ name: 'no-reserved-data-dir', ok: true })

    let catalogResult = null
    const catalogFile = String(catalogPath ?? '').trim()
    if (catalogFile !== '') {
      let catalog = null
      try {
        catalog = JSON.parse(await fs.readFile(path.resolve(catalogFile), 'utf8'))
      } catch (error) {
        throw new Error(`读取本地商店目录失败：${error.message}`)
      }
      catalogResult = compareCatalogEntry(catalog, manifest, version, artifact.sha256)
      checks.push({ name: 'catalog-entry', ok: true, detail: catalogResult.id })
    }

    return {
      appId: manifest.id,
      version,
      artifact: {
        path: artifact.path,
        fileName: artifact.fileName,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      },
      checks,
      catalog: catalogResult,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
