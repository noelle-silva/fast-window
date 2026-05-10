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

export async function buildV5AppPackage(config, opts) {
  const baseUrl = String(opts?.baseUrl || '').trim().replace(/\/+$/, '')
  if (!baseUrl.startsWith('https://')) throw new Error('baseUrl 必须是 https:// URL')

  if (!opts?.noBuild) {
    await run(config.buildCommand.command, config.buildCommand.args, config.appDir)
  }

  const version = await loadV5AppVersion(config)
  const outDir = String(opts?.outDir || DEFAULT_V5_APP_OUT_DIR)
  const stageParent = path.join(outDir, `.tmp-stage-${config.id}-${Date.now()}`)
  const packageRootName = `${config.id}-${version}-windows`
  const packageRoot = path.join(stageParent, packageRootName)
  await fs.rm(stageParent, { recursive: true, force: true })
  await fs.mkdir(packageRoot, { recursive: true })

  try {
    for (const file of config.files) {
      const fromRel = normalizeRel(file.from, 'files.from')
      const toRel = normalizeRel(file.to, 'files.to')
      await copyEntry(path.join(config.appDir, fromRel), path.join(packageRoot, toRel))
    }

    const executable = normalizeRel(config.executable, 'executable')
    if (!(await exists(path.join(packageRoot, executable)))) throw new Error(`windowsExecutable 不存在: ${executable}`)
    const icon = normalizeRel(config.icon, 'icon')
    if (!(await exists(path.join(packageRoot, icon)))) throw new Error(`icon 不存在: ${icon}`)
    const commands = validateCommands(config.commands || [])

    const manifest = {
      id: config.id,
      name: config.name,
      version,
      windowsExecutable: executable,
      icon,
      displayMode: config.displayMode,
      commands,
    }
    await fs.writeFile(path.join(packageRoot, 'fw-app.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

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
      manifest,
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
        commands,
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
