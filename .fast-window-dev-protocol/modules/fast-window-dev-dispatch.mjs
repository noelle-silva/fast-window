// 动作派发：按应用动作字典声明的 runner 启动应用工具，收取并校验回执。

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { appProtocolFileName } from './fast-window-dev-app-registry.mjs'

const receiptPrefix = 'FAST-WINDOW-DEV-RECEIPT: '
const contractVersion = 1

function readRunner(protocolDir) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path.join(protocolDir, appProtocolFileName), 'utf8'))
  } catch (error) {
    throw new Error(`解析协议文件失败：${error.message}`)
  }
  const runner = typeof parsed.runner === 'string' ? parsed.runner.trim() : ''
  if (runner === '') throw new Error(`协议文件缺少 runner 声明：${appProtocolFileName}`)
  return runner
}

function launchTool({ protocolDir, runner, toolFile, action }) {
  const [command, ...runnerArgs] = runner.split(/\s+/)
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...runnerArgs, toolFile, action], {
      cwd: protocolDir,
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
    if (!line.startsWith(receiptPrefix)) continue
    try {
      return JSON.parse(line.slice(receiptPrefix.length))
    } catch (error) {
      throw new Error(`回执解析失败：${error.message}`)
    }
  }
  return null
}

// 执行应用动作并返回成功回执；未收到回执、契约版本不符、执行失败都直接报错。
export async function dispatchAppAction({ protocolDir, toolFile, action }) {
  const runner = readRunner(protocolDir)
  const { status, stdout } = await launchTool({ protocolDir, runner, toolFile, action })
  const receipt = parseReceipt(stdout)
  if (!receipt) throw new Error(`未收到工具回执，退出码 ${status}`)
  if (receipt.contractVersion !== contractVersion) {
    throw new Error(`回执契约版本不匹配：期望 ${contractVersion}，收到 ${receipt.contractVersion}`)
  }
  if (receipt.status !== 'succeeded') {
    throw new Error(receipt.error || `工具执行失败，退出码 ${receipt.exitCode ?? status}`)
  }
  return receipt
}
