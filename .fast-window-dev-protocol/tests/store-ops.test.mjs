import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { packZipDirectory } from '../app-template/fast-window-dev-tool.mjs'
import { unpublishAppFromStore } from '../modules/fast-window-dev-unpublish.mjs'
import { verifyAppArtifact } from '../modules/fast-window-dev-verify.mjs'

const sourceManifest = {
  type: 'desktop-app',
  id: 'sample-app',
  name: 'Sample App',
  description: '样例应用',
  versionSource: 'release.json',
  package: { windowsExecutable: 'sample-app.exe', icon: 'assets/icon.svg' },
  displayMode: 'default',
  commands: [{ id: 'open', title: '打开' }],
}

async function createVerifyFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-store-ops-'))
  const protocolDir = path.join(root, '.fast-window-dev-protocol')
  await fs.mkdir(protocolDir, { recursive: true })
  await fs.writeFile(path.join(root, 'release.json'), JSON.stringify({ version: '1.2.3' }), 'utf8')
  const sourceIconPath = options.sourceIconPath ?? 'assets/icon.svg'
  await fs.mkdir(path.dirname(path.join(root, sourceIconPath)), { recursive: true })
  await fs.writeFile(path.join(root, sourceIconPath), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')
  const manifest = { ...sourceManifest, ...options.sourceOverrides }
  await fs.writeFile(path.join(protocolDir, 'fw-app.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const packageDir = path.join(root, 'package-src')
  await fs.mkdir(path.join(packageDir, 'assets'), { recursive: true })
  if (!options.omitExe) await fs.writeFile(path.join(packageDir, 'sample-app.exe'), 'fake-exe', 'utf8')
  if (!options.omitIcon) await fs.writeFile(path.join(packageDir, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')
  const packagedManifest = {
    type: manifest.type,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: '1.2.3',
    package: { ...manifest.package },
    displayMode: manifest.displayMode,
    commands: manifest.commands,
    ...options.packagedOverrides,
  }
  if (options.omitPackagedCommands) delete packagedManifest.commands
  await fs.writeFile(path.join(packageDir, 'fw-app.json'), `${JSON.stringify(packagedManifest, null, 2)}\n`, 'utf8')

  const distDir = path.join(protocolDir, 'dist')
  await fs.mkdir(distDir, { recursive: true })
  const zipPath = path.join(distDir, options.zipName ?? 'sample-app-1.2.3-windows.zip')
  packZipDirectory(packageDir, zipPath)
  return { root, protocolDir, zipPath }
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

test('独立校验通过结构完整的商店包并输出摘要', async t => {
  const fixture = await createVerifyFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  const result = await verifyAppArtifact({ protocolDir: fixture.protocolDir })
  assert.equal(result.appId, 'sample-app')
  assert.equal(result.version, '1.2.3')
  assert.match(result.artifact.sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(result.checks.map(check => check.name), [
    'packaged-manifest',
    'icon',
    'windows-executable',
    'no-reserved-data-dir',
  ])
  assert.equal(result.catalog, null)
})

test('独立校验语义归一：包内未携带快捷指令等同空列表', async t => {
  const fixture = await createVerifyFixture({ sourceOverrides: { commands: [] }, omitPackagedCommands: true })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  const result = await verifyAppArtifact({ protocolDir: fixture.protocolDir })
  assert.equal(result.appId, 'sample-app')
})

test('独立校验默认定位产出区成品，不按命名猜测', async t => {
  const fixture = await createVerifyFixture({ zipName: 'sample-app_1.2.3_windows-x64.zip' })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  const result = await verifyAppArtifact({ protocolDir: fixture.protocolDir })
  assert.equal(result.artifact.fileName, 'sample-app_1.2.3_windows-x64.zip')
})

test('独立校验在多个成品中选取最新修改的一个', async t => {
  const fixture = await createVerifyFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  const staleZip = path.join(fixture.protocolDir, 'dist', 'sample-app-0.9.9-windows.zip')
  await fs.copyFile(fixture.zipPath, staleZip)
  const past = new Date(Date.now() - 60_000)
  await fs.utimes(staleZip, past, past)

  const result = await verifyAppArtifact({ protocolDir: fixture.protocolDir })
  assert.equal(result.artifact.fileName, 'sample-app-1.2.3-windows.zip')
})

test('独立校验显式指定成品优先于默认定位', async t => {
  const fixture = await createVerifyFixture({ zipName: 'sample-app_1.2.3_windows-x64.zip' })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  const result = await verifyAppArtifact({ protocolDir: fixture.protocolDir, artifactPath: fixture.zipPath })
  assert.equal(result.artifact.fileName, 'sample-app_1.2.3_windows-x64.zip')

  await assert.rejects(
    () => verifyAppArtifact({ protocolDir: fixture.protocolDir, artifactPath: path.join(fixture.root, 'missing.zip') }),
    /成品文件不存在/,
  )
})

test('独立校验拒绝包内服务声明与源不一致', async t => {
  const fixture = await createVerifyFixture({
    packagedOverrides: { service: { ready: { type: 'log', match: 'is ready' }, stop: { type: 'terminate' } } },
  })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  await assert.rejects(
    () => verifyAppArtifact({ protocolDir: fixture.protocolDir }),
    /清单 service 与源清单不一致/,
  )
})

test('独立校验按包内基准认图标落点', async t => {
  const fixture = await createVerifyFixture({
    sourceIconPath: '.fast-window-dev-protocol/assets/icon.svg',
    sourceOverrides: {
      package: { windowsExecutable: 'sample-app.exe', icon: '.fast-window-dev-protocol/assets/icon.svg' },
    },
    packagedOverrides: {
      package: { windowsExecutable: 'sample-app.exe', icon: 'assets/icon.svg' },
    },
  })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  const result = await verifyAppArtifact({ protocolDir: fixture.protocolDir })
  assert.equal(result.checks.find(check => check.name === 'icon').detail, 'assets/icon.svg')
})

test('独立校验拒绝未按包内基准改写的图标路径', async t => {
  const fixture = await createVerifyFixture({
    sourceIconPath: '.fast-window-dev-protocol/assets/icon.svg',
    sourceOverrides: {
      package: { windowsExecutable: 'sample-app.exe', icon: '.fast-window-dev-protocol/assets/icon.svg' },
    },
    packagedOverrides: {
      package: { windowsExecutable: 'sample-app.exe', icon: '.fast-window-dev-protocol/assets/icon.svg' },
    },
  })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  await assert.rejects(
    () => verifyAppArtifact({ protocolDir: fixture.protocolDir }),
    /清单 icon 与源清单不一致/,
  )
})

test('独立校验拒绝被篡改的包内清单', async t => {
  const fixture = await createVerifyFixture({ packagedOverrides: { name: 'Other App' } })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  await assert.rejects(
    () => verifyAppArtifact({ protocolDir: fixture.protocolDir }),
    /清单 name 与源清单不一致/,
  )
})

test('独立校验拒绝版本不一致的包', async t => {
  const fixture = await createVerifyFixture({ packagedOverrides: { version: '9.9.9' } })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  await assert.rejects(
    () => verifyAppArtifact({ protocolDir: fixture.protocolDir }),
    /包内版本/,
  )
})

test('独立校验拒绝缺少图标的包', async t => {
  const fixture = await createVerifyFixture({ omitIcon: true })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  await assert.rejects(
    () => verifyAppArtifact({ protocolDir: fixture.protocolDir }),
    /缺少图标/,
  )
})

test('独立校验拒绝缺少入口程序的包', async t => {
  const fixture = await createVerifyFixture({ omitExe: true })
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  await assert.rejects(
    () => verifyAppArtifact({ protocolDir: fixture.protocolDir }),
    /缺少入口程序/,
  )
})

test('独立校验按可选本地目录比对条目', async t => {
  const fixture = await createVerifyFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  const sha256 = await sha256File(fixture.zipPath)
  const catalogPath = path.join(fixture.root, 'catalog.json')
  await fs.writeFile(catalogPath, `${JSON.stringify({
    catalogVersion: 2,
    apps: [{
      id: 'sample-app',
      name: 'Sample App',
      version: '1.2.3',
      platforms: { windows: { downloadUrl: 'https://example.com/sample-app-1.2.3-windows.zip', sha256 } },
    }],
    plugins: [],
  }, null, 2)}\n`, 'utf8')

  const result = await verifyAppArtifact({ protocolDir: fixture.protocolDir, catalogPath })
  assert.equal(result.catalog.id, 'sample-app')
  assert.equal(result.catalog.sha256, sha256)
  assert.ok(result.checks.some(check => check.name === 'catalog-entry'))

  await fs.writeFile(catalogPath, `${JSON.stringify({
    catalogVersion: 2,
    apps: [{
      id: 'sample-app',
      name: 'Sample App',
      version: '1.2.3',
      platforms: { windows: { downloadUrl: 'https://example.com/sample-app-1.2.3-windows.zip', sha256: 'f'.repeat(64) } },
    }],
    plugins: [],
  }, null, 2)}\n`, 'utf8')

  await assert.rejects(
    () => verifyAppArtifact({ protocolDir: fixture.protocolDir, catalogPath }),
    /目录条目 sha256/,
  )
})

test('下架缺少凭据目录时快速失败', async t => {
  const fixture = await createVerifyFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))

  await assert.rejects(
    () => unpublishAppFromStore({ protocolDir: fixture.protocolDir, credentialsDir: '' }),
    /缺少发布凭据目录/,
  )
})

test('下架缺少发布凭据时快速失败', async t => {
  const fixture = await createVerifyFixture()
  const credentialsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-store-ops-creds-'))
  t.after(() => {
    fs.rm(fixture.root, { recursive: true, force: true })
    fs.rm(credentialsDir, { recursive: true, force: true })
  })

  const saved = new Map()
  for (const key of ['GITHUB_TOKEN', 'FAST_WINDOW_GITHUB_TOKEN', 'GH_TOKEN']) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  try {
    await assert.rejects(
      () => unpublishAppFromStore({ protocolDir: fixture.protocolDir, credentialsDir }),
      /缺少发布凭据/,
    )
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
