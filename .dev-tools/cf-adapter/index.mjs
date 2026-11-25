import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execFileSync, spawn, spawnSync } from 'node:child_process'

const HOST_EXE = process.platform === 'win32' ? 'fast-window.exe' : 'fast-window'
const SUFFIX_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function emit(payload, exitCode) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
  process.exit(exitCode)
}

function ok(data) {
  emit(data === undefined ? { status: 'ok' } : { status: 'ok', data }, 0)
}

function fail(reason) {
  emit({ status: 'failed', reason: String(reason || '未知错误') }, 1)
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`缺少必需环境变量 ${name}`)
  return value
}

function requireSuffix() {
  const suffix = requireEnv('EUCLI_CF_INSTANCE_SUFFIX')
  if (!SUFFIX_RE.test(suffix)) {
    throw new Error(`实例身份后缀 ${JSON.stringify(suffix)} 非法，拒绝启动`)
  }
  return suffix
}

function cmdQuote(value) {
  const raw = String(value)
  if (!raw) return '""'
  if (!/[\s"^&|<>%]/.test(raw)) return raw
  return `"${raw.replaceAll('%', '%%').replace(/["^]/g, m => `^${m}`)}"`
}

function spawnCmd(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let specCommand = command
    let specArgs = args
    if (process.platform === 'win32' && (command === 'npm' || command === 'npx')) {
      specCommand = process.env.ComSpec || 'cmd.exe'
      specArgs = ['/d', '/s', '/c', [`${command}.cmd`, ...args].map(cmdQuote).join(' ')]
    }
    process.stderr.write(`[cf-adapter] (${opts.cwd || process.cwd()}) ${command} ${args.join(' ')}\n`)
    const child = spawn(specCommand, specArgs, {
      stdio: ['ignore', process.stderr, process.stderr],
      shell: false,
      ...opts,
    })
    child.on('error', reject)
    child.on('exit', code => {
      const okCodes = opts.okExitCodes || [0]
      if (okCodes.includes(code ?? 0)) resolve()
      else reject(new Error(`${command} ${args.join(' ')} 失败（退出码 ${code}）`))
    })
  })
}

async function runRobocopy(src, dst, extraFlags = ['/MIR']) {
  await fsp.mkdir(dst, { recursive: true })
  const args = [src, dst, ...extraFlags, '/MT:32', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/NC', '/NS']
  await spawnCmd('robocopy', args, { okExitCodes: [0, 1, 2, 3, 4, 5, 6, 7] })
}

function findSccacheBin(currentPath) {
  const exeName = process.platform === 'win32' ? 'sccache.exe' : 'sccache'
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of String(currentPath || '').split(sep).map(s => s.trim()).filter(Boolean)) {
    const candidate = path.join(dir, exeName)
    if (fs.existsSync(candidate)) return candidate
  }
  return ''
}

function spaceSccachePort(depsStore) {
  const hash = crypto.createHash('sha256').update(path.resolve(depsStore).toLowerCase()).digest()
  const num = hash.readUInt16BE(0)
  return 42300 + (num % 10000)
}

function hostTuple() {
  return execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim()
}

function findRustLldLink() {
  if (process.platform !== 'win32') return ''
  try {
    const sysroot = execFileSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' }).trim()
    const tuple = hostTuple()
    const candidate = path.join(sysroot, 'lib', 'rustlib', tuple, 'bin', 'rust-lld.exe')
    return fs.existsSync(candidate) ? candidate : ''
  } catch {
    return ''
  }
}

function configureSpaceSccache(env, depsStore) {
  const bin = findSccacheBin(env.PATH || env.Path)
  if (!bin) return
  const cacheDir = path.join(depsStore, 'sccache')
  fs.mkdirSync(cacheDir, { recursive: true })
  env.RUSTC_WRAPPER = bin
  env.SCCACHE_DIR = cacheDir
  env.SCCACHE_SERVER_PORT = String(spaceSccachePort(depsStore))
  env.SCCACHE_IDLE_TIMEOUT = '180'
  env.CARGO_INCREMENTAL = '0'
  try {
    spawnSync(bin, ['--start-server'], { env, stdio: 'ignore' })
  } catch {
    // ignore
  }
}

function toolchainEnv(depsStore, cargoTargetDir, opts = {}) {
  const env = { ...process.env }
  delete env.TAURI_CONFIG
  delete env.FAST_WINDOW_HOST_PROFILE
  delete env.VITE_FAST_WINDOW_HOST_PROFILE
  for (const key of Object.keys(env)) {
    if (key.startsWith('CARGO_PROFILE_RELEASE_') || key === 'RUSTC_WRAPPER' || key === 'CARGO_INCREMENTAL') {
      delete env[key]
    }
  }
  env.npm_config_cache = path.join(depsStore, 'npm')
  env.CARGO_HOME = path.join(depsStore, 'cargo')
  if (cargoTargetDir) {
    env.CARGO_TARGET_DIR = cargoTargetDir
    if (opts.fastVerify) {
      env.CARGO_PROFILE_RELEASE_OPT_LEVEL = '0'
      env.CARGO_PROFILE_RELEASE_LTO = 'false'
      env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = '256'
      env.CARGO_PROFILE_RELEASE_DEBUG = '0'
      env.CARGO_PROFILE_RELEASE_STRIP = 'false'
      env.CARGO_PROFILE_RELEASE_PANIC = 'unwind'
      env.CARGO_PROFILE_RELEASE_INCREMENTAL = 'true'
      env.CARGO_INCREMENTAL = '1'
      const lld = findRustLldLink()
      if (lld) env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = lld
    } else {
      configureSpaceSccache(env, depsStore)
      const lld = findRustLldLink()
      if (lld) env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = lld
    }
  }
  return env
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function computeRustSeedFingerprint(worktree) {
  const hash = crypto.createHash('sha256')
  hash.update('host-fast-verify-v1\0')
  try {
    hash.update(execFileSync('rustc', ['-V'], { encoding: 'utf8' }).trim() + '\0')
  } catch {}
  const lockPath = path.join(worktree, 'src-tauri', 'Cargo.lock')
  if (fs.existsSync(lockPath)) hash.update(fs.readFileSync(lockPath))
  return hash.digest('hex')
}

async function cloneCargoTargetHardlink(srcRoot, dstRoot) {
  await fsp.rm(dstRoot, { recursive: true, force: true })
  await fsp.mkdir(dstRoot, { recursive: true })
  const isOwn = name => {
    const lower = name.toLowerCase()
    return (
      lower.startsWith('fast_window') ||
      lower.startsWith('fast-window') ||
      lower.startsWith('libfast_window') ||
      lower.startsWith('build_script_build')
    )
  }
  const tasks = []
  function walk(srcDir, dstDir, mode) {
    fs.mkdirSync(dstDir, { recursive: true })
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const sPath = path.join(srcDir, entry.name)
      const dPath = path.join(dstDir, entry.name)
      if (entry.isDirectory()) {
        let nextMode = mode
        if (mode === 'root' && (entry.name === 'release' || entry.name === 'debug')) nextMode = 'profile'
        else if (mode === 'profile') {
          if (entry.name === 'deps') nextMode = 'deps'
          else if (entry.name === 'build') nextMode = 'build'
          else nextMode = 'copy'
        } else if (mode === 'build') {
          nextMode = isOwn(entry.name) ? 'copy' : 'link'
        }
        walk(sPath, dPath, nextMode)
      } else if (entry.isFile()) {
        const shouldLink = mode === 'link' || (mode === 'deps' && !isOwn(entry.name))
        tasks.push({ op: shouldLink ? 'link' : 'copy', sPath, dPath })
      }
    }
  }
  walk(srcRoot, dstRoot, 'root')

  let idx = 0
  const workers = Array.from({ length: 64 }, async () => {
    while (true) {
      const i = idx++
      if (i >= tasks.length) break
      const t = tasks[i]
      if (t.op === 'link') {
        try {
          await fsp.link(t.sPath, t.dPath)
        } catch {
          await fsp.copyFile(t.sPath, t.dPath)
          const st = await fsp.stat(t.sPath)
          await fsp.utimes(t.dPath, st.atime, st.mtime)
        }
      } else {
        await fsp.copyFile(t.sPath, t.dPath)
        const st = await fsp.stat(t.sPath)
        await fsp.utimes(t.dPath, st.atime, st.mtime)
      }
    }
  })
  await Promise.all(workers)
}

function tryAllocCanonicalDrives(worktree, buildDir) {
  if (process.platform !== 'win32') {
    return { canonical: false, appDrive: '', tgtDrive: '', appDir: worktree, targetDir: path.join(buildDir, 'cargo-target') }
  }
  const letters = ['Y', 'Z', 'X', 'W', 'V', 'U', 'T', 'S', 'R', 'Q', 'P', 'O', 'N', 'M']
  let appDrive = ''
  let tgtDrive = ''
  for (const ch of letters) {
    if (fs.existsSync(`${ch}:\\`)) continue
    if (!appDrive) {
      try {
        execFileSync('subst', [`${ch}:`, worktree], { stdio: 'ignore' })
        appDrive = ch
      } catch {}
    } else if (!tgtDrive) {
      try {
        execFileSync('subst', [`${ch}:`, buildDir], { stdio: 'ignore' })
        tgtDrive = ch
        break
      } catch {}
    }
  }
  if (!appDrive || !tgtDrive) {
    if (appDrive) { try { execFileSync('subst', [`${appDrive}:`, '/D'], { stdio: 'ignore' }) } catch {} }
    if (tgtDrive) { try { execFileSync('subst', [`${tgtDrive}:`, '/D'], { stdio: 'ignore' }) } catch {} }
    return { canonical: false, appDrive: '', tgtDrive: '', appDir: worktree, targetDir: path.join(buildDir, 'cargo-target') }
  }
  return {
    canonical: appDrive === 'Y' && tgtDrive === 'Z',
    appDrive,
    tgtDrive,
    appDir: `${appDrive}:\\`,
    targetDir: `${tgtDrive}:\\cargo-target`,
  }
}

function detachCanonicalDrives(mount) {
  if (!mount) return
  for (const ch of [mount.appDrive, mount.tgtDrive]) {
    if (!ch) continue
    try { execFileSync('subst', [`${ch}:`, '/D'], { stdio: 'ignore' }) } catch {}
  }
}

async function withCanonicalCargoDrives(worktree, buildDir, fn) {
  await fsp.mkdir(path.join(buildDir, 'cargo-target'), { recursive: true })
  const mount = tryAllocCanonicalDrives(worktree, buildDir)
  try {
    return await fn(mount)
  } finally {
    detachCanonicalDrives(mount)
  }
}

function readSeedMeta(depsStore) {
  const metaPath = path.join(depsStore, 'seed-target-verify.meta.json')
  if (!fs.existsSync(metaPath)) return null
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  } catch {
    return null
  }
}

async function maybeCloneVerifySeed(depsStore, cargoTargetDir, lockFp) {
  const seedDir = path.join(depsStore, 'seed-target-verify')
  if (fs.existsSync(path.join(cargoTargetDir, 'release', '.fingerprint'))) return false
  const meta = readSeedMeta(depsStore)
  if (!meta || meta.lockFp !== lockFp || !fs.existsSync(path.join(seedDir, 'release', '.fingerprint'))) return false
  process.stderr.write('[cf-adapter] 命中仓内宿主 Rust 基线底稿，硬链接克隆至当前分支构建区\n')
  await cloneCargoTargetHardlink(seedDir, cargoTargetDir)
  return true
}

async function maybeSnapshotVerifySeed(depsStore, cargoTargetDir, lockFp) {
  const seedDir = path.join(depsStore, 'seed-target-verify')
  const metaPath = path.join(depsStore, 'seed-target-verify.meta.json')
  const meta = readSeedMeta(depsStore)
  if (meta && meta.lockFp === lockFp && fs.existsSync(path.join(seedDir, 'release', '.fingerprint'))) return false
  const tmpDir = path.join(depsStore, `seed-target-verify.tmp.${process.pid}.${Date.now()}`)
  try {
    process.stderr.write('[cf-adapter] 写入仓内宿主 Rust 基线底稿供后续新分支秒级复用\n')
    await runRobocopy(cargoTargetDir, tmpDir, ['/MIR'])
    const oldDir = path.join(depsStore, `seed-target-verify.old.${process.pid}.${Date.now()}`)
    if (fs.existsSync(seedDir)) {
      await fsp.rename(seedDir, oldDir).catch(() => fsp.rm(seedDir, { recursive: true, force: true }))
    }
    await fsp.rename(tmpDir, seedDir)
    await fsp.writeFile(metaPath, JSON.stringify({ lockFp, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
    if (fs.existsSync(oldDir)) {
      await fsp.rm(oldDir, { recursive: true, force: true }).catch(() => {})
    }
    return true
  } catch (err) {
    process.stderr.write(`[cf-adapter] 写入宿主基线底稿跳过（不影响本次构建）: ${err.message}\n`)
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return false
  }
}

function snapshotLineEndingFiles(worktree) {
  const candidates = [path.join(worktree, 'src-tauri', 'Cargo.toml')]
  const schemasDir = path.join(worktree, 'src-tauri', 'gen', 'schemas')
  if (fs.existsSync(schemasDir)) {
    for (const entry of fs.readdirSync(schemasDir)) {
      if (entry.endsWith('.json')) {
        candidates.push(path.join(schemasDir, entry))
      }
    }
  }
  const snap = new Map()
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      snap.set(file, fs.readFileSync(file))
    }
  }
  return snap
}

function restoreIdenticalLineEndings(snap) {
  for (const [file, origBuf] of snap.entries()) {
    if (!fs.existsSync(file)) continue
    const curBuf = fs.readFileSync(file)
    if (curBuf.equals(origBuf)) continue
    const origNorm = origBuf.toString('utf8').replaceAll('\r\n', '\n')
    const curNorm = curBuf.toString('utf8').replaceAll('\r\n', '\n')
    if (origNorm === curNorm) {
      fs.writeFileSync(file, origBuf)
    }
  }
}

async function cleanupWorktreeIntermediates(worktree) {
  for (const rel of ['dist', '.tmp', path.join('src-tauri', 'target')]) {
    await fsp.rm(path.join(worktree, rel), { recursive: true, force: true })
  }
}

async function unlinkIfSymlink(targetPath) {
  try {
    const st = fs.lstatSync(targetPath)
    if (st.isSymbolicLink()) {
      await fsp.unlink(targetPath)
      return true
    }
  } catch {}
  return false
}

async function ensureNodeModulesCached(worktree, depsStore, depsDir, env) {
  const lockPath = path.join(worktree, 'package-lock.json')
  const stampPath = path.join(depsDir, 'npm-lock.sha256')
  const lockHash = sha256File(lockPath)
  const nmCacheEntry = path.join(depsStore, 'nm-cache', lockHash)
  const cachedNm = path.join(nmCacheEntry, 'node_modules')
  const worktreeNm = path.join(worktree, 'node_modules')
  const prevHash = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8').trim() : ''

  if (prevHash === lockHash && fs.existsSync(worktreeNm)) {
    try {
      const lst = fs.lstatSync(worktreeNm)
      if (!lst.isSymbolicLink() || fs.existsSync(cachedNm)) {
        process.stderr.write('[cf-adapter] npm 依赖与锁文件一致，跳过重复安装\n')
        return
      }
    } catch {}
  }

  if (process.platform === 'win32') {
    const wasLink = await unlinkIfSymlink(worktreeNm)
    if (!wasLink && fs.existsSync(worktreeNm)) {
      await fsp.rm(worktreeNm, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
    if (fs.existsSync(cachedNm)) {
      process.stderr.write(`[cf-adapter] 命中空间级 node_modules 快照 (${lockHash.slice(0, 12)})，秒级挂载\n`)
      await fsp.symlink(cachedNm, worktreeNm, 'junction')
      await fsp.writeFile(stampPath, `${lockHash}\n`, 'utf8')
      return
    }
    await fsp.mkdir(nmCacheEntry, { recursive: true })
    await spawnCmd('npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree, env })
    try {
      await fsp.rename(worktreeNm, cachedNm)
    } catch {
      if (fs.existsSync(cachedNm)) {
        await fsp.rm(worktreeNm, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } else {
        await fsp.writeFile(stampPath, `${lockHash}\n`, 'utf8')
        return
      }
    }
    await fsp.symlink(cachedNm, worktreeNm, 'junction')
    await fsp.writeFile(stampPath, `${lockHash}\n`, 'utf8')
    return
  }

  await spawnCmd('npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree, env })
  await fsp.writeFile(stampPath, `${lockHash}\n`, 'utf8')
}

async function cmdDeps() {
  const worktree = requireEnv('EUCLI_CF_WORKTREE')
  const depsDir = requireEnv('EUCLI_CF_DEPS_DIR')
  const depsStore = requireEnv('EUCLI_CF_DEPS_STORE')
  for (const dir of [depsDir, path.join(depsStore, 'npm'), path.join(depsStore, 'nm-cache'), path.join(depsStore, 'cargo')]) {
    await fsp.mkdir(dir, { recursive: true })
  }
  const env = toolchainEnv(depsStore)
  await ensureNodeModulesCached(worktree, depsStore, depsDir, env)
}

async function cmdBuild() {
  const worktree = requireEnv('EUCLI_CF_WORKTREE')
  const buildDir = requireEnv('EUCLI_CF_BUILD_DIR')
  const depsStore = requireEnv('EUCLI_CF_DEPS_STORE')
  const cargoTargetDir = path.join(buildDir, 'cargo-target')
  const packageDir = path.join(buildDir, 'package')
  await fsp.mkdir(buildDir, { recursive: true })

  const lockFp = computeRustSeedFingerprint(worktree)
  const lineSnap = snapshotLineEndingFiles(worktree)
  try {
    // 1. Frontend Vite build MUST run in real worktree (avoids Vite 5 html-inline-proxy realpath mismatch on subst)
    const realEnv = toolchainEnv(depsStore, cargoTargetDir, { fastVerify: true })
    await spawnCmd('npm', ['run', 'build'], { cwd: worktree, env: realEnv })

    // 2. Cargo build under canonical Y:\ + Z:\cargo-target with fast-verify profile + seed cloning
    await withCanonicalCargoDrives(worktree, buildDir, async mount => {
      const fastVerify = mount.canonical
      if (fastVerify) {
        await maybeCloneVerifySeed(depsStore, cargoTargetDir, lockFp)
      }
      const cargoEnv = toolchainEnv(depsStore, mount.targetDir, { fastVerify })
      await spawnCmd('cargo', ['build', '--release', '--manifest-path', path.join('src-tauri', 'Cargo.toml')], {
        cwd: mount.appDir,
        env: cargoEnv,
      })

      if (fastVerify) {
        const meta = readSeedMeta(depsStore)
        const needSeed = !meta || meta.lockFp !== lockFp || !fs.existsSync(path.join(depsStore, 'seed-target-verify', 'release', '.fingerprint'))
        if (needSeed) {
          await spawnCmd('cargo', ['test', '--release', '--no-run', '--manifest-path', path.join('src-tauri', 'Cargo.toml')], {
            cwd: mount.appDir,
            env: cargoEnv,
          }).catch(() => {})
          await maybeSnapshotVerifySeed(depsStore, cargoTargetDir, lockFp)
        }
      }
    })

    const exeSrc = path.join(cargoTargetDir, 'release', HOST_EXE)
    if (!fs.existsSync(exeSrc)) {
      throw new Error(`找不到构建产物 ${exeSrc}`)
    }
    await fsp.rm(packageDir, { recursive: true, force: true })
    await fsp.mkdir(packageDir, { recursive: true })
    const exeDst = path.join(packageDir, HOST_EXE)
    await fsp.copyFile(exeSrc, exeDst)
    return { packageDir, executable: exeDst }
  } finally {
    await cleanupWorktreeIntermediates(worktree)
    restoreIdenticalLineEndings(lineSnap)
  }
}

function pidFile(dataRoot) {
  return path.join(dataRoot, 'host.pid')
}

function readyFile(dataRoot) {
  return path.join(dataRoot, 'host-ready.json')
}

function stdoutLogFile(dataRoot) {
  return path.join(dataRoot, 'stdout.log')
}

function stderrLogFile(dataRoot) {
  return path.join(dataRoot, 'stderr.log')
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readStoredPid(dataRoot) {
  const file = pidFile(dataRoot)
  if (!fs.existsSync(file)) return 0
  const n = Number(fs.readFileSync(file, 'utf8').trim())
  return Number.isInteger(n) && n > 0 ? n : 0
}

function stopProcessTree(pid) {
  if (!isPidAlive(pid)) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // ignore
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // ignore
    }
  }
}

async function cmdStart() {
  const buildDir = requireEnv('EUCLI_CF_BUILD_DIR')
  const dataRoot = requireEnv('EUCLI_CF_DATA_ROOT')
  const suffix = requireSuffix()
  const packageDir = path.join(buildDir, 'package')
  const exePath = path.join(packageDir, HOST_EXE)
  if (!fs.existsSync(exePath)) {
    throw new Error(`找不到正式构建产物 ${exePath}，请先执行 build`)
  }

  await fsp.mkdir(dataRoot, { recursive: true })
  const oldPid = readStoredPid(dataRoot)
  if (oldPid) stopProcessTree(oldPid)
  await fsp.rm(readyFile(dataRoot), { force: true })

  const outPath = stdoutLogFile(dataRoot)
  const errPath = stderrLogFile(dataRoot)
  await fsp.writeFile(outPath, '', 'utf8')
  await fsp.writeFile(errPath, '', 'utf8')

  const outFd = fs.openSync(outPath, 'a')
  const errFd = fs.openSync(errPath, 'a')
  let pid
  try {
    const child = spawn(exePath, [], {
      cwd: packageDir,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
      env: {
        ...process.env,
        FAST_WINDOW_INSTANCE_SUFFIX: suffix,
        FAST_WINDOW_DATA_DIR: dataRoot,
        WEBVIEW2_USER_DATA_FOLDER: path.join(dataRoot, 'webview2'),
      },
    })
    child.unref()
    pid = child.pid
  } finally {
    fs.closeSync(outFd)
    fs.closeSync(errFd)
  }

  if (!pid) throw new Error(`启动隔离宿主实例失败: ${exePath}`)
  await fsp.writeFile(pidFile(dataRoot), `${pid}\n`, 'utf8')
  process.stderr.write(`[cf-adapter] started host pid=${pid} suffix=${suffix}\n`)
  return { pid, executable: exePath, dataRoot, suffix }
}

async function cmdHealth() {
  const dataRoot = requireEnv('EUCLI_CF_DATA_ROOT')
  const suffix = requireSuffix()
  const pid = readStoredPid(dataRoot)
  if (!pid || !isPidAlive(pid)) {
    throw new Error(`宿主实例进程未运行（pid=${pid}）`)
  }
  const markerPath = readyFile(dataRoot)
  if (!fs.existsSync(markerPath)) {
    throw new Error('宿主实例尚未写出 host-ready.json 就绪标记')
  }
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  if (marker?.status !== 'ready' || marker?.suffix !== suffix || Number(marker?.pid) !== pid) {
    throw new Error(`宿主就绪标记与当前实例不匹配: ${JSON.stringify(marker)}`)
  }
}

async function cmdStop() {
  const dataRoot = requireEnv('EUCLI_CF_DATA_ROOT')
  const pid = readStoredPid(dataRoot)
  if (pid) stopProcessTree(pid)
  await fsp.rm(pidFile(dataRoot), { force: true })
  await fsp.rm(readyFile(dataRoot), { force: true })
}

async function cmdTest() {
  const worktree = requireEnv('EUCLI_CF_WORKTREE')
  const buildDir = requireEnv('EUCLI_CF_BUILD_DIR')
  const depsStore = requireEnv('EUCLI_CF_DEPS_STORE')
  const cargoTargetDir = path.join(buildDir, 'cargo-target')

  // 1. 校验运行中的隔离宿主实例就绪
  await cmdHealth()

  const env = toolchainEnv(depsStore, cargoTargetDir, { fastVerify: true })

  // 2. 中央协议测试与宿主构建策略测试（在真实 worktree 路径运行）
  const protoTests = [
    '.fast-window-dev-protocol/tests/app-manifest.test.mjs',
    '.fast-window-dev-protocol/tests/app-registry.test.mjs',
    '.fast-window-dev-protocol/tests/dependency-parity.test.mjs',
    '.fast-window-dev-protocol/tests/fast-window-dev-tool.test.mjs',
    '.fast-window-dev-protocol/tests/store-catalog.test.mjs',
    '.fast-window-dev-protocol/tests/store-ops.test.mjs',
    'scripts/host-tauri-build-policy.test.mjs',
  ]
  await spawnCmd('node', ['--test', ...protoTests], { cwd: worktree, env })

  // 3. 验证中央工具从 shared/app-registry.json 读取注册表并体检通过
  await spawnCmd('node', ['.fast-window-dev-protocol/fast-window-dev-tool.mjs', '--list'], {
    cwd: worktree,
    env,
  })

  // 4. Rust 宿主单元测试（复用 Y:\ + Z:\cargo-target 与 fastVerify panic=unwind，只编 1 个 crate）
  const lineSnap = snapshotLineEndingFiles(worktree)
  try {
    await fsp.mkdir(path.join(worktree, 'dist'), { recursive: true })
    await withCanonicalCargoDrives(worktree, buildDir, async mount => {
      const cargoEnv = toolchainEnv(depsStore, mount.targetDir, { fastVerify: mount.canonical })
      await spawnCmd('cargo', ['test', '--release', '--manifest-path', path.join('src-tauri', 'Cargo.toml')], {
        cwd: mount.appDir,
        env: cargoEnv,
      })
    })
  } finally {
    await cleanupWorktreeIntermediates(worktree)
    restoreIdenticalLineEndings(lineSnap)
  }
}

async function main() {
  const sub = process.argv[2]
  switch (sub) {
    case 'deps':
      await cmdDeps()
      ok()
      break
    case 'build':
      ok(await cmdBuild())
      break
    case 'start':
      ok(await cmdStart())
      break
    case 'health':
      await cmdHealth()
      ok()
      break
    case 'stop':
      await cmdStop()
      ok()
      break
    case 'seed':
      emit({ status: 'not-applicable' }, 0)
      break
    case 'test':
      await cmdTest()
      ok()
      break
    default:
      fail(`未知适配器子命令: ${sub || '(空)'}`)
  }
}

main().catch(err => fail(err?.message || err))
