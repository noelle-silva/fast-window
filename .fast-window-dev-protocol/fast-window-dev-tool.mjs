import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { publishArtifactToStore } from './modules/fast-window-dev-release.mjs'
import { unpublishAppFromStore } from './modules/fast-window-dev-unpublish.mjs'
import { verifyAppArtifact } from './modules/fast-window-dev-verify.mjs'

const protocolDirName = '.fast-window-dev-protocol'
const protocolFileName = 'fast-window-dev-protocol.json'
const protocolToolPrefix = 'fast-window-dev-tool.'
const receiptPrefix = 'FAST-WINDOW-DEV-RECEIPT: '
const contractVersion = 1
const releaseMode = 'release'
const usageLine = [
  '用法：',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用名> <动作代号> [release]',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用名> --verify [--zip <成品包>] [--catalog <本地目录文件>]',
  '  node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用名> --unpublish [--dry-run]',
].join('\n')

// 中央协议目录：调度工具所在目录，也是发布模式唯一的凭据来源。
const toolDir = path.dirname(fileURLToPath(import.meta.url))

function isSafeSegment(value) {
  return value !== '' && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

function parseActionArgs(args) {
  if (args.length > 3 || !isSafeSegment(args[1])) {
    throw new Error(usageLine)
  }
  const mode = args[2] ?? ''
  if (mode !== '' && mode !== releaseMode) {
    throw new Error(`暂不支持的第三参数：${mode}（目前只支持 release）`)
  }
  return { kind: 'action', appName: args[0], action: args[1], mode }
}

function parseVerifyArgs(args) {
  const out = { kind: 'verify', appName: args[0], zip: '', catalog: '' }
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--zip' && i + 1 < args.length) {
      out.zip = String(args[++i] || '').trim()
      if (!out.zip) throw new Error('--zip 不能为空')
      continue
    }
    if (arg === '--catalog' && i + 1 < args.length) {
      out.catalog = String(args[++i] || '').trim()
      if (!out.catalog) throw new Error('--catalog 不能为空')
      continue
    }
    throw new Error(`--verify 不支持的参数：${arg}\n${usageLine}`)
  }
  return out
}

function parseUnpublishArgs(args) {
  const out = { kind: 'unpublish', appName: args[0], dryRun: false }
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--dry-run') {
      out.dryRun = true
      continue
    }
    throw new Error(`--unpublish 不支持的参数：${arg}\n${usageLine}`)
  }
  return out
}

function parseArgs(argv) {
  const args = argv.slice(2)
  if (args.length < 2 || !isSafeSegment(args[0])) {
    throw new Error(usageLine)
  }
  if (args[1] === '--verify') return parseVerifyArgs(args)
  if (args[1] === '--unpublish') return parseUnpublishArgs(args)
  return parseActionArgs(args)
}

function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function resolveProtocolDir(root, appName) {
  const dir = path.join(root, 'apps', appName, protocolDirName)
  if (!existsSync(dir)) {
    throw new Error(`找不到应用协议目录：apps/${appName}/${protocolDirName}`)
  }
  return dir
}

function readRunner(dir) {
  const file = path.join(dir, protocolFileName)
  if (!existsSync(file)) {
    throw new Error(`找不到协议文件：${protocolFileName}`)
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`解析协议文件失败：${error.message}`)
  }
  const runner = typeof parsed.runner === 'string' ? parsed.runner.trim() : ''
  if (runner === '') {
    throw new Error(`协议文件缺少 runner 声明：${protocolFileName}`)
  }
  return runner
}

function findToolFile(dir) {
  const toolFile = readdirSync(dir).find(
    entry => entry.startsWith(protocolToolPrefix) && statSync(path.join(dir, entry)).isFile(),
  )
  if (!toolFile) {
    throw new Error(`协议目录内找不到工具文件：${protocolToolPrefix}*`)
  }
  return toolFile
}

function launchTool({ dir, runner, toolFile, action }) {
  const [command, ...runnerArgs] = runner.split(/\s+/)
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...runnerArgs, toolFile, action], {
      cwd: dir,
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => process.stderr.write(chunk))
    child.on('error', error => reject(new Error(`启动工具失败：${error.message}`)))
    child.on('close', status => resolve({ status, stdout }))
  })
}

function parseReceipt(stdout) {
  const lines = stdout.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line.startsWith(receiptPrefix)) {
      continue
    }
    try {
      return JSON.parse(line.slice(receiptPrefix.length))
    } catch (error) {
      throw new Error(`回执解析失败：${error.message}`)
    }
  }
  return null
}

async function main() {
  const parsed = parseArgs(process.argv)
  const root = projectRoot()
  const dir = resolveProtocolDir(root, parsed.appName)

  if (parsed.kind === 'verify') {
    const result = await verifyAppArtifact({
      protocolDir: dir,
      artifactPath: parsed.zip,
      catalogPath: parsed.catalog,
    })
    console.log(JSON.stringify(result))
    console.log(`fast-window-dev-tool: ${parsed.appName} 校验通过（v${result.version}，sha256 ${result.artifact.sha256}）`)
    return
  }

  if (parsed.kind === 'unpublish') {
    const result = await unpublishAppFromStore({
      protocolDir: dir,
      credentialsDir: toolDir,
      dryRun: parsed.dryRun,
    })
    console.log(JSON.stringify(result))
    console.log(`fast-window-dev-tool: ${parsed.appName} 下架${result.dryRun ? '预演' : ''}完成（移除 ${result.removed.id} v${result.removed.version}）`)
    return
  }

  const runner = readRunner(dir)
  const toolFile = findToolFile(dir)
  const { status, stdout } = await launchTool({ dir, runner, toolFile, action: parsed.action })
  const receipt = parseReceipt(stdout)
  if (!receipt) {
    throw new Error(`未收到工具回执，退出码 ${status}`)
  }
  if (receipt.contractVersion !== contractVersion) {
    throw new Error(`回执契约版本不匹配：期望 ${contractVersion}，收到 ${receipt.contractVersion}`)
  }
  if (receipt.status !== 'succeeded') {
    throw new Error(receipt.error || `工具执行失败，退出码 ${receipt.exitCode ?? status}`)
  }
  console.log(`fast-window-dev-tool: ${parsed.appName} ${parsed.action} 执行成功`)
  const artifactPath = typeof receipt.data?.artifact?.path === 'string' ? receipt.data.artifact.path : ''
  if (artifactPath !== '') {
    console.log(`fast-window-dev-tool: 成品 ${artifactPath}`)
  }
  if (parsed.mode === releaseMode) {
    if (artifactPath === '') {
      throw new Error(`动作 ${parsed.action} 没有可发布的成品`)
    }
    const published = await publishArtifactToStore({ protocolDir: dir, credentialsDir: toolDir, artifactPath })
    console.log(`fast-window-dev-tool: 已发布 ${published.appId} ${published.version}`)
    console.log(`fast-window-dev-tool: 发布地址 ${published.releaseUrl}`)
    console.log(`fast-window-dev-tool: 商店目录 ${published.catalogUrl}`)
  }
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
