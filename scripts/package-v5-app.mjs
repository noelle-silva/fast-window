import path from 'node:path'
import {
  DEFAULT_V5_APP_PROFILE,
  DEFAULT_V5_APP_OUT_DIR,
  buildV5AppPackage,
  exists,
  getV5AppConfig,
  isSafeId,
  normalizeV5AppProfile,
  readJson,
  rootDir,
  upsertStoreApp,
  writeV5StoreCatalog,
} from './lib/v5-app-packaging.mjs'

const DEFAULT_BASE_URL = 'https://example.com/fast-window-apps'

function parseArgs(argv) {
  const out = {
    appId: '',
    outDir: DEFAULT_V5_APP_OUT_DIR,
    baseUrl: DEFAULT_BASE_URL,
    noBuild: false,
    profile: DEFAULT_V5_APP_PROFILE,
    catalogPath: '',
  }
  const args = argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--app' && i + 1 < args.length) {
      out.appId = String(args[++i] || '').trim()
      continue
    }
    if (arg === '--out' && i + 1 < args.length) {
      out.outDir = path.resolve(rootDir, String(args[++i] || '').trim())
      continue
    }
    if (arg === '--base-url' && i + 1 < args.length) {
      out.baseUrl = String(args[++i] || '').trim().replace(/\/+$/, '')
      continue
    }
    if (arg === '--catalog' && i + 1 < args.length) {
      out.catalogPath = path.resolve(rootDir, String(args[++i] || '').trim())
      continue
    }
    if (arg === '--profile' && i + 1 < args.length) {
      out.profile = normalizeV5AppProfile(args[++i])
      continue
    }
    if (arg === '--no-build') {
      out.noBuild = true
      continue
    }
    throw new Error(`未知参数: ${arg}`)
  }
  if (!out.appId) throw new Error('Usage: node scripts/package-v5-app.mjs --app <id> [--no-build] [--out <dir>] [--base-url <https-url>]')
  if (!isSafeId(out.appId)) throw new Error(`app id 不合法: ${out.appId}`)
  if (out.profile !== DEFAULT_V5_APP_PROFILE) throw new Error('apps:package:v5 只允许 release profile')
  if (!out.baseUrl.startsWith('https://')) throw new Error('--base-url 必须是 https:// URL')
  if (!out.catalogPath) out.catalogPath = path.join(out.outDir, 'catalog.staging.json')
  return out
}

async function loadCatalog(catalogPath) {
  if (!(await exists(catalogPath))) return { catalogVersion: 2, apps: [], plugins: [] }
  const catalog = await readJson(catalogPath)
  if (catalog?.catalogVersion !== 2) throw new Error('catalogVersion 必须为 2')
  if (!Array.isArray(catalog.apps)) throw new Error('catalog.apps 必须是数组')
  if (!Array.isArray(catalog.plugins)) throw new Error('catalog.plugins 必须是数组')
  return catalog
}

async function main() {
  const opts = parseArgs(process.argv)
  const config = await getV5AppConfig(opts.appId)
  const result = await buildV5AppPackage(config, opts)
  const catalog = upsertStoreApp(await loadCatalog(opts.catalogPath), result.catalogEntry)
  await writeV5StoreCatalog(opts.catalogPath, catalog)

  console.log(JSON.stringify({
    appId: result.appId,
    version: result.version,
    zipName: result.zipName,
    zipPath: result.zipPath,
    sha256: result.sha256,
    sizeBytes: result.sizeBytes,
    catalogPath: opts.catalogPath,
    downloadUrl: result.downloadUrl,
  }, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
