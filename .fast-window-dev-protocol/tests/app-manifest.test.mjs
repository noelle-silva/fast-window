import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { manifestFacts, readManifest } from '../modules/fast-window-dev-app-manifest.mjs'

const desktop = {
  type: 'desktop-app',
  id: 'sample-app',
  name: 'Sample App',
  description: '样例应用',
  versionSource: 'release.json',
  package: { windowsExecutable: 'sample-app.exe', icon: 'assets/icon.svg' },
  commands: [{ id: 'open', title: '打开' }],
}

const service = {
  ...desktop,
  type: 'service-app',
  id: 'sample-service',
  service: {
    start: { args: ['--port', '8080'], environment: { MODE: 'prod' } },
    ready: { type: 'log', match: 'is ready', timeoutSeconds: 30 },
    stop: { type: 'terminate' },
  },
}

function withService(patch) {
  return { ...service, service: { ...service.service, ...patch } }
}

test('合法桌面应用清单提取出归一后的事实', () => {
  const facts = manifestFacts({ ...desktop, package: { windowsExecutable: 'bin\\sample-app.exe', icon: 'assets/icon.svg' } })
  assert.equal(facts.type, 'desktop-app')
  assert.equal(facts.executable, 'bin/sample-app.exe')
  assert.equal(facts.icon, 'assets/icon.svg')
  assert.equal(facts.service, undefined)
  assert.deepEqual(facts.commands, [{ id: 'open', title: '打开' }])
  assert.deepEqual(facts.reservedNameExemptions, [])
})

test('合法服务应用清单保留服务声明；start 与 timeoutSeconds 可省略', () => {
  assert.deepEqual(manifestFacts(service).service, service.service)
  const minimal = withService({ start: undefined, ready: { type: 'log', match: 'is ready' } })
  delete minimal.service.start
  assert.doesNotThrow(() => manifestFacts(minimal))
})

test('字段白名单：各层级出现未知字段都拒绝', () => {
  assert.throws(() => manifestFacts({ ...desktop, displayMode: 'default' }), /清单 顶层 含不支持的字段：displayMode/)
  assert.throws(() => manifestFacts({ ...desktop, package: { ...desktop.package, extra: 1 } }), /清单 package 含不支持的字段：extra/)
  assert.throws(() => manifestFacts({ ...desktop, commands: [{ id: 'open', title: '打开', hotkey: 'F1' }] }), /commands\[0\] 含不支持的字段：hotkey/)
  assert.throws(() => manifestFacts(withService({ restart: true })), /清单 service 含不支持的字段：restart/)
  assert.throws(() => manifestFacts(withService({ ready: { type: 'log', match: 'ok', pattern: 'x' } })), /service\.ready 含不支持的字段：pattern/)
  assert.throws(() => manifestFacts(withService({ start: { cwd: 'x' } })), /service\.start 含不支持的字段：cwd/)
  assert.throws(() => manifestFacts(withService({ stop: { type: 'terminate', signal: 9 } })), /service\.stop 含不支持的字段：signal/)
})

test('类型与服务段一致', () => {
  assert.throws(() => manifestFacts({ ...desktop, service: service.service }), /desktop-app 时不允许携带 service 段/)
  const { service: _omitted, ...withoutService } = service
  assert.throws(() => manifestFacts(withoutService), /service-app 时必须提供 service 段/)
  assert.throws(() => manifestFacts({ ...desktop, type: 'plugin' }), /type 必须为 desktop-app 或 service-app/)
})

test('服务声明结构与宿主口径一致', () => {
  for (const [patch, message] of [
    [{ ready: undefined }, /service\.ready 不能为空/],
    [{ stop: undefined }, /service\.stop 不能为空/],
    [{ ready: { type: 'http', match: 'ok' } }, /ready\.type 必须为 log：http/],
    [{ ready: { type: 'log', match: '  ' } }, /service\.ready\.match 不能为空/],
    [{ ready: { type: 'log', match: 'ok', timeoutSeconds: 0 } }, /timeoutSeconds 必须为正整数/],
    [{ ready: { type: 'log', match: 'ok', timeoutSeconds: 1.5 } }, /timeoutSeconds 必须为正整数/],
    [{ ready: { type: 'log', match: 'ok', timeoutSeconds: '30' } }, /timeoutSeconds 必须为正整数/],
    [{ stop: { type: 'kill' } }, /stop\.type 必须为 terminate：kill/],
    [{ start: { args: ['ok', 1] } }, /start\.args 必须是字符串数组/],
    [{ start: { environment: { 'A=B': 'x' } } }, /environment 变量名不合法：A=B/],
    [{ start: { environment: { A: 1 } } }, /environment 变量值不合法：A/],
    [{ start: { environment: { A: 'x\0y' } } }, /environment 变量值不合法：A/],
  ]) {
    const manifest = withService(patch)
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete manifest.service[key]
    assert.throws(() => manifestFacts(manifest), message)
  }
})

test('主程序、图标、版本源路径规则', () => {
  const withPackage = pkg => ({ ...desktop, package: { ...desktop.package, ...pkg } })
  assert.throws(() => manifestFacts(withPackage({ windowsExecutable: 'sample-app.bat' })), /必须指向 \.exe/)
  assert.throws(() => manifestFacts(withPackage({ windowsExecutable: '../sample-app.exe' })), /package\.windowsExecutable 不安全/)
  assert.throws(() => manifestFacts(withPackage({ icon: 'assets/icon.ico' })), /只支持 \.png 或 \.svg/)
  assert.throws(() => manifestFacts(withPackage({ icon: 'C:/icon.png' })), /package\.icon 不允许是绝对路径/)
  assert.throws(() => manifestFacts({ ...desktop, package: undefined }), /清单 package 必须是对象/)
  assert.throws(() => manifestFacts({ ...desktop, versionSource: '' }), /versionSource 不能为空/)
  assert.throws(() => manifestFacts({ ...desktop, name: ' ' }), /清单 name 不能为空/)
  assert.throws(() => manifestFacts({ ...desktop, id: 'a/b' }), /清单 id 不合法/)
})

test('快捷指令：数组、id 合法不重复、标题不超过 80 字', () => {
  assert.deepEqual(manifestFacts({ ...desktop, commands: undefined }).commands, [])
  assert.throws(() => manifestFacts({ ...desktop, commands: {} }), /commands 必须是数组/)
  assert.throws(() => manifestFacts({ ...desktop, commands: [{ id: 'a', title: '一' }, { id: 'a', title: '二' }] }), /commands\[1\]\.id 重复：a/)
  assert.throws(() => manifestFacts({ ...desktop, commands: [{ id: 'bad id', title: '一' }] }), /commands\[0\]\.id 不合法/)
  assert.throws(() => manifestFacts({ ...desktop, commands: [{ id: 'a', title: '' }] }), /commands\[0\]\.title 不能为空/)
  assert.doesNotThrow(() => manifestFacts({ ...desktop, commands: [{ id: 'a', title: '字'.repeat(80) }] }))
  assert.throws(() => manifestFacts({ ...desktop, commands: [{ id: 'a', title: '字'.repeat(81) }] }), /不能超过 80 字/)
})

test('保留目录名豁免声明按模板同一份规则校验', () => {
  const exemptions = [{ name: 'data', reason: 'Flutter 运行资源目录' }]
  assert.deepEqual(manifestFacts({ ...desktop, reservedNameExemptions: exemptions }).reservedNameExemptions, exemptions)
  assert.throws(() => manifestFacts({ ...desktop, reservedNameExemptions: [{ name: 'data' }] }), /reason 不能为空/)
})

test('读取清单：缺失与损坏都直接报错', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fw-manifest-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.throws(() => readManifest(dir), /找不到应用清单/)
})
