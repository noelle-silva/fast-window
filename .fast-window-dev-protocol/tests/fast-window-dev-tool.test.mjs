import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { packZipDirectory, unpackZip } from '../app-template/fast-window-dev-tool.mjs'

const templateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app-template')
const toolFileName = 'fast-window-dev-tool.mjs'
const protocolFileName = 'fast-window-dev-protocol.json'
const receiptPrefix = 'FAST-WINDOW-DEV-RECEIPT: '
const isWindows = process.platform === 'win32'

const fixtureSource = exitCode => `import { readFileSync } from 'node:fs'
process.stdout.write(readFileSync('fixture-output.json', 'utf8'))
process.exitCode = ${exitCode}
`

function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function removeDir(target) {
  rmSync(target, { recursive: true, force: true })
}

function createProtocolDir(protocol, options = {}) {
  const dir = makeTempDir('fast-window-dev-protocol-')
  cpSync(path.join(templateDir, toolFileName), path.join(dir, toolFileName))
  writeFileSync(path.join(dir, protocolFileName), `${JSON.stringify(protocol, null, 2)}\n`, 'utf8')
  if (options.fixtureOutput !== undefined) {
    writeFileSync(path.join(dir, 'fixture-output.json'), options.fixtureOutput, 'utf8')
    writeFileSync(path.join(dir, 'fixture.mjs'), fixtureSource(options.fixtureExitCode ?? 0), 'utf8')
  }
  return dir
}

function runTool(dir, ...args) {
  const child = spawnSync(process.execPath, [toolFileName, ...args], { cwd: dir, encoding: 'utf8' })
  const stdout = child.stdout ?? ''
  return {
    code: child.status,
    stdout,
    stderr: child.stderr ?? '',
    receipt: findReceipt(stdout),
  }
}

function findReceipt(stdout) {
  const lines = stdout.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith(receiptPrefix)) {
      return JSON.parse(lines[index].slice(receiptPrefix.length))
    }
  }
  return null
}

function createBaseZip(sourceDir, zipPath) {
  if (isWindows) {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${zipPath}' -Force`],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)
    return
  }
  packZipDirectory(sourceDir, zipPath)
}

function extractZip(zipPath, targetDir) {
  if (isWindows) {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${targetDir}' -Force`],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)
    return
  }
  unpackZip(zipPath, targetDir)
}

test('模板字典复制后 helloworld 动作即可跑通', t => {
  const dir = makeTempDir('fast-window-dev-template-')
  t.after(() => removeDir(dir))
  cpSync(path.join(templateDir, toolFileName), path.join(dir, toolFileName))
  cpSync(path.join(templateDir, protocolFileName), path.join(dir, protocolFileName))

  const run = runTool(dir, 'helloworld')
  assert.equal(run.code, 0, run.stderr)
  assert.ok(run.stdout.split(/\r?\n/).includes('helloworld'))
  assert.deepEqual(run.receipt, {
    contractVersion: 1,
    action: 'helloworld',
    status: 'succeeded',
    exitCode: 0,
    error: '',
    data: { result: null, artifact: {} },
  })
})

test('未定义动作交出失败回执且工具退出码非零', t => {
  const dir = createProtocolDir({ runner: 'node', actions: { known: 'echo ok' } })
  t.after(() => removeDir(dir))

  const run = runTool(dir, 'missing')
  assert.equal(run.code, 1)
  assert.equal(run.receipt.status, 'failed')
  assert.equal(run.receipt.exitCode, null)
  assert.match(run.receipt.error, /协议未定义动作 "missing"/)
  assert.deepEqual(run.receipt.data, { result: null, artifact: {} })
})

test('缺少动作参数时交出失败回执', t => {
  const dir = createProtocolDir({ runner: 'node', actions: { known: 'echo ok' } })
  t.after(() => removeDir(dir))

  const run = runTool(dir)
  assert.equal(run.code, 1)
  assert.equal(run.receipt.action, '')
  assert.equal(run.receipt.status, 'failed')
  assert.match(run.receipt.error, /用法/)
})

test('命令 JSON 输出被解析并按点号路径提取字符串产物字段', t => {
  const payload = JSON.stringify({
    outer: { path: 'C:/out/box.zip', name: 'box.zip', sha256: 'abc123' },
    number: 42,
  })
  const dir = createProtocolDir(
    {
      runner: 'node',
      actions: {
        demo: {
          command: 'node fixture.mjs',
          artifact: {
            path: 'outer.path',
            name: 'outer.name',
            sha256: 'outer.sha256',
            missing: 'outer.missing',
            number: 'number',
          },
        },
      },
    },
    { fixtureOutput: payload },
  )
  t.after(() => removeDir(dir))

  const run = runTool(dir, 'demo')
  assert.equal(run.code, 0, run.stderr)
  assert.equal(run.receipt.status, 'succeeded')
  assert.deepEqual(run.receipt.data.result, JSON.parse(payload))
  assert.deepEqual(run.receipt.data.artifact, { path: 'C:/out/box.zip', name: 'box.zip', sha256: 'abc123' })
})

test('命令非零退出时回执失败但保留解析结果', t => {
  const payload = JSON.stringify({ stage: 'compile' })
  const dir = createProtocolDir(
    { runner: 'node', actions: { demo: 'node fixture.mjs' } },
    { fixtureOutput: payload, fixtureExitCode: 2 },
  )
  t.after(() => removeDir(dir))

  const run = runTool(dir, 'demo')
  assert.equal(run.code, 1)
  assert.equal(run.receipt.status, 'failed')
  assert.equal(run.receipt.exitCode, 2)
  assert.equal(run.receipt.error, '')
  assert.deepEqual(run.receipt.data.result, JSON.parse(payload))
})

test('命令输出末尾缺换行时回执仍独占一行', t => {
  const dir = createProtocolDir({ runner: 'node', actions: { demo: 'node fixture.mjs' } }, { fixtureOutput: 'tail' })
  t.after(() => removeDir(dir))

  const run = runTool(dir, 'demo')
  assert.equal(run.code, 0)
  assert.ok(run.receipt)
  const lines = run.stdout.split(/\r?\n/)
  assert.equal(lines[lines.length - 1], '')
  assert.ok(lines[lines.length - 2].startsWith(receiptPrefix))
})

test('协议文件缺 runner 声明之外的坏形态快速失败', t => {
  const dir = makeTempDir('fast-window-dev-bad-protocol-')
  t.after(() => removeDir(dir))
  cpSync(path.join(templateDir, toolFileName), path.join(dir, toolFileName))
  writeFileSync(path.join(dir, protocolFileName), '{"actions":{"bad":42}}\n', 'utf8')

  const run = runTool(dir, 'bad')
  assert.equal(run.code, 1)
  assert.match(run.receipt.error, /解析协议文件失败/)
})

test('storePackage 把基础成品包加工成可安装商店包', t => {
  const root = makeTempDir('fast-window-dev-store-root-')
  t.after(() => removeDir(root))
  const protocolDir = path.join(root, '.fast-window-dev-protocol')
  mkdirSync(path.join(protocolDir, 'assets'), { recursive: true })
  writeFileSync(path.join(root, 'release.json'), `${JSON.stringify({ version: '2.3.4' })}\n`, 'utf8')
  writeFileSync(path.join(protocolDir, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n', 'utf8')
  writeFileSync(
    path.join(protocolDir, 'fw-app.json'),
    `${JSON.stringify(
      {
        type: 'service-app',
        id: 'sample-app',
        name: 'sample-app',
        description: '样例应用',
        versionSource: 'release.json',
        package: {
          windowsExecutable: 'sample-app.exe',
          icon: '.fast-window-dev-protocol/assets/icon.svg',
        },
        service: {
          ready: { type: 'log', match: 'is ready' },
          stop: { type: 'terminate' },
        },
        displayMode: 'default',
        commands: [{ id: 'open', title: '打开' }],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  const baseDir = path.join(root, 'base')
  mkdirSync(baseDir)
  writeFileSync(path.join(baseDir, 'sample-app.exe'), 'fake-exe')
  writeFileSync(path.join(baseDir, 'README.md'), '# readme')
  const baseZip = path.join(root, 'sample-app_2.3.4_windows-x64.zip')
  createBaseZip(baseDir, baseZip)

  cpSync(path.join(templateDir, toolFileName), path.join(protocolDir, toolFileName))
  writeFileSync(
    path.join(protocolDir, protocolFileName),
    `${JSON.stringify(
      {
        runner: 'node',
        actions: {
          package: {
            command: 'node fixture.mjs',
            artifact: { path: 'ArchivePath', name: 'Manifest.archive.name' },
            storePackage: true,
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(
    path.join(protocolDir, 'fixture-output.json'),
    JSON.stringify({ ArchivePath: baseZip, Manifest: { archive: { name: path.basename(baseZip) } } }),
    'utf8',
  )
  writeFileSync(path.join(protocolDir, 'fixture.mjs'), fixtureSource(0), 'utf8')

  const run = runTool(protocolDir, 'package')
  assert.equal(run.code, 0, run.stderr)
  assert.equal(run.receipt.status, 'succeeded')
  assert.equal(run.receipt.data.result.ArchivePath, baseZip)
  const artifact = run.receipt.data.artifact
  assert.equal(artifact.name, path.basename(baseZip))
  assert.equal(artifact.path, path.join(protocolDir, 'dist', path.basename(baseZip)))
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/)

  const inspectDir = path.join(root, 'inspect')
  extractZip(artifact.path, inspectDir)
  const manifest = JSON.parse(readFileSync(path.join(inspectDir, 'fw-app.json'), 'utf8'))
  assert.equal(manifest.type, 'service-app')
  assert.equal(manifest.id, 'sample-app')
  assert.equal(manifest.version, '2.3.4')
  assert.equal(manifest.description, '样例应用')
  assert.equal(manifest.package.windowsExecutable, 'sample-app.exe')
  assert.equal(manifest.package.icon, 'assets/icon.svg')
  assert.deepEqual(manifest.service, {
    ready: { type: 'log', match: 'is ready' },
    stop: { type: 'terminate' },
  })
  assert.equal(manifest.displayMode, 'default')
  assert.deepEqual(manifest.commands, [{ id: 'open', title: '打开' }])
  assert.equal(manifest.versionSource, undefined)
  assert.equal(existsSync(path.join(inspectDir, 'sample-app.exe')), true)
  assert.equal(existsSync(path.join(inspectDir, 'README.md')), true)
  assert.match(readFileSync(path.join(inspectDir, 'assets', 'icon.svg'), 'utf8'), /<svg/)
})

test('storePackage 缺少成品路径时报失败回执', t => {
  const dir = createProtocolDir(
    {
      runner: 'node',
      actions: { package: { command: 'node fixture.mjs', storePackage: true } },
    },
    { fixtureOutput: '{}' },
  )
  t.after(() => removeDir(dir))

  const run = runTool(dir, 'package')
  assert.equal(run.code, 1)
  assert.equal(run.receipt.status, 'failed')
  assert.equal(run.receipt.exitCode, null)
  assert.match(run.receipt.error, /成品路径/)
})

test('商店化拒绝桌面应用携带 service 段', t => {
  const root = makeTempDir('fast-window-dev-store-invalid-')
  t.after(() => removeDir(root))
  const protocolDir = path.join(root, '.fast-window-dev-protocol')
  mkdirSync(protocolDir, { recursive: true })
  writeFileSync(
    path.join(protocolDir, 'fw-app.json'),
    `${JSON.stringify({
      type: 'desktop-app',
      id: 'sample-app',
      name: 'sample-app',
      versionSource: 'release.json',
      package: {},
      service: { stop: { type: 'terminate' } },
    })}\n`,
    'utf8',
  )
  writeFileSync(
    path.join(protocolDir, protocolFileName),
    `${JSON.stringify({
      runner: 'node',
      actions: {
        package: {
          command: `node -e "console.log(JSON.stringify({ ArchivePath: 'whatever.zip' }))"`,
          artifact: { path: 'ArchivePath' },
          storePackage: true,
        },
      },
    })}\n`,
    'utf8',
  )
  cpSync(path.join(templateDir, toolFileName), path.join(protocolDir, toolFileName))

  const run = runTool(protocolDir, 'package')
  assert.equal(run.code, 1)
  assert.match(run.receipt.error, /不允许携带 service 段/)
})
