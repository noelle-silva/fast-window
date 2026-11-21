import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  appRegistryFileName,
  inspectRegisteredApps,
  readAppRegistry,
  registerApp,
  resolveRegisteredApp,
} from '../modules/fast-window-dev-app-registry.mjs'
import { parseArgs } from '../modules/fast-window-dev-cli-args.mjs'
import { checkAppTemplates } from '../modules/fast-window-dev-template-check.mjs'

const centralDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templateDir = path.join(centralDir, 'app-template')
const templateTool = path.join(templateDir, 'fast-window-dev-tool.mjs')

function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function removeDir(target) {
  rmSync(target, { recursive: true, force: true })
}

// 造一个接入协议的应用根目录：协议目录里放模板两件套。
function createApp(root, name, { tool = true, dictionary = true } = {}) {
  const appDir = path.join(root, name)
  const protocolDir = path.join(appDir, '.fast-window-dev-protocol')
  mkdirSync(protocolDir, { recursive: true })
  if (tool) cpSync(templateTool, path.join(protocolDir, 'fast-window-dev-tool.mjs'))
  if (dictionary) cpSync(path.join(templateDir, 'fast-window-dev-protocol.json'), path.join(protocolDir, 'fast-window-dev-protocol.json'))
  return appDir
}

function argv(...args) {
  return ['node', 'fast-window-dev-tool.mjs', ...args]
}

test('参数解析：应用命令与全局命令各归其位', () => {
  assert.deepEqual(parseArgs(argv('ai-draw', 'stage-dev')), { kind: 'action', appName: 'ai-draw', action: 'stage-dev', mode: '' })
  assert.deepEqual(parseArgs(argv('ai-draw', 'package', 'release')), { kind: 'action', appName: 'ai-draw', action: 'package', mode: 'release' })
  assert.deepEqual(parseArgs(argv('ai-draw', '--register', 'E:\\x\\ai-draw')), { kind: 'register', appName: 'ai-draw', appDir: 'E:\\x\\ai-draw' })
  assert.deepEqual(parseArgs(argv('ai-draw', '--verify', '--zip', 'a.zip')), { kind: 'verify', appName: 'ai-draw', zip: 'a.zip', catalog: '' })
  assert.deepEqual(parseArgs(argv('ai-draw', '--unpublish', '--dry-run')), { kind: 'unpublish', appName: 'ai-draw', dryRun: true })
  assert.deepEqual(parseArgs(argv('--list')), { kind: 'list' })
  assert.deepEqual(parseArgs(argv('--check-templates')), { kind: 'check-templates' })
})

test('参数解析：坏形态快速失败', () => {
  assert.throws(() => parseArgs(argv()), /用法/)
  assert.throws(() => parseArgs(argv('ai-draw')), /用法/)
  assert.throws(() => parseArgs(argv('--list', 'extra')), /不接受额外参数/)
  assert.throws(() => parseArgs(argv('--nope')), /不支持的全局命令/)
  assert.throws(() => parseArgs(argv('ai-draw', '--nope')), /不支持的应用命令/)
  assert.throws(() => parseArgs(argv('ai-draw', '--register')), /--register 需要/)
  assert.throws(() => parseArgs(argv('ai-draw', 'package', 'publish')), /暂不支持的第三参数/)
})

test('登记：接入协议的绝对路径写入注册表，并按应用名排序', t => {
  const root = makeTempDir('fw-registry-')
  t.after(() => removeDir(root))
  const registryFile = path.join(root, appRegistryFileName)

  const first = registerApp(registryFile, 'zeta', createApp(root, 'zeta'))
  assert.equal(first.previousDir, '')
  registerApp(registryFile, 'alpha', createApp(root, 'alpha'))

  const saved = JSON.parse(readFileSync(registryFile, 'utf8'))
  assert.deepEqual(Object.keys(saved.apps), ['alpha', 'zeta'])
  assert.equal(saved.apps.alpha, path.join(root, 'alpha'))
})

test('登记：同名再登记改写路径并回报旧路径', t => {
  const root = makeTempDir('fw-registry-')
  t.after(() => removeDir(root))
  const registryFile = path.join(root, appRegistryFileName)
  const oldDir = createApp(root, 'old-home')
  const newDir = createApp(root, 'new-home')

  registerApp(registryFile, 'demo', oldDir)
  const moved = registerApp(registryFile, 'demo', newDir)
  assert.equal(moved.previousDir, oldDir)
  assert.equal(readAppRegistry(registryFile).demo, newDir)
})

test('登记：相对路径、不存在、未接入协议、非法应用名都拒绝且不写盘', t => {
  const root = makeTempDir('fw-registry-')
  t.after(() => removeDir(root))
  const registryFile = path.join(root, appRegistryFileName)

  assert.throws(() => registerApp(registryFile, 'demo', 'relative/app'), /必须是绝对路径/)
  assert.throws(() => registerApp(registryFile, 'demo', path.join(root, 'missing')), /应用目录不存在/)
  mkdirSync(path.join(root, 'bare'))
  assert.throws(() => registerApp(registryFile, 'demo', path.join(root, 'bare')), /缺少协议目录/)
  assert.throws(() => registerApp(registryFile, 'demo', createApp(root, 'no-dict', { dictionary: false })), /缺少动作字典/)
  assert.throws(() => registerApp(registryFile, 'demo', createApp(root, 'no-tool', { tool: false })), /找不到应用工具/)
  assert.throws(() => registerApp(registryFile, '../evil', createApp(root, 'ok')), /应用名不合法/)
  assert.deepEqual(readAppRegistry(registryFile), {})
})

test('寻址：只认注册表，未登记与登记失效都直接报错', t => {
  const root = makeTempDir('fw-registry-')
  t.after(() => removeDir(root))
  const registryFile = path.join(root, appRegistryFileName)
  const appDir = createApp(root, 'demo')

  assert.throws(() => resolveRegisteredApp(registryFile, 'demo'), /应用未登记：demo/)
  registerApp(registryFile, 'demo', appDir)
  const resolved = resolveRegisteredApp(registryFile, 'demo')
  assert.equal(resolved.protocolDir, path.join(appDir, '.fast-window-dev-protocol'))
  assert.equal(resolved.toolFile, 'fast-window-dev-tool.mjs')

  removeDir(appDir)
  assert.throws(() => resolveRegisteredApp(registryFile, 'demo'), /应用目录不存在/)
})

test('注册表坏形态快速失败', t => {
  const root = makeTempDir('fw-registry-')
  t.after(() => removeDir(root))
  const registryFile = path.join(root, appRegistryFileName)

  writeFileSync(registryFile, '{ broken', 'utf8')
  assert.throws(() => readAppRegistry(registryFile), /解析失败/)
  writeFileSync(registryFile, '{"apps":[]}', 'utf8')
  assert.throws(() => readAppRegistry(registryFile), /缺少 apps 对象/)
  writeFileSync(registryFile, '{"apps":{"demo":"relative/dir"}}', 'utf8')
  assert.throws(() => readAppRegistry(registryFile), /必须是绝对路径/)
})

test('体检与模板比对：逐条给出可用、过期、不可用', t => {
  const root = makeTempDir('fw-registry-')
  t.after(() => removeDir(root))
  const registryFile = path.join(root, appRegistryFileName)
  registerApp(registryFile, 'fresh', createApp(root, 'fresh'))
  const staleDir = createApp(root, 'stale')
  registerApp(registryFile, 'stale', staleDir)
  writeFileSync(path.join(staleDir, '.fast-window-dev-protocol', 'fast-window-dev-tool.mjs'), '// 旧版本\n', 'utf8')
  const goneDir = createApp(root, 'gone')
  registerApp(registryFile, 'gone', goneDir)
  removeDir(goneDir)

  const inspected = inspectRegisteredApps(registryFile)
  assert.deepEqual(inspected.map(app => [app.appName, app.ok]), [['fresh', true], ['gone', false], ['stale', true]])

  const checked = checkAppTemplates(inspected, templateTool)
  assert.deepEqual(checked.map(item => [item.appName, item.status]), [['fresh', 'up-to-date'], ['gone', 'unavailable'], ['stale', 'outdated']])
})

test('模板比对忽略换行符差异：LF 与 CRLF 检出都算一致', t => {
  const root = makeTempDir('fw-registry-')
  t.after(() => removeDir(root))
  const registryFile = path.join(root, appRegistryFileName)
  const lfText = readFileSync(templateTool, 'utf8').replace(/\r\n/g, '\n')
  for (const [name, text] of [['lf-app', lfText], ['crlf-app', lfText.replace(/\n/g, '\r\n')]]) {
    const appDir = createApp(root, name)
    writeFileSync(path.join(appDir, '.fast-window-dev-protocol', 'fast-window-dev-tool.mjs'), text, 'utf8')
    registerApp(registryFile, name, appDir)
  }

  const checked = checkAppTemplates(inspectRegisteredApps(registryFile), templateTool)
  assert.deepEqual(checked.map(item => [item.appName, item.status]), [['crlf-app', 'up-to-date'], ['lf-app', 'up-to-date']])
})

// 端到端：把中央工具拷到临时目录（注册表随工具目录走），从登记到派发完整跑一遍。
test('中央工具端到端：登记、列表、模板检查、按注册表派发动作', t => {
  const root = makeTempDir('fw-central-')
  t.after(() => removeDir(root))
  const central = path.join(root, '.fast-window-dev-protocol')
  mkdirSync(central)
  cpSync(path.join(centralDir, 'fast-window-dev-tool.mjs'), path.join(central, 'fast-window-dev-tool.mjs'))
  cpSync(path.join(centralDir, 'modules'), path.join(central, 'modules'), { recursive: true })
  cpSync(templateDir, path.join(central, 'app-template'), { recursive: true })
  const appDir = createApp(path.join(root, 'elsewhere'), 'outside-app')
  const run = (...args) => spawnSync(process.execPath, [path.join(central, 'fast-window-dev-tool.mjs'), ...args], { cwd: root, encoding: 'utf8' })

  const unregistered = run('outside-app', 'helloworld')
  assert.equal(unregistered.status, 1)
  assert.match(unregistered.stderr, /应用未登记：outside-app/)

  const registered = run('outside-app', '--register', appDir)
  assert.equal(registered.status, 0, registered.stderr)
  assert.match(registered.stdout, /已登记 outside-app/)

  const listed = run('--list')
  assert.equal(listed.status, 0, listed.stderr)
  assert.match(listed.stdout, /\[可用\]\s+outside-app/)

  const checked = run('--check-templates')
  assert.equal(checked.status, 0, checked.stderr)
  assert.match(checked.stdout, /\[一致\]\s+outside-app/)

  const dispatched = run('outside-app', 'helloworld')
  assert.equal(dispatched.status, 0, dispatched.stderr)
  assert.match(dispatched.stdout, /outside-app helloworld 执行成功/)

  removeDir(appDir)
  const broken = run('--list')
  assert.equal(broken.status, 1)
  assert.match(broken.stdout, /\[不可用\] outside-app/)
})
