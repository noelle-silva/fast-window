import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const protocolDirName = '.fast-window-dev-protocol'
const protocolFileName = 'fast-window-dev-protocol.json'
const protocolToolPrefix = 'fast-window-dev-tool.'
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
  const result = spawnSync(command, [...runnerArgs, toolFile, action], { cwd: dir, stdio: 'inherit' })
  if (result.error) {
    throw new Error(`启动工具失败：${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`工具执行失败，退出码 ${result.status}`)
  }
}

async function main() {
  const { appName, action } = parseArgs(process.argv)
  const root = projectRoot()
  const dir = resolveProtocolDir(root, appName)
  const runner = readRunner(dir)
  const toolFile = findToolFile(dir)
  launchTool({ dir, runner, toolFile, action })
  console.log(`fast-window-dev-tool: ${appName} ${action} 执行成功`)
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
