import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { appRegistryFileName } from '../modules/fast-window-dev-app-registry.mjs'
import { parseArgs } from '../modules/fast-window-dev-cli-args.mjs'
import {
  checkDependencyParity,
  crateNameForNpmPackage,
  inspectDependencyParity,
  minorOf,
  rangeCrossesMinor,
} from '../modules/fast-window-dev-dependency-parity.mjs'

const centralDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templateDir = path.join(centralDir, 'app-template')
const templateTool = path.join(templateDir, 'fast-window-dev-tool.mjs')

function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function removeDir(target) {
  rmSync(target, { recursive: true, force: true })
}

function writeCargoLock(appDir, crates) {
  mkdirSync(path.join(appDir, 'src-tauri'), { recursive: true })
  const blocks = Object.entries(crates).map(([name, version]) => `[[package]]\nname = "${name}"\nversion = "${version}"\n`)
  writeFileSync(path.join(appDir, 'src-tauri', 'Cargo.lock'), blocks.join('\n'), 'utf8')
}

function writeInstalled(appDir, packageName, version) {
  const manifestDir = path.join(appDir, 'node_modules', ...packageName.split('/'))
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(path.join(manifestDir, 'package.json'), JSON.stringify({ name: packageName, version }), 'utf8')
}

// 造一个接入协议的应用根目录；deps 是 package.json 依赖，installed 是 node_modules 里实际装到的版本。
function createApp(root, name, { deps = {}, installed = {}, crates = {} } = {}) {
  const appDir = path.join(root, name)
  const protocolDir = path.join(appDir, '.fast-window-dev-protocol')
  mkdirSync(protocolDir, { recursive: true })
  cpSync(templateTool, path.join(protocolDir, 'fast-window-dev-tool.mjs'))
  cpSync(path.join(templateDir, 'fast-window-dev-protocol.json'), path.join(protocolDir, 'fast-window-dev-protocol.json'))
  writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: `app-${name}`, dependencies: deps }, null, 2), 'utf8')
  writeCargoLock(appDir, crates)
  for (const [packageName, version] of Object.entries(installed)) writeInstalled(appDir, packageName, version)
  return appDir
}

test('命令行：--check-deps 归入全局命令', () => {
  assert.deepEqual(parseArgs(['node', 'tool.mjs', '--check-deps']), { kind: 'check-deps' })
})

test('包名映射与次版本判定', () => {
  assert.equal(crateNameForNpmPackage('@tauri-apps/api'), 'tauri')
  assert.equal(crateNameForNpmPackage('@tauri-apps/cli'), 'tauri')
  assert.equal(crateNameForNpmPackage('@tauri-apps/plugin-clipboard-manager'), 'tauri-plugin-clipboard-manager')
  assert.equal(minorOf('2.11.5'), '2.11')

  assert.equal(rangeCrossesMinor('~2.11.0'), false)
  assert.equal(rangeCrossesMinor('2.11.1'), false)
  assert.equal(rangeCrossesMinor('^2.11.0'), true)
  assert.equal(rangeCrossesMinor('*'), true)
})

test('体检：已装次版本不符判漂移，区间过宽只算警告', t => {
  const root = makeTempDir('fw-deps-')
  t.after(() => removeDir(root))

  const driftDir = createApp(root, 'drift', {
    deps: { '@tauri-apps/api': '~2.11.0' },
    installed: { '@tauri-apps/api': '2.12.5' },
    crates: { tauri: '2.11.1' },
  })
  const [drifted] = inspectDependencyParity(driftDir).entries
  assert.equal(drifted.status, 'drift')
  assert.equal(drifted.suggestedRange, '~2.11.0')

  const looseDir = createApp(root, 'loose', {
    deps: { '@tauri-apps/api': '^2.11.0' },
    installed: { '@tauri-apps/api': '2.11.1' },
    crates: { tauri: '2.11.1' },
  })
  const [loose] = inspectDependencyParity(looseDir).entries
  assert.equal(loose.status, 'loose')

  const okDir = createApp(root, 'ok', {
    deps: { '@tauri-apps/api': '~2.11.0', '@tauri-apps/plugin-clipboard-manager': '~2.3.0' },
    installed: { '@tauri-apps/api': '2.11.1', '@tauri-apps/plugin-clipboard-manager': '2.3.3' },
    crates: { tauri: '2.11.1', 'tauri-plugin-clipboard-manager': '2.3.2' },
  })
  assert.deepEqual(inspectDependencyParity(okDir).entries.map(entry => entry.status), ['ok', 'ok'])
})

test('体检：Cargo.lock 缺对应 crate 判未绑定，非 Tauri 应用整体跳过', t => {
  const root = makeTempDir('fw-deps-')
  t.after(() => removeDir(root))

  const unboundDir = createApp(root, 'unbound', {
    deps: { '@tauri-apps/api': '~2.11.0' },
    installed: { '@tauri-apps/api': '2.11.1' },
    crates: {},
  })
  assert.deepEqual(inspectDependencyParity(unboundDir).entries.map(entry => entry.status), ['unbound'])

  const plainDir = path.join(root, 'plain')
  mkdirSync(plainDir)
  writeFileSync(path.join(plainDir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'utf8')
  assert.equal(inspectDependencyParity(plainDir).applicable, false)
})

test('汇总：逐应用给出失败、警告、一致、跳过、不可用', t => {
  const root = makeTempDir('fw-deps-')
  t.after(() => removeDir(root))

  const failing = createApp(root, 'failing', {
    deps: { '@tauri-apps/api': '~2.11.0' },
    installed: { '@tauri-apps/api': '2.12.5' },
    crates: { tauri: '2.11.0' },
  })
  const loose = createApp(root, 'loose', {
    deps: { '@tauri-apps/api': '^2.11.0' },
    installed: { '@tauri-apps/api': '2.11.1' },
    crates: { tauri: '2.11.0' },
  })
  const plain = path.join(root, 'plain')
  mkdirSync(plain)
  writeFileSync(path.join(plain, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }), 'utf8')

  const results = checkDependencyParity([
    { appName: 'failing', appDir: failing, ok: true },
    { appName: 'loose', appDir: loose, ok: true },
    { appName: 'plain', appDir: plain, ok: true },
    { appName: 'gone', appDir: path.join(root, 'gone'), ok: false, error: '应用目录不存在' },
  ])
  assert.deepEqual(results.map(app => [app.appName, app.status]), [
    ['failing', 'failing'],
    ['loose', 'loose'],
    ['plain', 'skipped'],
    ['gone', 'unavailable'],
  ])
})

// 端到端：中央工具拷到临时目录，注册应用后跑 --check-deps，漂移判失败、收窄后转警告。
test('中央工具端到端：--check-deps 对漂移判失败，收窄后放行', t => {
  const root = makeTempDir('fw-deps-e2e-')
  t.after(() => removeDir(root))
  const central = path.join(root, '.fast-window-dev-protocol')
  mkdirSync(central)
  cpSync(path.join(centralDir, 'fast-window-dev-tool.mjs'), path.join(central, 'fast-window-dev-tool.mjs'))
  cpSync(path.join(centralDir, 'modules'), path.join(central, 'modules'), { recursive: true })
  cpSync(templateDir, path.join(central, 'app-template'), { recursive: true })
  const appDir = createApp(path.join(root, 'apps'), 'demo', {
    deps: { '@tauri-apps/api': '~2.11.0' },
    installed: { '@tauri-apps/api': '2.12.5' },
    crates: { tauri: '2.11.0' },
  })
  const run = (...args) => spawnSync(process.execPath, [path.join(central, 'fast-window-dev-tool.mjs'), ...args], { cwd: root, encoding: 'utf8' })

  assert.equal(run('demo', '--register', appDir).status, 0)
  const failing = run('--check-deps')
  assert.equal(failing.status, 1)
  assert.match(failing.stdout, /\[失败\]\s+demo/)
  assert.match(failing.stdout, /建议 ~2\.11\.0/)

  writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ dependencies: { '@tauri-apps/api': '^2.11.0' } }), 'utf8')
  writeInstalled(appDir, '@tauri-apps/api', '2.11.1')
  const warned = run('--check-deps')
  assert.equal(warned.status, 0, warned.stdout + warned.stderr)
  assert.match(warned.stdout, /\[警告\]\s+demo/)

  const registry = JSON.parse(readFileSync(path.join(central, appRegistryFileName), 'utf8'))
  assert.equal(registry.apps.demo, appDir)
})
