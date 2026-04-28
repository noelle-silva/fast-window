import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const pluginsDir = path.join(rootDir, 'plugins')

function isSafeId(id) {
  const s = String(id || '').trim()
  if (!s) return false
  return /^[A-Za-z0-9_-]+$/.test(s)
}

function normalizeRel(p) {
  return String(p || '').replaceAll('\\', '/').replace(/^\.\//, '').trim()
}

function assertSafeRel(rel, what) {
  const r = normalizeRel(rel)
  if (!r) throw new Error(`Invalid ${what}: empty`)
  if (path.isAbsolute(r)) throw new Error(`Invalid ${what}: must be relative: ${r}`)
  const parts = r.split('/')
  for (const part of parts) {
    if (!part || part === '.' || part === '..') throw new Error(`Invalid ${what}: unsafe path: ${r}`)
  }
  return r
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function sha256FileHex(filePath) {
  return await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fssync.createReadStream(filePath)
    s.on('error', reject)
    s.on('data', chunk => h.update(chunk))
    s.on('end', () => resolve(h.digest('hex')))
  })
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts })
}

function waitExit(p) {
  return new Promise(resolve => p.on('exit', code => resolve(code ?? 0)))
}

function parseSemverStrict(raw) {
  const s = String(raw || '').trim()
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null
  if (major < 0 || minor < 0 || patch < 0) return null
  return { major, minor, patch, raw: s }
}

function assertSemverStrict(raw, what) {
  const v = parseSemverStrict(raw)
  if (!v) throw new Error(`${what} 必须是 x.y.z 格式（SemVer）：${String(raw || '').trim()}`)
  return v
}

function isDataImageUrl(value) {
  return String(value || '').startsWith('data:image/')
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function normalizeIcon(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (isDataImageUrl(s) || isHttpUrl(s)) return s
  if (s.length <= 8) return s
  return ''
}

async function resolveIndexIcon(manifest, pluginDir) {
  const raw = String(manifest?.icon || '').trim()
  if (!raw) return ''
  if (isDataImageUrl(raw) || isHttpUrl(raw)) return raw

  if (raw.startsWith('svg:')) {
    const rel = raw.slice('svg:'.length).trim()
    if (!rel) return ''
    if (!rel.toLowerCase().endsWith('.svg')) return ''
    const safe = assertSafeRel(rel, 'manifest.icon')
    const svg = await fs.readFile(path.join(pluginDir, safe), 'utf8')
    const encoded = encodeURIComponent(svg)
    return `data:image/svg+xml;utf8,${encoded}`
  }

  return normalizeIcon(raw)
}

function collectReferencedFiles(manifest) {
  const out = new Set()
  out.add('manifest.json')

  const main = assertSafeRel(manifest?.main, 'manifest.main')
  out.add(main)

  const bgMain = normalizeRel(manifest?.background?.main)
  if (bgMain && bgMain !== main) out.add(assertSafeRel(bgMain, 'manifest.background.main'))

  const icon = normalizeRel(manifest?.icon)
  if (icon.startsWith('svg:')) {
    const rel = icon.slice('svg:'.length).trim()
    if (rel && rel.toLowerCase().endsWith('.svg')) out.add(assertSafeRel(rel, 'manifest.icon'))
  }

  return Array.from(out)
}

function releaseBackgroundConfig(pkg) {
  const fw = pkg && typeof pkg.fastWindowPlugin === 'object' ? pkg.fastWindowPlugin : null
  const bg = fw && typeof fw.background === 'object' ? fw.background : null
  const release = bg && typeof bg.release === 'object' ? bg.release : null
  if (!release) return null
  const main = typeof release.main === 'string' ? release.main.trim() : ''
  if (!main) return null
  return {
    main: assertSafeRel(main, 'fastWindowPlugin.background.release.main'),
    runtime: typeof release.runtime === 'string' ? release.runtime.trim() : '',
  }
}

function releaseManifest(manifest, pkg) {
  const release = releaseBackgroundConfig(pkg)
  if (!release) return manifest
  const next = structuredClone(manifest)
  const background = next.background && typeof next.background === 'object' && !Array.isArray(next.background) ? { ...next.background } : {}
  background.main = release.main
  if (release.runtime) background.runtime = release.runtime
  next.background = background
  return next
}

function collectPackageFiles(manifest, pluginDir) {
  const out = []
  const ignore = new Set(['src', 'backend-rs', 'backend-go', 'node_modules', '.git', '.cache'])
  const stack = ['']

  while (stack.length) {
    const relDir = stack.pop()
    const absDir = path.join(pluginDir, relDir)
    for (const entry of fssync.readdirSync(absDir, { withFileTypes: true })) {
      const name = entry.name
      if (ignore.has(name)) continue
      const rel = relDir ? normalizeRel(path.join(relDir, name)) : normalizeRel(name)
      if (entry.isDirectory()) {
        stack.push(rel)
        continue
      }
      if (!entry.isFile()) continue
      if (rel === 'package.json') continue
      out.push(rel)
    }
  }

  const mustHave = collectReferencedFiles(manifest)
  for (const rel of mustHave) {
    if (!out.includes(rel)) out.push(rel)
  }
  out.sort()
  return out
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const out = {
    pluginId: '',
    outDir: path.join(rootDir, '.tmp', 'dist-plugin-zips'),
    indexPath: path.join(rootDir, 'plugin-store', 'index.json'),
    downloadUrl: '',
    doBuild: true,
    json: false,
    jsonFile: '',
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--plugin' && i + 1 < args.length) {
      out.pluginId = String(args[i + 1] || '').trim()
      i++
      continue
    }
    if (a === '--out' && i + 1 < args.length) {
      out.outDir = path.resolve(rootDir, String(args[i + 1] || '').trim())
      i++
      continue
    }
    if (a === '--index' && i + 1 < args.length) {
      out.indexPath = path.resolve(rootDir, String(args[i + 1] || '').trim())
      i++
      continue
    }
    if (a === '--download-url' && i + 1 < args.length) {
      out.downloadUrl = String(args[i + 1] || '').trim()
      i++
      continue
    }
    if (a === '--no-build') {
      out.doBuild = false
      continue
    }
    if (a === '--json') {
      out.json = true
      continue
    }
    if (a === '--json-file' && i + 1 < args.length) {
      out.jsonFile = path.resolve(rootDir, String(args[i + 1] || '').trim())
      i++
      continue
    }
  }

  return out
}

async function zipDir(stagingParentDir, pluginId, zipPath) {
  const srcDir = path.join(stagingParentDir, pluginId)

  // Prefer tar (bsdtar/libarchive) which supports "-a" auto format to .zip on Windows/macOS/Linux.
  {
    const p = run('tar', ['-a', '-c', '-f', zipPath, pluginId], { cwd: stagingParentDir })
    const code = await waitExit(p)
    if (code === 0) return
  }

  // Fallback: zip CLI (may not exist on Windows)
  if (process.platform !== 'win32') {
    const zipCmd = 'zip'
    const p = run(zipCmd, ['-r', zipPath, pluginId], { cwd: stagingParentDir })
    const code = await waitExit(p)
    if (code === 0) return
  }

  // Legacy fallback: PowerShell Compress-Archive (may be unavailable in some environments)
  if (process.platform === 'win32') {
    const p = run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'param([string]$src,[string]$dst) Compress-Archive -Path $src -DestinationPath $dst -Force',
      '-src',
      srcDir,
      '-dst',
      zipPath,
    ])
    const code = await waitExit(p)
    if (code === 0) return
  }

  throw new Error('Failed to create zip (需要 tar 或 zip 或 Compress-Archive)')
}

async function updateIndexJson(indexPath, nextPlugin) {
  let index = { registry_version: 1, plugins: [] }
  if (indexPath && (await exists(indexPath))) {
    index = await readJson(indexPath)
  }
  if (!index || typeof index !== 'object' || Array.isArray(index)) throw new Error('index.json 格式不合法')
  if (index.registry_version !== 1) throw new Error('不支持的 registry_version（仅支持 1）')
  if (!Array.isArray(index.plugins)) index.plugins = []

  const plugins = index.plugins.filter(Boolean)
  const rest = plugins.filter(p => String(p?.id || '').trim() !== nextPlugin.id)
  rest.push(nextPlugin)
  rest.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  index.plugins = rest

  await fs.mkdir(path.dirname(indexPath), { recursive: true })
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8')
}

async function main() {
  const opts = parseArgs(process.argv)
  const pluginId = opts.pluginId
  if (!pluginId) {
    console.error('Usage: node scripts/publish-plugin.mjs --plugin <id> [--out <dir>] [--index <path>] [--download-url <url>] [--no-build]')
    process.exitCode = 2
    return
  }
  if (!isSafeId(pluginId)) {
    console.error('Invalid plugin id (only A-Za-z0-9_-):', pluginId)
    process.exitCode = 2
    return
  }

  const pluginDir = path.join(pluginsDir, pluginId)
  const manifestPath = path.join(pluginDir, 'manifest.json')
  if (!(await exists(manifestPath))) {
    console.error('Not found:', manifestPath)
    process.exitCode = 2
    return
  }

  if (opts.doBuild) {
    const code = await waitExit(run(process.execPath, [path.join(rootDir, 'scripts', 'plugins.mjs'), 'build', '--plugin', pluginId]))
    if (code !== 0) process.exit(code)
  }

  const pkgPath = path.join(pluginDir, 'package.json')
  const pkg = await exists(pkgPath) ? await readJson(pkgPath) : null
  const manifest = releaseManifest(await readJson(manifestPath), pkg)
  const files = collectPackageFiles(manifest, pluginDir)

  const name = String(manifest?.name || '').trim() || pluginId
  const version = String(manifest?.version || '').trim()
  const description = typeof manifest?.description === 'string' ? manifest.description : ''
  const requires = Array.isArray(manifest?.requires) ? manifest.requires.map(x => String(x || '').trim()).filter(Boolean) : []
  const icon = await resolveIndexIcon(manifest, pluginDir)

  if (!version) throw new Error('manifest.version is required')
  assertSemverStrict(version, 'manifest.version')

  const outDir = opts.outDir
  await fs.mkdir(outDir, { recursive: true })

  const stamp = Date.now()
  const stagingParent = path.join(outDir, `.tmp-stage-${pluginId}-${stamp}`)
  const stagingPlugin = path.join(stagingParent, pluginId)
  await fs.rm(stagingParent, { recursive: true, force: true })
  await fs.mkdir(stagingPlugin, { recursive: true })

  for (const rel of files) {
    const r = normalizeRel(rel)
    const src = path.join(pluginDir, r)
    const dst = path.join(stagingPlugin, r)
    if (!(await exists(src))) {
      await fs.rm(stagingParent, { recursive: true, force: true })
      throw new Error(`Missing referenced file: ${pluginId}/${r}`)
    }
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.copyFile(src, dst)
  }
  await fs.writeFile(path.join(stagingPlugin, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  const zipName = `${pluginId}-${version}.zip`
  const zipPath = path.join(outDir, zipName)
  await fs.rm(zipPath, { force: true })
  await zipDir(stagingParent, pluginId, zipPath)
  await fs.rm(stagingParent, { recursive: true, force: true })

  const sha256 = await sha256FileHex(zipPath)
  const tag = `v${pluginId}-${version}`
  const download_url =
    opts.downloadUrl ||
    `https://github.com/noelle-silva/fast-window-plugins-download/releases/download/${tag}/${zipName}`

  const entry = {
    id: pluginId,
    name,
    description,
    ...(icon ? { icon } : {}),
    version,
    download_url,
    sha256,
    requires,
  }

  if (opts.indexPath) await updateIndexJson(opts.indexPath, entry)

  const result = {
    pluginId,
    version,
    zipName,
    zipPath,
    sha256,
    tag,
    indexPath: opts.indexPath || '',
    entry,
  }

  if (opts.jsonFile) {
    await fs.mkdir(path.dirname(opts.jsonFile), { recursive: true })
    await fs.writeFile(opts.jsonFile, JSON.stringify(result), 'utf8')
  }

  if (opts.json) {
    console.log(JSON.stringify(result))
    return
  }

  console.log('')
  console.log('[plugin-store] zip:', zipPath)
  console.log('[plugin-store] sha256:', sha256)
  console.log('[plugin-store] tag (suggest):', tag)
  if (opts.indexPath) console.log('[plugin-store] index:', opts.indexPath)
  console.log('')
  console.log('[plugin-store] index.json entry:')
  console.log(JSON.stringify(entry, null, 2))
}

await main().catch(err => {
  console.error(String(err?.message || err))
  process.exitCode = 1
})
