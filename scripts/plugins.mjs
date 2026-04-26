import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import * as esbuild from 'esbuild'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const pluginsDir = path.join(rootDir, 'plugins')
const rootLockPath = path.join(rootDir, 'pnpm-lock.yaml')
const require = createRequire(import.meta.url)

function rawTextQueryPlugin() {
  return {
    name: 'raw-text-query',
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, (args) => {
        const spec = String(args.path || '').replace(/\?raw$/, '')
        let resolved = ''
        try {
          resolved = require.resolve(spec, { paths: [args.resolveDir || process.cwd()] })
        } catch {
          resolved = path.resolve(args.resolveDir || process.cwd(), spec)
        }
        return { path: resolved, namespace: 'raw-text' }
      })

      build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => {
        const contents = await fs.readFile(args.path, 'utf8')
        return { contents: `export default ${JSON.stringify(contents)};`, loader: 'js' }
      })
    },
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function pluginPrefix() {
  const d = new Date()
  const t = `${pad2(d.getHours())}h-${pad2(d.getMinutes())}m-${pad2(d.getSeconds())}s`
  return `[plugin] [${t}]`
}

function pluginInfo(msg) {
  console.log(`${pluginPrefix()}${msg}`)
}

function pluginError(msg) {
  console.error(`${pluginPrefix()}${msg}`)
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

async function statMtimeMs(p) {
  try {
    const st = await fs.stat(p)
    return typeof st.mtimeMs === 'number' ? st.mtimeMs : st.mtime.getTime()
  } catch {
    return 0
  }
}

async function maxMtimeMsInDir(dir, ignoreNames) {
  let max = 0
  const stack = [dir]

  while (stack.length) {
    const cur = stack.pop()
    let entries = []
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }

    for (const e of entries) {
      const name = e.name
      if (ignoreNames.has(name)) continue
      const full = path.join(cur, name)
      if (e.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!e.isFile()) continue
      const t = await statMtimeMs(full)
      if (t > max) max = t
    }
  }

  return max
}

function normalizeRel(p) {
  return String(p || '').replaceAll('\\', '/')
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
  const { pluginId, pluginDir, entry, outfile, minify, sourcemap, runtime } = opts
  const outBase = path.basename(outfile)
  const isNodeRuntime = runtime === 'node'
  return {
    entryPoints: [entry],
    bundle: true,
    format: isNodeRuntime ? 'cjs' : 'iife',
    platform: isNodeRuntime ? 'node' : 'browser',
    target: ['es2019'],
    outfile,
    minify: Boolean(minify),
    sourcemap: sourcemap ? 'external' : false,
    metafile: true,
    absWorkingDir: pluginDir,
    plugins: [rawTextQueryPlugin()],
    loader: {
      '.css': 'text',
      '.txt': 'text',
      // 用于 iframe srcDoc 场景：需要把字体/二进制资源内联成 data URL（例如 KaTeX fonts）。
      '.woff2': 'dataurl',
      '.woff': 'dataurl',
      '.ttf': 'dataurl',
    },
    logLevel: 'silent',
    legalComments: 'none',
    charset: 'utf8',
    footer: {
      js: isNodeRuntime ? '' : `\n//# sourceURL=fast-window-plugin:${pluginId}/${outBase}\n`,
    },
  }
}

function getWatchRoots(plan) {
  if (plan.kind !== 'bundled') return []
  const roots = new Set()

  const srcDir = path.join(plan.pluginDir, 'src')
  try {
    if (fssync.existsSync(srcDir) && fssync.statSync(srcDir).isDirectory()) roots.add(srcDir)
  } catch {}

  roots.add(path.dirname(plan.ui.entry))
  if (plan.background) roots.add(path.dirname(plan.background.entry))

  return [...roots]
}

async function getLatestInputMtimeMs(plan) {
  const ignoreNames = new Set(['node_modules', 'dist', 'build', 'out', '.git', '.cache'])
  let latest = 0

  latest = Math.max(latest, await statMtimeMs(path.join(plan.pluginDir, 'manifest.json')))
  latest = Math.max(latest, await statMtimeMs(path.join(plan.pluginDir, 'package.json')))
  latest = Math.max(latest, await statMtimeMs(rootLockPath))

  for (const dir of getWatchRoots(plan)) {
    latest = Math.max(latest, await maxMtimeMsInDir(dir, ignoreNames))
  }

  return latest
}

async function isUpToDate(plan, opts = {}) {
  if (plan.kind !== 'bundled') return true

  const wantSourcemap = Boolean(opts.sourcemap)

  const outfiles = [plan.ui.outfile]
  if (plan.background) outfiles.push(plan.background.outfile)

  if (!wantSourcemap) {
    // 如果上一次是 watch（带 .map），而这次是 build（不带 .map），
    // 不能因为 mtime “看起来最新” 就跳过构建，否则会留下未压缩的大文件。
    for (const o of outfiles) {
      if (await exists(o + '.map')) return false
    }
  }

  const filesToCheck = [...outfiles]
  if (wantSourcemap) {
    for (const o of outfiles) filesToCheck.push(o + '.map')
  }

  const outMtimes = []
  for (const o of filesToCheck) {
    const t = await statMtimeMs(o)
    if (!t) return false
    outMtimes.push(t)
  }

  const newestInput = await getLatestInputMtimeMs(plan)
  const oldestOutput = Math.min(...outMtimes)
  return oldestOutput >= newestInput
}

function createIgnoreRelSet(plan) {
  const ignore = new Set()
  if (plan.kind !== 'bundled') return ignore

  const add = (abs) => {
    const rel = path.relative(plan.pluginDir, abs)
    if (!rel.startsWith('..')) ignore.add(normalizeRel(rel))
    if (!rel.startsWith('..')) ignore.add(normalizeRel(rel) + '.map')
  }

  add(plan.ui.outfile)
  if (plan.background) add(plan.background.outfile)
  return ignore
}

function createDebounced(fn, waitMs) {
  let timer = null
  let running = false
  let pending = false

  const run = async () => {
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      await fn()
    } finally {
      running = false
      if (pending) {
        pending = false
        await run()
      }
    }
  }

  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), waitMs)
  }
}

async function buildOne(plan, mode) {
  if (plan.kind !== 'bundled') {
    pluginInfo(`${plan.pluginId}: skip (prebuilt)`)
    return { contexts: [], watchers: [], triggerRebuild: null }
  }

  const minify = mode === 'build'
  const sourcemap = mode !== 'build'

  if (mode === 'build') {
    if (await isUpToDate(plan, { sourcemap })) {
      pluginInfo(`${plan.pluginId}: up-to-date`)
      return { contexts: [], watchers: [], triggerRebuild: null }
    }

    const uiOpts = createBuildOptions({
      pluginId: plan.pluginId,
      pluginDir: plan.pluginDir,
      entry: plan.ui.entry,
      outfile: plan.ui.outfile,
      minify,
      sourcemap,
    })
    await esbuild.build(uiOpts)

    if (plan.background) {
      const bgOpts = createBuildOptions({
        pluginId: plan.pluginId,
        pluginDir: plan.pluginDir,
        entry: plan.background.entry,
        outfile: plan.background.outfile,
        minify,
        sourcemap,
        runtime: plan.manifest.background && typeof plan.manifest.background === 'object' ? plan.manifest.background.runtime || 'node' : 'node',
      })
      await esbuild.build(bgOpts)
    }

    if (!sourcemap) {
      // 清理 watch 模式遗留的 .map，避免打包/分发时把大文件一并带走。
      for (const o of [plan.ui.outfile, ...(plan.background ? [plan.background.outfile] : [])]) {
        try {
          await fs.rm(o + '.map', { force: true })
        } catch {}
      }
    }

    pluginInfo(`${plan.pluginId}: built`)
    return { contexts: [], watchers: [], triggerRebuild: null }
  }

  const contexts = []
  const watchers = []

  const uiOpts = createBuildOptions({
    pluginId: plan.pluginId,
    pluginDir: plan.pluginDir,
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
      pluginDir: plan.pluginDir,
      entry: plan.background.entry,
      outfile: plan.background.outfile,
      minify,
      sourcemap,
      runtime: plan.manifest.background && typeof plan.manifest.background === 'object' ? plan.manifest.background.runtime || 'node' : 'node',
    })
    bgCtx = await esbuild.context(bgOpts)
    contexts.push(bgCtx)
  }

  const trigger = createDebounced(async () => {
    try {
      await Promise.all(contexts.map(c => c.rebuild()))
      pluginInfo(`${plan.pluginId}: rebuilt`)
    } catch (e) {
      const msg = e && e.errors ? e.errors.map(x => x.text).join('\n') : String(e?.message || e)
      pluginError(`${plan.pluginId}: rebuild failed\n${msg}`)
    }
  }, 120)

  if (!(await isUpToDate(plan, { sourcemap }))) {
    try {
      await Promise.all(contexts.map(c => c.rebuild()))
      pluginInfo(`${plan.pluginId}: built (startup)`)
    } catch (e) {
      const msg = e && e.errors ? e.errors.map(x => x.text).join('\n') : String(e?.message || e)
      pluginError(`${plan.pluginId}: build failed (startup)\n${msg}`)
    }
  } else {
    pluginInfo(`${plan.pluginId}: up-to-date (startup)`)
  }

  const ignoreRel = createIgnoreRelSet(plan)
  const roots = new Set(getWatchRoots(plan))
  for (const root of roots) {
    try {
      const w = fssync.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return trigger()
        const abs = path.resolve(root, String(filename))
        const rel = normalizeRel(path.relative(plan.pluginDir, abs))
        if (rel.startsWith('../')) return trigger()
        if (ignoreRel.has(rel)) return
        trigger()
      })
      watchers.push(w)
    } catch {}
  }

  try {
    const manifestWatcher = fssync.watch(path.join(plan.pluginDir, 'manifest.json'), () => trigger())
    watchers.push(manifestWatcher)
  } catch {}
  try {
    const pkgPath = path.join(plan.pluginDir, 'package.json')
    if (fssync.existsSync(pkgPath)) {
      const pkgWatcher = fssync.watch(pkgPath, () => trigger())
      watchers.push(pkgWatcher)
    }
  } catch {}

  return { contexts, watchers, triggerRebuild: trigger }
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
    pluginError(`not found: ${pluginId}`)
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
  const activeWatchers = []
  const triggers = []
  let hadError = false

  for (const p of plans) {
    try {
      const r = await buildOne(p, mode)
      for (const c of r.contexts) activeContexts.push(c)
      for (const w of r.watchers) activeWatchers.push(w)
      if (r.triggerRebuild) triggers.push(r.triggerRebuild)
    } catch (e) {
      hadError = true
      const msg = e && e.errors ? e.errors.map(x => x.text).join('\n') : String(e?.message || e)
      pluginError(`${p.pluginId}: build failed\n${msg}`)
      if (mode !== 'watch') process.exitCode = 1
    }
  }

  if (mode === 'watch') {
    if (activeWatchers.length === 0) {
      pluginInfo('no watchable plugins (all prebuilt or missing source entry)')
      return
    }
    if (hadError) process.exitCode = 1

    let lockWatcher = null
    if (fssync.existsSync(rootLockPath)) {
      try {
        lockWatcher = fssync.watch(rootLockPath, () => {
          for (const t of triggers) t()
        })
      } catch {}
    }

    const disposeAll = async () => {
      if (lockWatcher) {
        try {
          lockWatcher.close()
        } catch {}
      }
      for (const w of activeWatchers) {
        try {
          w.close()
        } catch {}
      }
      await Promise.allSettled(activeContexts.map(c => c.dispose()))
    }
    process.on('SIGINT', () => void disposeAll().finally(() => process.exit(0)))
    process.on('SIGTERM', () => void disposeAll().finally(() => process.exit(0)))
    await new Promise(() => {})
  }
}

await main()
