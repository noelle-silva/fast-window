import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(testsDir, '..', '..')
const protocolDir = path.join(appDir, '.fast-window-dev-protocol')
const protocolFile = path.join(protocolDir, 'fast-window-dev-protocol.json')
const toolFile = 'fast-window-dev-tool.mjs'
const receiptPrefix = 'FAST-WINDOW-DEV-RECEIPT: '

function readProtocol() {
  return JSON.parse(readFileSync(protocolFile, 'utf8'))
}

function parseReceipt(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith(receiptPrefix)) {
      return JSON.parse(lines[index].slice(receiptPrefix.length))
    }
  }
  return null
}

function runAction(action) {
  const child = spawnSync(process.execPath, [toolFile, action], { cwd: protocolDir, encoding: 'utf8' })
  return {
    status: child.status,
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    receipt: parseReceipt(child.stdout),
  }
}

test('协议字典动作引用的本地脚本都存在', () => {
  const protocol = readProtocol()
  assert.equal(protocol.runner, 'node')
  for (const [name, definition] of Object.entries(protocol.actions)) {
    const command = typeof definition === 'string' ? definition : definition.command
    assert.equal(typeof command, 'string', `动作 ${name} 缺少命令`)
    if (!command.startsWith('node ../scripts/')) continue
    const scriptRel = command.split(/\s+/)[1]
    assert.equal(existsSync(path.resolve(protocolDir, scriptRel)), true, `动作 ${name} 引用的脚本不存在: ${scriptRel}`)
  }
})

test('成品动作只做产出，商店化交给协议工具', () => {
  const actions = readProtocol().actions
  assert.deepEqual(Object.keys(actions.package.artifact).sort(), ['name', 'path', 'sha256'])
  assert.equal(actions.package.storePackage, true)
  for (const name of ['version-check', 'version-dry', 'version-patch', 'version-minor', 'version-major']) {
    assert.equal(typeof actions[name], 'string')
  }
})

test('应用协议不携带发布动作、发布逻辑与凭据', () => {
  const actions = readProtocol().actions
  for (const name of Object.keys(actions)) {
    assert.equal(name.startsWith('release'), false, `应用协议不允许携带发布动作: ${name}`)
  }
  for (const rel of [
    'scripts/release-app.mjs',
    'scripts/lib/v5-app-publishing.mjs',
    'scripts/lib/v5-download-store.mjs',
    'scripts/lib/github-release-assets.mjs',
    '.fast-window-dev-protocol/.env',
  ]) {
    assert.equal(existsSync(path.join(appDir, rel)), false, `应用侧不允许残留发布内容: ${rel}`)
  }
})

test('协议工具调度版本校验动作并回执成功', () => {
  const run = runAction('version-check')
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.receipt, '缺少回执')
  assert.equal(run.receipt.contractVersion, 1)
  assert.equal(run.receipt.action, 'version-check')
  assert.equal(run.receipt.status, 'succeeded')
  assert.match(run.receipt.data.result.currentVersion, /^\d+\.\d+\.\d+$/)
})

test('协议工具对未定义动作交出失败回执', () => {
  const run = runAction('not-exists')
  assert.equal(run.status, 1)
  assert.equal(run.receipt.status, 'failed')
  assert.match(run.receipt.error, /协议未定义动作/)
})
