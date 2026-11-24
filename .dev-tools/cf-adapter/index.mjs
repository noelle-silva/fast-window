import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execFileSync, spawn } from 'node:child_process'

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
      if ((code ?? 0) === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} 失败（退出码 ${code}）`))
    })
  })
}

function toolchainEnv(depsStore, cargoTargetDir) {
  const env = { ...process.env }
  delete env.TAURI_CONFIG
  delete env.FAST_WINDOW_HOST_PROFILE
  delete env.VITE_FAST_WINDOW_HOST_PROFILE
  env.npm_config_cache = path.join(depsStore, 'npm')
  env.CARGO_HOME = path.join(depsStore, 'cargo')
  if (cargoTargetDir) {
    env.CARGO_TARGET_DIR = cargoTargetDir
  }
  return env
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
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
    if (fs.existsSync(file)) snap.set(file, fs.readFileSync(file))
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
    if (origNorm === curNorm) fs.writeFileSync(file, origBuf)
  }
}

async function cleanupWorktreeIntermediates(worktree) {
  for (const rel of ['dist', 'tsconfig.node.tsbuildinfo', path.join('src-tauri', 'target')]) {
    await fsp.rm(path.join(worktree, rel), { recursive: true, force: true })
  }
}

async function cmdDeps() {
  const worktree = requireEnv('EUCLI_CF_WORKTREE')
  const depsDir = requireEnv('EUCLI_CF_DEPS_DIR')
  const depsStore = requireEnv('EUCLI_CF_DEPS_STORE')
  for (const dir of [depsDir, path.join(depsStore, 'npm'), path.join(depsStore, 'cargo')]) {
    await fsp.mkdir(dir, { recursive: true })
  }

  const env = toolchainEnv(depsStore)
  const lockHash = sha256File(path.join(worktree, 'package-lock.json'))
  const stampPath = path.join(depsDir, 'npm-lock.sha256')
  const hasNodeModules = fs.existsSync(path.join(worktree, 'node_modules'))
  const prevHash = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8').trim() : ''

  if (!hasNodeModules || prevHash !== lockHash) {
    await spawnCmd('npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree, env })
    await fsp.writeFile(stampPath, `${lockHash}\n`, 'utf8')
  } else {
    process.stderr.write('[cf-adapter] npm 依赖与锁文件一致，跳过重复安装\n')
  }
}

async function cmdBuild() {
  const worktree = requireEnv('EUCLI_CF_WORKTREE')
  const buildDir = requireEnv('EUCLI_CF_BUILD_DIR')
  const depsStore = requireEnv('EUCLI_CF_DEPS_STORE')
  const cargoTargetDir = path.join(buildDir, 'cargo-target')
  await fsp.mkdir(buildDir, { recursive: true })

  const env = toolchainEnv(depsStore, cargoTargetDir)
  const lineSnap = snapshotLineEndingFiles(worktree)
  try {
    await spawnCmd('npm', ['run', 'build'], { cwd: worktree, env })
    await spawnCmd(
      'cargo',
      ['build', '--release', '--manifest-path', path.join('src-tauri', 'Cargo.toml')],
      { cwd: worktree, env },
    )
    const exeSrc = path.join(cargoTargetDir, 'release', HOST_EXE)
    const exeDst = path.join(buildDir, HOST_EXE)
    await fsp.copyFile(exeSrc, exeDst)
    return { executable: exeDst }
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

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function cmdStart() {
  const suffix = requireSuffix()
  const buildDir = requireEnv('EUCLI_CF_BUILD_DIR')
  const dataRoot = requireEnv('EUCLI_CF_DATA_ROOT')
  const exePath = path.join(buildDir, HOST_EXE)
  if (!fs.existsSync(exePath)) {
    throw new Error(`正式构建产物不存在: ${exePath}`)
  }

  await fsp.mkdir(dataRoot, { recursive: true })
  await fsp.rm(readyFile(dataRoot), { force: true })
  const outPath = path.join(dataRoot, 'stdout.log')
  const errPath = path.join(dataRoot, 'stderr.log')
  await fsp.writeFile(outPath, '', 'utf8')
  await fsp.writeFile(errPath, '', 'utf8')

  const outFd = fs.openSync(outPath, 'a')
  const errFd = fs.openSync(errPath, 'a')
  try {
    const child = spawn(exePath, [], {
      cwd: buildDir,
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
    await fsp.writeFile(pidFile(dataRoot), `${child.pid}\n`, 'utf8')
    process.stderr.write(`[cf-adapter] started fast-window (${suffix}) pid=${child.pid}\n`)
    return { pid: child.pid, suffix, dataRoot, stdoutLog: outPath, stderrLog: errPath }
  } finally {
    fs.closeSync(outFd)
    fs.closeSync(errFd)
  }
}

async function cmdHealth() {
  const dataRoot = requireEnv('EUCLI_CF_DATA_ROOT')
  const pFile = pidFile(dataRoot)
  if (!fs.existsSync(pFile)) throw new Error('缺少宿主 PID 文件')
  const pid = Number.parseInt(fs.readFileSync(pFile, 'utf8').trim(), 10)
  if (!Number.isInteger(pid) || pid <= 0 || !isPidAlive(pid)) {
    throw new Error(`隔离宿主进程（pid=${pid}）未在运行`)
  }
  const rFile = readyFile(dataRoot)
  if (!fs.existsSync(rFile)) throw new Error('尚未生成 host-ready.json 就绪标记')
  const marker = JSON.parse(fs.readFileSync(rFile, 'utf8'))
  if (marker?.status !== 'ready' || Number(marker?.pid) !== pid) {
    throw new Error(`宿主就绪标记异常: ${JSON.stringify(marker)}`)
  }
}

async function cmdStop() {
  const dataRoot = requireEnv('EUCLI_CF_DATA_ROOT')
  const pFile = pidFile(dataRoot)
  if (!fs.existsSync(pFile)) return
  const pid = Number.parseInt(fs.readFileSync(pFile, 'utf8').trim(), 10)
  if (Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
      } catch {
        // ignore
      }
    } else {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // ignore
      }
    }
  }
  for (let i = 0; i < 30; i += 1) {
    if (!Number.isInteger(pid) || pid <= 0 || !isPidAlive(pid)) {
      await fsp.rm(pFile, { force: true })
      return
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`隔离宿主进程 pid=${pid} 在超时内未能停止`)
}

async function cmdTest() {
  const worktree = requireEnv('EUCLI_CF_WORKTREE')
  const buildDir = requireEnv('EUCLI_CF_BUILD_DIR')
  const depsStore = requireEnv('EUCLI_CF_DEPS_STORE')
  const cargoTargetDir = path.join(buildDir, 'cargo-target')

  // 1. 校验运行中的隔离宿主实例就绪
  await cmdHealth()

  const env = toolchainEnv(depsStore, cargoTargetDir)

  // 2. 中央协议测试与宿主构建策略测试
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

  // 4. Rust 宿主单元测试
  const lineSnap = snapshotLineEndingFiles(worktree)
  try {
    await fsp.mkdir(path.join(worktree, 'dist'), { recursive: true })
    await spawnCmd('cargo', ['test', '--manifest-path', path.join('src-tauri', 'Cargo.toml')], {
      cwd: worktree,
      env,
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
