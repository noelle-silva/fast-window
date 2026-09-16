import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const protocolDirName = '.fast-window-dev-protocol'
const protocolFileName = 'fast-window-dev-protocol.json'
const protocolToolPrefix = 'fast-window-dev-tool.'
const receiptPrefix = 'FAST-WINDOW-DEV-RECEIPT: '
const contractVersion = 1
const usageLine = '用法：node .fast-window-dev-protocol/fast-window-dev-tool.mjs <应用名> <动作代号>'

function isSafeSegment(value) {
  return value !== '' && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

function parseArgs(argv) {
  const args = argv.slice(2)
  if (args.length !== 2 || !isSafeSegment(args[0]) || !isSafeSegment(args[1])) {
    throw new Error(usageLine)
  }
  return { appName: args[0], action: args[1] }
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
  const { appName, action } = parseArgs(process.argv)
  const root = projectRoot()
  const dir = resolveProtocolDir(root, appName)
  const runner = readRunner(dir)
  const toolFile = findToolFile(dir)
  const { status, stdout } = await launchTool({ dir, runner, toolFile, action })
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
  console.log(`fast-window-dev-tool: ${appName} ${action} 执行成功`)
  const artifactPath = receipt.data?.artifact?.path
  if (typeof artifactPath === 'string' && artifactPath !== '') {
    console.log(`fast-window-dev-tool: 成品 ${artifactPath}`)
  }
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
