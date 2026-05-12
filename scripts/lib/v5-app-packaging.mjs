import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import {
  compareSemverStrict,
  isSafeId,
  loadV5AppPackageConfig,
  normalizeRel,
  parseSemverStrict,
  readJson,
  rootDir,
} from './v5-app-package-manifest.mjs'

export { compareSemverStrict, isSafeId, normalizeRel, parseSemverStrict, readJson, rootDir }

export const DEFAULT_V5_APP_OUT_DIR = path.join(rootDir, '.tmp', 'dist-v5-apps')
export const DEFAULT_V5_APP_STAGE_DIR = path.join('dist-app', 'v5-windows')

export async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function cmdQuote(value) {
  const raw = String(value)
  if (!raw) return '""'
  if (!/[\s"^&|<>%]/.test(raw)) return raw
  return `"${raw.replaceAll('%', '%%').replace(/["^]/g, match => `^${match}`)}"`
}

function resolveSpawnSpec(command, args) {
  if (process.platform === 'win32' && command === 'pnpm') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', ['pnpm.cmd', ...args].map(cmdQuote).join(' ')],
    }
  }
  return { command, args }
}

export function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const spec = resolveSpawnSpec(command, args)
    const child = spawn(spec.command, spec.args, { cwd, stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('exit', code => {
      if ((code ?? 0) === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed with exit ${code}`))
    })
  })
}

export async function sha256FileHex(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fssync.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function copyEntry(src, dst) {
  const st = await fs.stat(src).catch(error => {
    throw new Error(`缺少打包输入: ${src} (${error.message})`)
  })
  if (st.isDirectory()) {
    await fs.rm(dst, { recursive: true, force: true })
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.cp(src, dst, { recursive: true })
    return
  }
  if (!st.isFile()) throw new Error(`打包输入不是文件或目录: ${src}`)
  await fs.mkdir(path.dirname(dst), { recursive: true })
  await fs.copyFile(src, dst)
}

async function replaceDirAtomic(srcDir, dstDir) {
  const parent = path.dirname(dstDir)
  const base = path.basename(dstDir)
  const stamp = Date.now()
  const backupDir = path.join(parent, `.tmp-backup-${base}-${stamp}`)
  await fs.rm(backupDir, { recursive: true, force: true })

  let backedUp = false
  if (await exists(dstDir)) {
    try {
      await fs.rename(dstDir, backupDir)
      backedUp = true
    } catch (error) {
      throw new Error(`无法替换 v5 app staging 目录，可能应用仍在运行: ${dstDir} (${error.message})`)
    }
  }

  try {
    await fs.rename(srcDir, dstDir)
  } catch (error) {
    if (backedUp) {
      await fs.rename(backupDir, dstDir).catch(() => {})
    }
    throw new Error(`写入 v5 app staging 目录失败: ${dstDir} (${error.message})`)
  }

  if (backedUp) await fs.rm(backupDir, { recursive: true, force: true })
}

async function zipDir(parentDir, dirName, zipPath) {
  await fs.rm(zipPath, { force: true })
  await fs.mkdir(path.dirname(zipPath), { recursive: true })
  await run('tar', ['-a', '-c', '-f', zipPath, dirName], parentDir)
}

export async function getV5AppConfig(appId) {
  return loadV5AppPackageConfig(appId)
}

export async function loadV5AppVersion(config) {
  const source = normalizeRel(config.versionSource, 'versionSource')
  const data = await readJson(path.join(config.appDir, source))
  const version = parseSemverStrict(data.version)
  if (!version) throw new Error(`${source}.version 必须是 x.y.z 格式`)
  return version
}

export function defaultV5AppStageDir(config) {
  return path.join(config.appDir, DEFAULT_V5_APP_STAGE_DIR)
}

function validateCommands(commands) {
  if (!Array.isArray(commands)) throw new Error('commands 必须是数组')
  const seen = new Set()
  return commands.map(command => {
    const id = String(command?.id || '').trim()
    const title = String(command?.title || '').trim()
    if (!isSafeId(id)) throw new Error(`command id 不合法: ${id}`)
    if (!title || title.length > 80) throw new Error(`command title 不合法: ${id}`)
    if (seen.has(id)) throw new Error(`command id 重复: ${id}`)
    seen.add(id)
    return { id, title }
  })
}

function buildRuntimeManifest(config, version) {
  return {
    id: config.id,
    name: config.name,
    version,
    windowsExecutable: normalizeRel(config.executable, 'executable'),
    icon: normalizeRel(config.icon, 'icon'),
    displayMode: config.displayMode,
    commands: validateCommands(config.commands || []),
  }
}

async function validateStagedV5App(packageRoot, manifest) {
  const executable = normalizeRel(manifest.windowsExecutable, 'fw-app.windowsExecutable')
  const icon = normalizeRel(manifest.icon, 'fw-app.icon')
  if (!(await exists(path.join(packageRoot, executable)))) throw new Error(`windowsExecutable 不存在: ${executable}`)
  if (!(await exists(path.join(packageRoot, icon)))) throw new Error(`icon 不存在: ${icon}`)
  if (!(await exists(path.join(packageRoot, 'fw-app.json')))) throw new Error('staging 目录缺少 fw-app.json')
}

async function writeRuntimeManifest(packageRoot, manifest) {
  await fs.writeFile(path.join(packageRoot, 'fw-app.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

async function populateV5AppStageDir(config, packageRoot, version) {
  await fs.mkdir(packageRoot, { recursive: true })

  for (const file of config.files) {
    const fromRel = normalizeRel(file.from, 'files.from')
    const toRel = normalizeRel(file.to, 'files.to')
    await copyEntry(path.join(config.appDir, fromRel), path.join(packageRoot, toRel))
  }

  const manifest = buildRuntimeManifest(config, version)
  await writeRuntimeManifest(packageRoot, manifest)
  await validateStagedV5App(packageRoot, manifest)
  return manifest
}

export async function stageV5AppPackage(config, opts = {}) {
  if (!opts.noBuild) {
    await run(config.buildCommand.command, config.buildCommand.args, config.appDir)
  }

  const version = await loadV5AppVersion(config)
  const stageDir = path.resolve(config.appDir, String(opts.stageDir || defaultV5AppStageDir(config)))
  const parent = path.dirname(stageDir)
  const base = path.basename(stageDir)
  const tmpDir = path.join(parent, `.tmp-stage-${base}-${Date.now()}`)
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.mkdir(tmpDir, { recursive: true })

  try {
    const manifest = await populateV5AppStageDir(config, tmpDir, version)
    await fs.mkdir(parent, { recursive: true })
    await replaceDirAtomic(tmpDir, stageDir)
    return {
      appId: config.id,
      version,
      stageDir,
      executablePath: path.join(stageDir, manifest.windowsExecutable),
      manifestPath: path.join(stageDir, 'fw-app.json'),
      manifest,
    }
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

function findExecutableFileMapping(config) {
  const executable = normalizeRel(config.executable, 'executable')
  const match = config.files.find(file => normalizeRel(file.to, 'files.to') === executable)
  if (!match) throw new Error(`package.files 必须包含 windowsExecutable 的来源映射: ${executable}`)
  return {
    from: normalizeRel(match.from, 'files.from'),
    to: executable,
  }
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function syncV5AppExecutable(config, opts = {}) {
  if (!opts.noBuild) {
    await run(config.buildCommand.command, config.buildCommand.args, config.appDir)
  }

  const version = await loadV5AppVersion(config)
  const stageDir = path.resolve(config.appDir, String(opts.stageDir || defaultV5AppStageDir(config)))
  if (!(await exists(stageDir))) throw new Error(`v5 app staging 目录不存在，请先运行 build:app: ${stageDir}`)

  const expectedManifest = buildRuntimeManifest(config, version)
  const manifestPath = path.join(stageDir, 'fw-app.json')
  const currentManifest = await readJson(manifestPath).catch(error => {
    throw new Error(`读取 staging fw-app.json 失败，请先运行 build:app: ${error.message}`)
  })
  if (!sameJson(currentManifest, expectedManifest)) {
    throw new Error('staging fw-app.json 与当前发布声明不一致，请先运行 build:app 完整刷新应用目录')
  }

  const executable = findExecutableFileMapping(config)
  const src = path.join(config.appDir, executable.from)
  const dst = path.join(stageDir, executable.to)
  if (!(await exists(src))) throw new Error(`windowsExecutable 构建产物不存在: ${executable.from}`)

  const tmp = path.join(path.dirname(dst), `.tmp-${path.basename(dst)}-${Date.now()}`)
  await fs.copyFile(src, tmp)
  try {
    await fs.rename(tmp, dst)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw new Error(`替换 staging 入口 exe 失败，可能应用仍在运行: ${dst} (${error.message})`)
  }

  await validateStagedV5App(stageDir, expectedManifest)
  return {
    appId: config.id,
    version,
    stageDir,
    executablePath: dst,
    manifestPath,
  }
}

export async function buildV5AppPackage(config, opts) {
  const baseUrl = String(opts?.baseUrl || '').trim().replace(/\/+$/, '')
  if (!baseUrl.startsWith('https://')) throw new Error('baseUrl 必须是 https:// URL')

  const staged = await stageV5AppPackage(config, {
    noBuild: opts?.noBuild,
    stageDir: opts?.stageDir,
  })
  const { version } = staged
  const outDir = String(opts?.outDir || DEFAULT_V5_APP_OUT_DIR)
  const stageParent = path.join(outDir, `.tmp-stage-${config.id}-${Date.now()}`)
  const packageRootName = `${config.id}-${version}-windows`
  const packageRoot = path.join(stageParent, packageRootName)
  await fs.rm(stageParent, { recursive: true, force: true })
  await fs.mkdir(stageParent, { recursive: true })

  try {
    await copyEntry(staged.stageDir, packageRoot)

    const zipName = `${config.id}-${version}-windows.zip`
    const zipPath = path.join(outDir, zipName)
    await zipDir(stageParent, packageRootName, zipPath)

    const sha256 = await sha256FileHex(zipPath)
    const downloadUrl = `${baseUrl}/${zipName}`
    const sizeBytes = (await fs.stat(zipPath)).size

    return {
      appId: config.id,
      version,
      zipName,
      zipPath,
      sha256,
      sizeBytes,
      downloadUrl,
      stageDir: staged.stageDir,
      manifest: staged.manifest,
      catalogEntry: {
        id: config.id,
        name: config.name,
        description: config.description,
        version,
        icon: config.catalogIcon,
        platforms: {
          windows: { downloadUrl, sha256, sizeBytes },
        },
        displayMode: config.displayMode,
        commands: staged.manifest.commands,
      },
    }
  } finally {
    await fs.rm(stageParent, { recursive: true, force: true })
  }
}

export async function writeV5StoreCatalog(catalogPath, catalog) {
  if (catalog?.catalogVersion !== 2) throw new Error('catalogVersion 必须为 2')
  if (!Array.isArray(catalog.apps)) throw new Error('catalog.apps 必须是数组')
  if (!Array.isArray(catalog.plugins)) throw new Error('catalog.plugins 必须是数组')
  await writeJson(catalogPath, catalog)
}

export function upsertStoreApp(catalog, appEntry, generatedAt = new Date().toISOString()) {
  if (catalog?.catalogVersion !== 2) throw new Error('catalogVersion 必须为 2')
  if (!Array.isArray(catalog.apps)) throw new Error('catalog.apps 必须是数组')
  if (!Array.isArray(catalog.plugins)) throw new Error('catalog.plugins 必须是数组')
  const apps = catalog.apps.filter(app => String(app?.id || '').trim() !== appEntry.id)
  apps.push(appEntry)
  apps.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  const plugins = [...catalog.plugins].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  return { catalogVersion: 2, generatedAt, apps, plugins }
}
