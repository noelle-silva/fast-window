import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import * as esbuild from 'esbuild'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const pluginsDir = path.join(rootDir, 'plugins')
const rootLockPath = path.join(rootDir, 'pnpm-lock.yaml')
const devPluginSyncEnabled = process.env.FAST_WINDOW_PLUGIN_DEV_SYNC === '1'
const devPluginSyncDir = resolveDevPluginSyncDir()
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

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts })
}

function waitExit(child) {
  return new Promise(resolve => child.on('exit', code => resolve(code ?? 0)))
}

function resolveDevPluginSyncDir() {
  const explicit = String(process.env.FAST_WINDOW_PLUGIN_DEV_SYNC_DIR || '').trim()
  if (explicit) return path.resolve(explicit)

  const dataDir = String(process.env.FAST_WINDOW_DATA_DIR || '').trim()
  if (dataDir) return path.resolve(dataDir, 'plugins')

  return path.join(rootDir, 'src-tauri', 'target', 'debug', 'plugins')
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

async function copyRuntimeEntry(pluginDir, pluginId, entryName) {
  const from = path.join(pluginDir, entryName)
  if (!(await exists(from))) return false

  const to = path.join(devPluginSyncDir, pluginId, entryName)
  await fs.rm(to, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.cp(from, to, { recursive: true, force: true })
  return true
}

async function syncDevRuntimePlugin(plan) {
  if (!devPluginSyncEnabled) return

  const manifestPath = path.join(plan.pluginDir, 'manifest.json')
  if (!(await exists(manifestPath))) return

  await fs.mkdir(path.join(devPluginSyncDir, plan.pluginId), { recursive: true })
  const entries = ['manifest.json', 'package.json', 'assets', 'ui', 'backend', 'shared']
  let copied = 0
  for (const entry of entries) {
    if (await copyRuntimeEntry(plan.pluginDir, plan.pluginId, entry)) copied += 1
  }
  if (copied > 0) pluginInfo(`${plan.pluginId}: synced dev runtime -> ${devPluginSyncDir}`)
}

function resolveBackgroundBuildConfig(cfg, mode) {
  const bg = cfg && typeof cfg.background === 'object' ? cfg.background : null
  const profileKey = mode === 'build' ? 'release' : mode
  const selected = bg && typeof bg[profileKey] === 'object' ? bg[profileKey] : null
  const dev = bg && typeof bg.dev === 'object' ? bg.dev : null
  const raw = selected || dev || null
  const entry = typeof raw?.entry === 'string' ? raw.entry.trim() : typeof cfg.backgroundEntry === 'string' ? cfg.backgroundEntry.trim() : ''
  const main = typeof raw?.main === 'string' ? raw.main.trim() : ''
  const runtime = typeof raw?.runtime === 'string' ? raw.runtime.trim() : 'node'
  const kind = typeof raw?.kind === 'string' ? raw.kind.trim() : 'node-bundle'
  const manifest = typeof raw?.manifest === 'string' ? raw.manifest.trim() : ''
  const packageName = typeof raw?.package === 'string' ? raw.package.trim() : ''
  const profile = typeof raw?.profile === 'string' ? raw.profile.trim() : mode === 'build' ? 'release' : 'dev'
  return { kind, entry, main, runtime, manifest, packageName, profile }
}

async function resolvePluginBuildPlan(pluginId, mode) {
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
  const bgCfg = resolveBackgroundBuildConfig(cfg, mode)
  const bgMain = bgCfg.main || (manifest.background && typeof manifest.background === 'object' ? String(manifest.background.main || '').trim() : '')
  if (bgMain && bgMain !== manifest.main) {
    const bgOutfile = safeResolveWithin(pluginDir, bgMain)
    if (bgCfg.kind === 'rust-binary') {
      const manifestRel = bgCfg.manifest || 'backend-rs/Cargo.toml'
      const manifestAbs = safeResolveWithin(pluginDir, manifestRel)
      background = {
        kind: 'rust-binary',
        outfile: bgOutfile,
        runtime: bgCfg.runtime || 'direct',
        manifest: manifestAbs,
        manifestRel,
        packageName: bgCfg.packageName,
        profile: bgCfg.profile,
      }
    } else {
      const bgEntryRel = bgCfg.entry
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
      background = { kind: 'node-bundle', entry: bgEntry, outfile: bgOutfile, runtime: bgCfg.runtime }
    }
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

function rustTargetDir(manifestPath) {
  return path.join(path.dirname(manifestPath), 'target')
}

function rustBinaryName(packageName) {
  return process.platform === 'win32' ? `${packageName}.exe` : packageName
}

async function buildRustBackground(background) {
  const manifestDir = path.dirname(background.manifest)
  const packageName = background.packageName || path.basename(manifestDir)
  const release = background.profile === 'release'
  const args = ['build', '--manifest-path', background.manifest]
  if (release) args.push('--release')
  const code = await waitExit(run('cargo', args))
  if (code !== 0) throw new Error(`cargo build failed: exit ${code}`)

  const profileDir = release ? 'release' : 'debug'
  const built = path.join(rustTargetDir(background.manifest), profileDir, rustBinaryName(packageName))
  if (!(await exists(built))) throw new Error(`Rust backend output not found: ${built}`)
  await fs.mkdir(path.dirname(background.outfile), { recursive: true })
  await fs.copyFile(built, background.outfile)
}

async function buildBackground(plan, minify, sourcemap) {
  if (!plan.background) return
  if (plan.background.kind === 'rust-binary') {
    await buildRustBackground(plan.background)
    return
  }

  const bgOpts = createBuildOptions({
    pluginId: plan.pluginId,
    pluginDir: plan.pluginDir,
    entry: plan.background.entry,
    outfile: plan.background.outfile,
    minify,
    sourcemap,
    runtime: plan.background.runtime,
  })
  await esbuild.build(bgOpts)
}

function getWatchRoots(plan) {
  if (plan.kind !== 'bundled') return []
  const roots = new Set()

  const srcDir = path.join(plan.pluginDir, 'src')
  try {
    if (fssync.existsSync(srcDir) && fssync.statSync(srcDir).isDirectory()) roots.add(srcDir)
  } catch {}

  roots.add(path.dirname(plan.ui.entry))
  if (plan.background?.kind === 'rust-binary') {
    roots.add(path.join(path.dirname(plan.background.manifest), 'src'))
  } else if (plan.background) {
    roots.add(path.dirname(plan.background.entry))
  }

  return [...roots]
}

async function getLatestInputMtimeMs(plan) {
  const ignoreNames = new Set(['node_modules', 'dist', 'build', 'out', 'target', '.git', '.cache'])
  let latest = 0

  latest = Math.max(latest, await statMtimeMs(path.join(plan.pluginDir, 'manifest.json')))
  latest = Math.max(latest, await statMtimeMs(path.join(plan.pluginDir, 'package.json')))
  latest = Math.max(latest, await statMtimeMs(rootLockPath))
  if (plan.background?.kind === 'rust-binary') {
    latest = Math.max(latest, await statMtimeMs(plan.background.manifest))
    latest = Math.max(latest, await statMtimeMs(path.join(path.dirname(plan.background.manifest), 'Cargo.lock')))
  }

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
      await syncDevRuntimePlugin(plan)
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

    await buildBackground(plan, minify, sourcemap)

    if (!sourcemap) {
      // 清理 watch 模式遗留的 .map，避免打包/分发时把大文件一并带走。
      for (const o of [plan.ui.outfile, ...(plan.background ? [plan.background.outfile] : [])]) {
        try {
          await fs.rm(o + '.map', { force: true })
        } catch {}
      }
    }

    pluginInfo(`${plan.pluginId}: built`)
    await syncDevRuntimePlugin(plan)
    return { contexts: [], watchers: [], triggerRebuild: null }
  }

  const contexts = []
  const watchers = []
  let rebuildingPlan = false

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
  if (plan.background?.kind === 'node-bundle') {
    const bgOpts = createBuildOptions({
      pluginId: plan.pluginId,
      pluginDir: plan.pluginDir,
      entry: plan.background.entry,
      outfile: plan.background.outfile,
      minify,
      sourcemap,
      runtime: plan.background.runtime,
    })
    bgCtx = await esbuild.context(bgOpts)
    contexts.push(bgCtx)
  }

  const trigger = createDebounced(async () => {
    try {
      if (rebuildingPlan) return
      await Promise.all(contexts.map(c => c.rebuild()))
      if (plan.background?.kind === 'rust-binary') await buildRustBackground(plan.background)
      pluginInfo(`${plan.pluginId}: rebuilt`)
      await syncDevRuntimePlugin(plan)
    } catch (e) {
      const msg = e && e.errors ? e.errors.map(x => x.text).join('\n') : String(e?.message || e)
      pluginError(`${plan.pluginId}: rebuild failed\n${msg}`)
    }
  }, 120)

  const triggerPlanReload = createDebounced(async () => {
    if (rebuildingPlan) return
    rebuildingPlan = true
    try {
      for (const w of watchers.splice(0)) {
        try {
          w.close()
        } catch {}
      }
      await Promise.allSettled(contexts.splice(0).map(c => c.dispose()))
      const nextPlan = await resolvePluginBuildPlan(plan.pluginId, mode)
      if (!nextPlan) return
      const next = await buildOne(nextPlan, mode)
      contexts.push(...next.contexts)
      watchers.push(...next.watchers)
      plan = nextPlan
    } catch (e) {
      const msg = e && e.errors ? e.errors.map(x => x.text).join('\n') : String(e?.message || e)
      pluginError(`${plan.pluginId}: reload failed\n${msg}`)
    } finally {
      rebuildingPlan = false
    }
  }, 120)

  if (!(await isUpToDate(plan, { sourcemap }))) {
    try {
      await Promise.all(contexts.map(c => c.rebuild()))
      if (plan.background?.kind === 'rust-binary') await buildRustBackground(plan.background)
      pluginInfo(`${plan.pluginId}: built (startup)`)
      await syncDevRuntimePlugin(plan)
    } catch (e) {
      const msg = e && e.errors ? e.errors.map(x => x.text).join('\n') : String(e?.message || e)
      pluginError(`${plan.pluginId}: build failed (startup)\n${msg}`)
    }
  } else {
    pluginInfo(`${plan.pluginId}: up-to-date (startup)`)
    await syncDevRuntimePlugin(plan)
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
    const manifestWatcher = fssync.watch(path.join(plan.pluginDir, 'manifest.json'), () => triggerPlanReload())
    watchers.push(manifestWatcher)
  } catch {}
  try {
    const pkgPath = path.join(plan.pluginDir, 'package.json')
    if (fssync.existsSync(pkgPath)) {
      const pkgWatcher = fssync.watch(pkgPath, () => triggerPlanReload())
      watchers.push(pkgWatcher)
    }
  } catch {}
  if (plan.background?.kind === 'rust-binary') {
    try {
      const cargoWatcher = fssync.watch(plan.background.manifest, () => trigger())
      watchers.push(cargoWatcher)
    } catch {}
    try {
      const lockPath = path.join(path.dirname(plan.background.manifest), 'Cargo.lock')
      if (fssync.existsSync(lockPath)) {
        const cargoLockWatcher = fssync.watch(lockPath, () => trigger())
        watchers.push(cargoLockWatcher)
      }
    } catch {}
  }

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
    const plan = await resolvePluginBuildPlan(id, mode).catch(e => {
      console.error(String(e?.message || e))
      return null
    })
    if (plan) plans.push(plan)
  }

  const activeBuilds = []
  const triggers = []
  let hadError = false

  for (const p of plans) {
    try {
      const r = await buildOne(p, mode)
      activeBuilds.push(r)
      if (r.triggerRebuild) triggers.push(r.triggerRebuild)
    } catch (e) {
      hadError = true
      const msg = e && e.errors ? e.errors.map(x => x.text).join('\n') : String(e?.message || e)
      pluginError(`${p.pluginId}: build failed\n${msg}`)
      if (mode !== 'watch') process.exitCode = 1
    }
  }

  if (mode === 'watch') {
    if (activeBuilds.every(r => r.watchers.length === 0)) {
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
      for (const r of activeBuilds) {
        for (const w of r.watchers) {
          try {
            w.close()
          } catch {}
        }
      }
      await Promise.allSettled(activeBuilds.flatMap(r => r.contexts).map(c => c.dispose()))
    }
    process.on('SIGINT', () => void disposeAll().finally(() => process.exit(0)))
    process.on('SIGTERM', () => void disposeAll().finally(() => process.exit(0)))
    await new Promise(() => {})
  }
}

await main()
