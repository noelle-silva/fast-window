import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const TAURI_ICON_FILES = [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.icns',
  'icons/icon.ico',
  'icons/icon.png',
]

const TAURI_ICON_FILE_NAMES = new Set(TAURI_ICON_FILES.map(file => path.basename(file)))

function usage() {
  return [
    'Usage:',
    '  node scripts/generate-v5-app-icons.mjs <source-icon.svg> <app-dir>',
    '',
    'Example:',
    '  node scripts/generate-v5-app-icons.mjs plugins/bookmarks/assets/icon.svg apps/bookmarks',
  ].join('\n')
}

function resolveFromRoot(input) {
  return path.resolve(repoRoot, input)
}

async function assertSvg(sourceSvg) {
  const stat = await fs.stat(sourceSvg).catch(() => null)
  if (!stat?.isFile()) throw new Error(`SVG 文件不存在: ${sourceSvg}`)
  if (path.extname(sourceSvg).toLowerCase() !== '.svg') throw new Error('源图标必须是 .svg 文件')
}

async function assertAppDir(appDir) {
  const stat = await fs.stat(appDir).catch(() => null)
  if (!stat?.isDirectory()) throw new Error(`App 目录不存在: ${appDir}`)
  const tauriDir = path.join(appDir, 'src-tauri')
  const tauriStat = await fs.stat(tauriDir).catch(() => null)
  if (!tauriStat?.isDirectory()) throw new Error(`缺少 src-tauri 目录: ${tauriDir}`)
  return tauriDir
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
    })
  })
}

async function copySvg(sourceSvg, appDir) {
  const assetsDir = path.join(appDir, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })
  const targetSvg = path.join(assetsDir, 'icon.svg')
  await fs.copyFile(sourceSvg, targetSvg)
  return targetSvg
}

async function generateTauriIcons(targetSvg, tauriDir) {
  const iconsDir = path.join(tauriDir, 'icons')
  await fs.rm(iconsDir, { recursive: true, force: true })
  await fs.mkdir(iconsDir, { recursive: true })
  await run('pnpm', ['exec', 'tauri', 'icon', targetSvg, '--output', iconsDir], { cwd: repoRoot })
  await pruneIconOutputs(iconsDir)
}

async function pruneIconOutputs(iconsDir) {
  const entries = await fs.readdir(iconsDir, { withFileTypes: true })
  await Promise.all(entries.map(entry => {
    if (entry.isFile() && TAURI_ICON_FILE_NAMES.has(entry.name)) return Promise.resolve()
    return fs.rm(path.join(iconsDir, entry.name), { recursive: true, force: true })
  }))
}

async function updateTauriConfig(tauriDir) {
  const configPath = path.join(tauriDir, 'tauri.conf.json')
  const raw = await fs.readFile(configPath, 'utf8')
  const config = JSON.parse(raw)
  config.bundle = config.bundle && typeof config.bundle === 'object' ? config.bundle : {}
  config.bundle.icon = TAURI_ICON_FILES
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

async function verifyOutputs(tauriDir) {
  const missing = []
  for (const rel of TAURI_ICON_FILES) {
    const full = path.join(tauriDir, rel)
    const stat = await fs.stat(full).catch(() => null)
    if (!stat?.isFile()) missing.push(rel)
  }
  if (missing.length) throw new Error(`图标生成不完整，缺少: ${missing.join(', ')}`)
}

async function main() {
  const [, , sourceArg, appArg] = process.argv
  if (!sourceArg || !appArg) throw new Error(usage())

  const sourceSvg = resolveFromRoot(sourceArg)
  const appDir = resolveFromRoot(appArg)
  await assertSvg(sourceSvg)
  const tauriDir = await assertAppDir(appDir)

  const targetSvg = await copySvg(sourceSvg, appDir)
  await generateTauriIcons(targetSvg, tauriDir)
  await updateTauriConfig(tauriDir)
  await verifyOutputs(tauriDir)

  console.log(`v5 App icons generated: ${path.relative(repoRoot, appDir)}`)
}

main().catch(error => {
  console.error(String(error?.message || error))
  process.exit(1)
})
