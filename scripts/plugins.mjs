import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const pluginsDir = path.join(rootDir, 'plugins')

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

function safeResolveWithin(dir, relPath) {
  const abs = path.resolve(dir, relPath)
  const dirAbs = path.resolve(dir) + path.sep
  if (!abs.startsWith(dirAbs)) {
    throw new Error(`Path escapes plugin dir: ${relPath}`)
  }
  return abs
}

async function listPluginIds() {
  if (!(await exists(pluginsDir))) return []
  const entries = await fs.readdir(pluginsDir, { withFileTypes: true })
  return entries.filter(e => e.isDirectory()).map(e => e.name)
}

async function resolvePluginBuildPlan(pluginId) {
  const pluginDir = path.join(pluginsDir, pluginId)
  const manifestPath = path.join(pluginDir, 'manifest.json')
  if (!(await exists(manifestPath))) return null

  const manifest = await readJson(manifestPath)
  const mainOutfile = safeResolveWithin(pluginDir, String(manifest.main || '').trim())
  if (!manifest.main) throw new Error(`[plugin:${pluginId}] manifest.main is required`)

  let pkg = null
  const pkgPath = path.join(pluginDir, 'package.json')
  if (await exists(pkgPath)) pkg = await readJson(pkgPath)

  const cfg = pkg && typeof pkg.fastWindowPlugin === 'object' ? pkg.fastWindowPlugin : {}

  const candidates = [
    path.join(pluginDir, 'src', 'index.ts'),
    path.join(pluginDir, 'src', 'index.tsx'),
    path.join(pluginDir, 'src', 'main.ts'),
    path.join(pluginDir, 'src', 'main.tsx'),
    path.join(pluginDir, 'index.ts'),
    path.join(pluginDir, 'index.tsx'),
  ]

  const uiEntryRel = typeof cfg.entry === 'string' ? cfg.entry.trim() : ''
  const uiEntryAbs = uiEntryRel ? safeResolveWithin(pluginDir, uiEntryRel) : ''
  const uiEntry =
    (uiEntryAbs && (await exists(uiEntryAbs)) ? uiEntryAbs : '') ||
    (await (async () => {
      for (const c of candidates) {
        if (await exists(c)) return c
      }
      return ''
    })())

  if (!uiEntry) {
    return { pluginId, pluginDir, manifest, kind: 'prebuilt' }
  }

  let background = null
  const bgMain = manifest.background && typeof manifest.background === 'object' ? String(manifest.background.main || '').trim() : ''
  if (bgMain && bgMain !== manifest.main) {
    const bgOutfile = safeResolveWithin(pluginDir, bgMain)
    const bgEntryRel = typeof cfg.backgroundEntry === 'string' ? cfg.backgroundEntry.trim() : ''
    const bgEntryAbs = bgEntryRel ? safeResolveWithin(pluginDir, bgEntryRel) : ''
    const bgDefaultCandidates = [
      path.join(pluginDir, 'src', 'background.ts'),
      path.join(pluginDir, 'src', 'background.tsx'),
    ]
    const bgEntry =
      (bgEntryAbs && (await exists(bgEntryAbs)) ? bgEntryAbs : '') ||
      (await (async () => {
        for (const c of bgDefaultCandidates) {
          if (await exists(c)) return c
        }
        return ''
      })()) ||
      uiEntry
    background = { entry: bgEntry, outfile: bgOutfile }
  }

  return {
    pluginId,
    pluginDir,
    manifest,
    kind: 'bundled',
    ui: { entry: uiEntry, outfile: mainOutfile },
    background,
  }
}

function createBuildOptions(opts) {
  const { pluginId, entry, outfile, minify, sourcemap } = opts
  const outBase = path.basename(outfile)
  return {
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2019'],
    outfile,
    minify: Boolean(minify),
    sourcemap: sourcemap ? 'external' : false,
    logLevel: 'silent',
    legalComments: 'none',
    charset: 'utf8',
    footer: {
      js: `\n//# sourceURL=fast-window-plugin:${pluginId}/${outBase}\n`,
    },
  }
}

async function buildOne(plan, mode) {
  if (plan.kind !== 'bundled') {
    console.log(`[plugin] ${plan.pluginId}: skip (prebuilt)`)
    return { contexts: [] }
  }

  const minify = mode === 'build'
  const sourcemap = mode !== 'build'

  const contexts = []

  const uiOpts = createBuildOptions({
    pluginId: plan.pluginId,
    entry: plan.ui.entry,
    outfile: plan.ui.outfile,
    minify,
    sourcemap,
  })
  const uiCtx = await esbuild.context(uiOpts)
  contexts.push(uiCtx)

  let bgCtx = null
  if (plan.background) {
    const bgOpts = createBuildOptions({
      pluginId: plan.pluginId,
      entry: plan.background.entry,
      outfile: plan.background.outfile,
      minify,
      sourcemap,
    })
    bgCtx = await esbuild.context(bgOpts)
    contexts.push(bgCtx)
  }

  if (mode === 'watch') {
    await Promise.all(contexts.map(c => c.rebuild()))
    await Promise.all(contexts.map(c => c.watch()))
    console.log(`[plugin] ${plan.pluginId}: watching`)
  } else {
    await Promise.all(contexts.map(c => c.rebuild()))
    console.log(`[plugin] ${plan.pluginId}: built`)
    await Promise.all(contexts.map(c => c.dispose()))
  }

  return { contexts: mode === 'watch' ? contexts : [] }
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const cmd = args[0] || ''
  let pluginId = ''
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    if (a === '--plugin' && i + 1 < args.length) {
      pluginId = String(args[i + 1] || '').trim()
      i++
    }
  }
  return { cmd, pluginId }
}

async function main() {
  const { cmd, pluginId } = parseArgs(process.argv)
  const mode = cmd === 'watch' ? 'watch' : cmd === 'build' ? 'build' : ''
  if (!mode) {
    console.error('Usage: node scripts/plugins.mjs <build|watch> [--plugin <id>]')
    process.exitCode = 2
    return
  }

  const ids = await listPluginIds()
  const targets = pluginId ? ids.filter(id => id === pluginId) : ids
  if (pluginId && targets.length === 0) {
    console.error(`[plugin] not found: ${pluginId}`)
    process.exitCode = 2
    return
  }

  const plans = []
  for (const id of targets) {
    const plan = await resolvePluginBuildPlan(id).catch(e => {
      console.error(String(e?.message || e))
      return null
    })
    if (plan) plans.push(plan)
  }

  const activeContexts = []
  let hadError = false

  for (const p of plans) {
    try {
      const r = await buildOne(p, mode)
      for (const c of r.contexts) activeContexts.push(c)
    } catch (e) {
      hadError = true
      const msg = e && e.errors ? e.errors.map(x => x.text).join('\n') : String(e?.message || e)
      console.error(`[plugin] ${p.pluginId}: build failed\n${msg}`)
      if (mode !== 'watch') process.exitCode = 1
    }
  }

  if (mode === 'watch') {
    if (activeContexts.length === 0) {
      console.log('[plugin] no watchable plugins (all prebuilt or missing source entry)')
      return
    }
    if (hadError) process.exitCode = 1
    const disposeAll = async () => {
      await Promise.allSettled(activeContexts.map(c => c.dispose()))
    }
    process.on('SIGINT', () => void disposeAll().finally(() => process.exit(0)))
    process.on('SIGTERM', () => void disposeAll().finally(() => process.exit(0)))
    await new Promise(() => {})
  }
}

await main()
