#!/usr/bin/env node
// eucli-studio 渲染基准驱动：启动 Vite（bench 配置）→ 启动无头 Chrome/Edge
// → 通过 CDP 调用页面里的 window.__BENCH__.runAll() → 打印表格。
//
// 不依赖 playwright/puppeteer，也不往应用依赖里加任何东西。
// 只使用 Node 内置模块 + Node 22+ 的全局 WebSocket。

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const benchDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(benchDir, '..')

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  printHelp()
  process.exit(0)
}

const VITE_PORT = Number(args.port || 0) || (await findFreePort(1459))
const STARTUP_TIMEOUT_MS = Number(args.timeout || 120000)
const RUN_TIMEOUT_MS = Number(args.runTimeout || 600000)

let viteChild = null
let chromeChild = null
let cdp = null
let profileDir = ''
let viteLog = ''
let chromeLog = ''

main().catch(async (error) => {
  console.error(`\n基准失败：${error?.message || error}`)
  if (viteLog.trim()) console.error(`\n--- Vite 输出 ---\n${stripAnsi(viteLog).slice(-4000)}`)
  if (chromeLog.trim()) console.error(`\n--- Chrome 输出 ---\n${chromeLog.slice(-4000)}`)
  await cleanup()
  process.exit(1)
})

async function main() {
  if (typeof WebSocket !== 'function') {
    throw new Error('当前 Node 没有全局 WebSocket；请使用 Node 22+ 运行本脚本。')
  }
  if (!existsSync(path.join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js'))) {
    throw new Error(`未找到 Vite：${path.join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js')}`)
  }

  const chromePath = findChrome()
  if (!chromePath) {
    throw new Error(
      [
        '未找到可用的 Chrome/Edge。',
        '请安装 Chrome，或显式指定浏览器路径后再运行：',
        '  CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" node bench/run-bench.mjs',
        '也可以设置 EDGE_PATH 指向 msedge.exe。',
      ].join('\n'),
    )
  }

  const viteUrl = args.url ? String(args.url) : await startVite(VITE_PORT)
  console.log(`Vite: ${viteUrl}`)
  console.log(`Chrome: ${chromePath}`)

  const browser = await launchChrome(chromePath)
  cdp = browser.cdp

  const version = await cdp.send('Browser.getVersion')
  console.log(`Browser: ${version.product}`)
  console.log('启动测量（预热与首用开销已排除）…\n')

  const pageErrors = []
  cdp.onEvent = (message) => collectPageError(message, pageErrors)

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('Log.enable', {}, sessionId)
  await cdp.send('Page.navigate', { url: viteUrl }, sessionId)
  await waitForReady(cdp, sessionId, STARTUP_TIMEOUT_MS)

  const evaluated = await cdp.send(
    'Runtime.evaluate',
    {
      expression:
        'window.__BENCH__ && typeof window.__BENCH__.runAll === "function" ? window.__BENCH__.runAll() : Promise.reject(new Error("window.__BENCH__ 未就绪"))',
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    },
    sessionId,
    RUN_TIMEOUT_MS,
  )
  if (evaluated.exceptionDetails) {
    const detail = evaluated.exceptionDetails
    const description = detail.exception?.description || detail.text || '页面执行失败'
    throw new Error(description)
  }

  const results = evaluated.result?.value
  if (!results) throw new Error('测量结果为空')

  if (args.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    printResults(results)
  }

  if (pageErrors.length) {
    const unique = Array.from(new Set(pageErrors)).filter(isUsefulPageError)
    if (unique.length) {
      console.error(`\n页面告警/错误（${unique.length}）：`)
      for (const line of unique.slice(0, 10)) console.error(`  - ${line}`)
    }
  }

  await cleanup()
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--help' || item === '-h') out.help = true
    else if (item === '--json') out.json = true
    else if (item === '--url') out.url = argv[++i]
    else if (item === '--port') out.port = argv[++i]
    else if (item === '--timeout') out.timeout = argv[++i]
    else if (item === '--run-timeout') out.runTimeout = argv[++i]
    else if (item === '--chrome') out.chrome = argv[++i]
    else throw new Error(`未知参数：${item}`)
  }
  return out
}

function printHelp() {
  console.log(`用法：node bench/run-bench.mjs [选项]

选项：
  --url <url>          复用已启动的 bench 页面（跳过 Vite 启动）
  --port <port>        Vite 端口，默认自动选择（从 1459 开始）
  --chrome <path>      Chrome/Edge 可执行文件路径
  --timeout <ms>       页面就绪超时，默认 120000
  --run-timeout <ms>   测量执行超时，默认 600000
  --json               输出 JSON 而不是表格
  -h, --help           显示帮助

环境变量：
  CHROME_PATH / CHROME_BIN / EDGE_PATH  浏览器路径

本脚本会启动并最终关闭自己创建的 Vite 与无头浏览器进程。`)
}

function findChrome() {
  const envCandidates = [args.chrome, process.env.CHROME_PATH, process.env.CHROME_BIN, process.env.EDGE_PATH, process.env.PUPPETEER_EXECUTABLE_PATH]
  for (const candidate of envCandidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/microsoft-edge',
          ]

  return candidates.find((candidate) => candidate && existsSync(candidate)) || ''
}

async function findFreePort(start) {
  const net = await import('node:net')
  for (let port = start; port < start + 80; port += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => server.close(() => resolve(true)))
      server.listen(port, '127.0.0.1')
    })
    if (free) return port
  }
  throw new Error(`在 ${start} 附近找不到空闲端口`)
}

async function startVite(port) {
  const viteBin = path.join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  viteChild = spawn(
    process.execPath,
    [viteBin, '--config', path.join('bench', 'vite.bench.config.ts'), '--port', String(port), '--strictPort'],
    {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  viteChild.stdout.on('data', (chunk) => {
    viteLog += String(chunk)
    if (viteLog.length > 20000) viteLog = viteLog.slice(-20000)
  })
  viteChild.stderr.on('data', (chunk) => {
    viteLog += String(chunk)
    if (viteLog.length > 20000) viteLog = viteLog.slice(-20000)
  })
  viteChild.once('exit', (code) => {
    if (code && code !== 0) viteLog += `\n[vite exited with code ${code}]`
  })

  const url = `http://127.0.0.1:${port}/`
  const deadline = Date.now() + Number(args.timeout || 120000)
  while (Date.now() < deadline) {
    if (viteChild.exitCode != null) {
      throw new Error(`Vite 启动失败（退出码 ${viteChild.exitCode}）。`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return url
    } catch {
      // 还没起来，继续等。
    }
    await sleep(200)
  }
  throw new Error(`等待 Vite 就绪超时：${url}`)
}

async function launchChrome(chromePath) {
  const tempRoot = existsSync('E:\\Temp\\opencode') ? 'E:\\Temp\\opencode' : os.tmpdir()
  profileDir = mkdtempSync(path.join(tempRoot, 'fw-render-bench-'))

  const chromeArgs = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
    '--window-size=1440,1000',
    'about:blank',
  ]
  if (process.platform === 'linux') chromeArgs.unshift('--no-sandbox')

  chromeChild = spawn(chromePath, chromeArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  chromeChild.stderr.on('data', (chunk) => {
    chromeLog += String(chunk)
    if (chromeLog.length > 20000) chromeLog = chromeLog.slice(-20000)
  })

  const portFile = path.join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (chromeChild.exitCode != null) {
      throw new Error(`无头浏览器启动失败（退出码 ${chromeChild.exitCode}）。`)
    }
    if (existsSync(portFile)) {
      const lines = readFileSync(portFile, 'utf8').split(/\r?\n/)
      const port = Number(lines[0])
      const wsPath = String(lines[1] || '').trim()
      if (port && wsPath) {
        const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${wsPath}`)
        return { cdp }
      }
    }
    await sleep(100)
  }
  throw new Error('等待 DevToolsActivePort 超时（浏览器仍未就绪）。')
}

async function waitForReady(cdp, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const result = await cdp.send(
        'Runtime.evaluate',
        {
          expression: 'window.__BENCH_READY__ === true ? "ready" : (window.__BENCH_ERROR__ || "")',
          returnByValue: true,
        },
        sessionId,
        10000,
      )
      const value = String(result.result?.value || '')
      if (value === 'ready') return
      if (value) throw new Error(`页面启动失败：\n${value}`)
    } catch (error) {
      lastError = error?.message || String(error)
    }
    await sleep(250)
  }
  throw new Error(`等待页面 ready 超时。${lastError ? `\n最后错误：${lastError}` : ''}`)
}

function collectPageError(message, out) {
  if (message.method === 'Runtime.exceptionThrown') {
    const detail = message.params?.exceptionDetails
    out.push(detail?.exception?.description || detail?.text || 'Runtime exception')
    return
  }
  if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
    const entry = message.params.entry
    out.push(`${entry.text}${entry.url ? ` (${entry.url})` : ''}`)
    return
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    const text = (message.params.args || [])
      .map((arg) => arg.value ?? arg.description ?? '')
      .filter(Boolean)
      .join(' ')
    if (text) out.push(text)
  }
}

function isUsefulPageError(line) {
  const text = String(line || '')
  if (!text.trim()) return false
  if (text.includes('potentially unsafe when doing server-side rendering')) return false
  if (text.includes('Download the React DevTools')) return false
  if (text.includes('favicon.ico')) return false
  return true
}

function printResults(results) {
  printEnvironment(results)
  printSingle(results.single)
  printBatch(results.batch)
  printParallel(results.parallel)
  printWorkerScreen(results.workerScreen)
  printStaged(results.staged)
  printScroll(results.scroll)
  printNotes(results)
}

function printEnvironment(results) {
  const meta = results.meta
  console.log('环境')
  console.log(`  UA: ${meta.userAgent}`)
  console.log(`  hardwareConcurrency: ${meta.hardwareConcurrency}`)
  console.log(`  viewport: ${meta.viewport.width}x${meta.viewport.height}`)
  console.log(`  startedAt: ${meta.startedAt}\n`)
}

function printSingle(rows) {
  printTable(
    'a. 单条消息（渲染 + 强制排版；中位数）',
    ['样本', '引擎 ms', 'React+MUI ms', '引擎节点', '引擎高度', 'React 节点', 'React 高度'],
    rows.map((row) => [
      row.label,
      fixed(row.engineMs),
      fixed(row.reactMs),
      String(row.engineNodes),
      fixed(row.engineHeight),
      String(row.reactNodes),
      fixed(row.reactHeight),
    ]),
  )
}

function printBatch(rows) {
  const first = rows.find((row) => row.enginePerMessageMs > 0)
  const base = first ? first.enginePerMessageMs : 0
  printTable(
    'b/c. 批量消息（引擎 vs React+MUI；每消息成本 = 总耗时 / 条数）',
    ['条数', '引擎总 ms', '引擎/条', '引擎/条 ×最小批', 'React 总 ms', 'React/条', 'React/引擎'],
    rows.map((row) => [
      String(row.count),
      fixed(row.engineTotalMs),
      fixed(row.enginePerMessageMs),
      base > 0 ? `${fixed(row.enginePerMessageMs / base)}×` : '-',
      fixed(row.reactTotalMs),
      fixed(row.reactPerMessageMs),
      row.engineTotalMs > 0 ? `${fixed(row.reactTotalMs / row.engineTotalMs)}×` : '-',
    ]),
  )
  const perMessage = rows.map((row) => row.enginePerMessageMs).filter((value) => value > 0)
  if (perMessage.length) {
    const min = Math.min(...perMessage)
    const max = Math.max(...perMessage)
    console.log(`  引擎每消息成本区间：${fixed(min)} ~ ${fixed(max)} ms（×${fixed(max / min)}）`)
    console.log('  ×最小批接近 1 表示每条成本不随批量规模增长；明显上升说明出现超线性成本。\n')
  }
}

function printParallel(parallel) {
  const rows = [
    ['主线程 · 纯解析', fixed(parallel.mainParseMs), '-', fixed(parallel.mainParsePerMessageMs), '1.00×'],
  ]
  if (parallel.mainEngineReferenceMs) {
    rows.push([
      '主线程 · 完整引擎（参考）',
      fixed(parallel.mainEngineReferenceMs),
      '-',
      fixed(parallel.mainEngineReferencePerMessageMs),
      '-',
    ])
  }
  for (const worker of parallel.workers) {
    rows.push([
      `${worker.workers} 个 Worker`,
      fixed(worker.wallMs),
      fixed(worker.computeMs),
      fixed(worker.perMessageMs),
      `${worker.speedup}×`,
    ])
  }
  printTable(
    `d. 并行解析（${parallel.count} 条；纯解析不含消毒/DOM）`,
    ['模式', '墙钟 ms', '线程内计算 ms', '每条 ms', '相对主线程'],
    rows,
  )
}

function printWorkerScreen(row) {
  printTable(
    `e. Worker 产出 HTML 直接上屏（${row.count} 条；含强制排版）`,
    ['方式', '总 ms', '每条 ms'],
    [
      ['直接 innerHTML', fixed(row.injectMs), fixed(row.injectPerMessageMs)],
      ['主线程消毒 + innerHTML', fixed(row.sanitizeInjectMs), fixed(row.sanitizeInjectPerMessageMs)],
    ],
  )
}

function printStaged(rows) {
  const fixedRow = rows.find((row) => row.strategy === '现有固定等待')
  printTable(
    'f. 打开会话分批上屏（400 条；首屏 5，每批 10）',
    ['策略', '让出方式', '批次数', '总墙钟 ms', '挂载 ms', '等待 ms', '末尾排版 ms', '最长主线程块 ms', '相对固定等待'],
    rows.map((row) => [
      row.strategy,
      row.waitMode,
      String(row.batches),
      fixed(row.totalWallMs),
      fixed(row.mountMs),
      fixed(row.waitMs),
      fixed(row.finalLayoutMs),
      fixed(row.maxBlockMs),
      fixedRow && fixedRow.totalWallMs > 0 ? `${fixed(row.totalWallMs / fixedRow.totalWallMs)}×` : '-',
    ]),
  )
}

function printScroll(scroll) {
  printTable(
    'g. 滚动帧率（400 条已上屏消息；2000 ms 往返滚动）',
    ['帧数', '时长 ms', 'FPS', '掉帧数', '掉帧率', 'p95 帧间隔 ms', '最大帧间隔 ms', '节点数', '滚动高度'],
    [
      [
        String(scroll.frames),
        fixed(scroll.durationMs),
        fixed(scroll.fps),
        String(scroll.droppedFrames),
        `${fixed(scroll.droppedPct)}%`,
        fixed(scroll.p95FrameMs),
        fixed(scroll.maxFrameMs),
        String(scroll.nodes),
        String(scroll.scrollHeight),
      ],
    ],
  )
}

function printNotes(results) {
  const apply = results.staged.find((row) => row.strategy === '时间片让出')
  const fixedRow = results.staged.find((row) => row.strategy === '现有固定等待')
  console.log('说明')
  console.log('  - 单条/批量引擎列都包含渲染、消毒、DOM 提交和一次强制排版。')
  console.log('  - worker 解析只做字符串 → HTML；e 的消毒变体补上主线程消毒成本。')
  console.log('  - 并行表里的“线程内计算”是各 Worker 自计时之和，因此会大于墙钟。')
  if (apply && fixedRow) {
    const diff = fixedRow.totalWallMs - apply.totalWallMs
    const relation = diff >= 0 ? `多花 ${fixed(diff)} ms` : `少花 ${fixed(-diff)} ms`
    console.log(
      `  - 让出策略：${fixedRow.strategy} 比 ${apply.strategy} ${relation}（固定等待占其总墙钟 ${fixed((fixedRow.waitMs / fixedRow.totalWallMs) * 100)}%）。`,
    )
  }
  console.log('  - 掉帧阈值 = 60Hz 帧间隔的 1.5 倍（25 ms）；它是帧节奏掉帧，不是单次绘制耗时。')
  if (results.scroll.fps > 90) {
    console.log('  - 当前无头浏览器未锁 vsync，FPS 高于 60 仅作相对比较；掉帧率仍按 60Hz 阈值统计。')
  }
  console.log('  - 单条与批量均先预热；批量数字取多轮中位数，避免 JIT 与首用偏差。\n')
}

function printTable(title, headers, rows) {
  console.log(title)
  const matrix = [headers, ...rows.map((row) => row.map((cell) => String(cell)))]
  const widths = headers.map((_, index) => Math.max(...matrix.map((row) => displayWidth(row[index] || ''))))
  const line = (row) => `  ${row.map((cell, index) => pad(cell, widths[index])).join('  ')}`
  console.log(line(headers))
  console.log(`  ${widths.map((width) => '-'.repeat(width)).join('  ')}`)
  for (const row of rows) console.log(line(row.map((cell) => String(cell))))
  console.log('')
}

function displayWidth(text) {
  let width = 0
  for (const char of String(text)) {
    const code = char.codePointAt(0) || 0
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
        ? 2
        : 1
  }
  return width
}

function pad(text, width) {
  const value = String(text)
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)))
}

function fixed(value) {
  return Number(value || 0).toFixed(2)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '')
}

async function cleanup() {
  try {
    cdp?.close()
  } catch {
    // ignore
  }
  cdp = null

  for (const child of [chromeChild, viteChild]) {
    if (!child || child.exitCode != null) continue
    try {
      child.kill()
    } catch {
      // ignore
    }
  }
  await sleep(300)
  for (const child of [chromeChild, viteChild]) {
    if (!child || child.exitCode != null) continue
    try {
      child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }
  chromeChild = null
  viteChild = null

  if (profileDir) {
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      // Chrome 可能还短暂持有文件，交给系统临时目录清理。
    }
    profileDir = ''
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.onEvent = null
    ws.addEventListener('message', (event) => this.handleMessage(event))
    ws.addEventListener('close', () => this.rejectAll(new Error('CDP 连接已关闭')))
    ws.addEventListener('error', () => this.rejectAll(new Error('CDP 连接错误')))
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接 CDP 超时')), 10000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error(`连接 CDP 失败：${url}`))
      })
    })
    return new Cdp(ws)
  }

  send(method, params = {}, sessionId, timeoutMs = 60000) {
    const id = this.nextId
    this.nextId += 1
    const message = { id, method, params }
    if (sessionId) message.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP 超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.ws.send(JSON.stringify(message))
    })
  }

  handleMessage(event) {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (message.id) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${message.error.message}${message.error.data ? `：${message.error.data}` : ''}`))
      else pending.resolve(message.result)
      return
    }
    if (this.onEvent) this.onEvent(message)
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // ignore
    }
  }
}
