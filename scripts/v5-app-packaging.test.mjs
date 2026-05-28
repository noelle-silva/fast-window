import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'

import {
  buildStoreCatalog,
  buildV5AppPackage,
  removeStoreApp,
  stageV5AppPackage,
  syncV5AppExecutable,
  upsertStoreApp,
  v5AppStagePackageDir,
} from './lib/v5-app-packaging.mjs'
import { scriptArgs } from './lib/v5-cli-args.mjs'
import { normalizeV5AppPackageManifest } from './lib/v5-app-package-manifest.mjs'
import { TAURI_CONFIG_ENV } from './lib/tauri-build-env-policy.mjs'

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('exit', code => {
      if ((code ?? 0) === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} failed with exit ${code}\n${stderr}`))
    })
  })
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function createFakeApp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-v5-packaging-test-'))
  const appDir = path.join(root, 'app')
  await fs.mkdir(path.join(appDir, 'build', 'assets'), { recursive: true })
  await fs.writeFile(path.join(appDir, 'build', 'fake.exe'), 'first exe', 'utf8')
  await fs.writeFile(path.join(appDir, 'build', 'assets', 'icon.svg'), '<svg />', 'utf8')
  await fs.writeFile(path.join(appDir, 'version.json'), JSON.stringify({ version: '1.2.3' }), 'utf8')
  await fs.mkdir(path.join(appDir, 'src-tauri'), { recursive: true })
  await fs.writeFile(path.join(appDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ productName: 'Fake App' }), 'utf8')
  await fs.writeFile(path.join(appDir, 'src-tauri', 'tauri.conf.dev.json'), JSON.stringify({ productName: 'Fake App Dev' }), 'utf8')

  return {
    root,
    config: {
      appDir,
      id: 'fake-app',
      name: 'Fake App',
      description: 'Fake v5 app',
      versionSource: 'version.json',
      profiles: {
        release: {
          id: 'release',
          buildCommand: { command: 'node', args: ['-e', ''] },
          stageDir: 'dist-app/v5-windows',
          files: [
            { from: 'build/fake.exe', to: 'fake.exe' },
            { from: 'build/assets', to: 'assets' },
          ],
        },
        dev: {
          id: 'dev',
          buildCommand: { command: 'node', args: ['-e', ''] },
          stageDir: 'dist-app/v5-windows-dev',
          files: [
            { from: 'build/fake.exe', to: 'fake.exe' },
            { from: 'build/assets', to: 'assets' },
          ],
        },
      },
      executable: 'fake.exe',
      icon: 'assets/icon.svg',
      displayMode: 'default',
      commands: [{ id: 'open', title: 'Open' }],
    },
  }
}

async function createEnvProbeApp(profile = 'release') {
  const app = await createFakeApp()
  const probePath = path.join(app.config.appDir, 'build', `${profile}-env.json`)
  const script = [
    "const fs = require('node:fs')",
    `fs.writeFileSync(${JSON.stringify(probePath)}, JSON.stringify({ TAURI_CONFIG: process.env.TAURI_CONFIG || null, FAST_WINDOW_HOST_PROFILE: process.env.FAST_WINDOW_HOST_PROFILE || null, VITE_FAST_WINDOW_HOST_PROFILE: process.env.VITE_FAST_WINDOW_HOST_PROFILE || null }))`,
  ].join('; ')
  app.config.profiles[profile].buildCommand = { command: 'node', args: ['-e', script] }
  return { ...app, probePath }
}

async function writePackageManifest(appDir, overrides = {}) {
  const manifest = {
    schemaVersion: 2,
    id: overrides.id || path.basename(appDir),
    name: 'Fake App',
    description: 'Fake v5 app',
    versionSource: 'version.json',
    profiles: {
      release: {
        build: { command: 'node', args: ['-e', '0'] },
        stageDir: overrides.releaseStageDir || 'dist-app/v5-windows',
        files: overrides.releaseFiles || [
          { from: 'build/fake.exe', to: 'fake.exe' },
          { from: 'build/assets', to: 'assets' },
        ],
      },
      dev: {
        build: { command: 'node', args: ['-e', '0'] },
        stageDir: overrides.devStageDir || 'dist-app/v5-windows-dev',
        files: overrides.devFiles || [
          { from: 'build/fake.exe', to: 'fake.exe' },
          { from: 'build/assets', to: 'assets' },
        ],
      },
    },
    package: {
      windowsExecutable: overrides.windowsExecutable || 'fake.exe',
      icon: overrides.icon || 'assets/icon.svg',
    },
    displayMode: 'default',
    commands: [{ id: 'open', title: 'Open' }],
  }
  await fs.writeFile(path.join(appDir, 'fw-app.package.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return manifest
}

async function zipEntryNames(zipPath) {
  const { stdout } = await run('tar', ['-tf', zipPath], path.dirname(zipPath))
  return stdout.split(/\r?\n/g).filter(Boolean)
}

test('stage keeps container data and replaces only package', async () => {
  const { root, config } = await createFakeApp()
  try {
    const first = await stageV5AppPackage(config, { noBuild: true, validateArtifacts: false })
    assert.equal(first.packageDir, v5AppStagePackageDir(first.stageDir))
    assert.equal(first.executablePath, path.join(first.packageDir, 'fake.exe'))
    assert.equal(first.manifestPath, path.join(first.packageDir, 'fw-app.json'))

    const dataFile = path.join(first.stageDir, 'data', 'sentinel.txt')
    await fs.mkdir(path.dirname(dataFile), { recursive: true })
    await fs.writeFile(dataFile, 'keep me', 'utf8')
    await fs.writeFile(path.join(config.appDir, 'build', 'fake.exe'), 'second exe', 'utf8')

    await stageV5AppPackage(config, { noBuild: true, validateArtifacts: false })

    assert.equal(await fs.readFile(dataFile, 'utf8'), 'keep me')
    assert.equal(await fs.readFile(path.join(first.packageDir, 'fake.exe'), 'utf8'), 'second exe')
    assert.equal(await exists(path.join(first.stageDir, 'fw-app.json')), false)
    assert.equal(await exists(path.join(first.packageDir, 'fw-app.json')), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('sync updates executable inside package without touching data', async () => {
  const { root, config } = await createFakeApp()
  try {
    const staged = await stageV5AppPackage(config, { noBuild: true, validateArtifacts: false })
    const dataFile = path.join(staged.stageDir, 'data', 'sentinel.txt')
    await fs.mkdir(path.dirname(dataFile), { recursive: true })
    await fs.writeFile(dataFile, 'keep me', 'utf8')
    await fs.writeFile(path.join(config.appDir, 'build', 'fake.exe'), 'synced exe', 'utf8')

    const synced = await syncV5AppExecutable(config, { noBuild: true, validateArtifacts: false })

    assert.equal(synced.executablePath, path.join(staged.packageDir, 'fake.exe'))
    assert.equal(await fs.readFile(dataFile, 'utf8'), 'keep me')
    assert.equal(await fs.readFile(synced.executablePath, 'utf8'), 'synced exe')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('package zip is built from package only and excludes container data', async () => {
  const { root, config } = await createFakeApp()
  try {
    const staged = await stageV5AppPackage(config, { noBuild: true, validateArtifacts: false })
    const dataFile = path.join(staged.stageDir, 'data', 'sentinel.txt')
    await fs.mkdir(path.dirname(dataFile), { recursive: true })
    await fs.writeFile(dataFile, 'do not ship', 'utf8')

    const result = await buildV5AppPackage(config, {
      noBuild: true,
      outDir: path.join(root, 'out'),
      baseUrl: 'https://example.com/apps',
      validateArtifacts: false,
    })
    const entries = await zipEntryNames(result.zipPath)

    assert(entries.some(entry => entry.endsWith('/fw-app.json')))
    assert(entries.some(entry => entry.endsWith('/fake.exe')))
    assert(!entries.some(entry => entry.includes('/data/')))
    assert.equal(result.catalogEntry.icon.type, 'data')
    assert(result.catalogEntry.icon.dataUrl.startsWith('data:image/svg+xml;base64,'))
    assert.equal(await fs.readFile(dataFile, 'utf8'), 'do not ship')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('v5 script args remove pnpm separator', () => {
  assert.deepEqual(
    scriptArgs(['node', 'script.mjs', '--', '--app', 'fake-app', '--no-build']),
    ['--app', 'fake-app', '--no-build']
  )
})

test('v5 app stage build does not inherit host dev tauri config', async () => {
  const { root, config, probePath } = await createEnvProbeApp('release')
  try {
    await stageV5AppPackage(config, {
      validateArtifacts: false,
      env: {
        ...process.env,
        [TAURI_CONFIG_ENV]: '{"productName":"Fast Window-dev"}',
        FAST_WINDOW_HOST_PROFILE: 'dev',
        VITE_FAST_WINDOW_HOST_PROFILE: 'dev',
      },
    })

    const captured = JSON.parse(await fs.readFile(probePath, 'utf8'))
    assert.equal(captured.TAURI_CONFIG, null)
    assert.equal(captured.FAST_WINDOW_HOST_PROFILE, null)
    assert.equal(captured.VITE_FAST_WINDOW_HOST_PROFILE, null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('v5 app sync build does not inherit host dev tauri config', async () => {
  const { root, config, probePath } = await createEnvProbeApp('release')
  try {
    await stageV5AppPackage(config, { noBuild: true, validateArtifacts: false })
    await syncV5AppExecutable(config, {
      validateArtifacts: false,
      env: {
        ...process.env,
        [TAURI_CONFIG_ENV]: '{"productName":"Fast Window-dev"}',
        FAST_WINDOW_HOST_PROFILE: 'dev',
        VITE_FAST_WINDOW_HOST_PROFILE: 'dev',
      },
    })

    const captured = JSON.parse(await fs.readFile(probePath, 'utf8'))
    assert.equal(captured.TAURI_CONFIG, null)
    assert.equal(captured.FAST_WINDOW_HOST_PROFILE, null)
    assert.equal(captured.VITE_FAST_WINDOW_HOST_PROFILE, null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

function fakeHostCatalogEntry() {
  return {
    id: 'fast-window',
    name: 'Fast Window',
    version: '1.8.5',
    platforms: {
      windows: {
        installerType: 'msi',
        downloadUrl: 'https://github.com/noelle-silva/fast-window/releases/download/vhost-1.8.5/fast-window-1.8.5-windows-x64.msi',
        sha256: 'a'.repeat(64),
        sizeBytes: 123,
      },
    },
  }
}

test('store catalog rebuild preserves host metadata when upserting apps', () => {
  const host = fakeHostCatalogEntry()
  const catalog = {
    catalogVersion: 2,
    generatedAt: '2026-05-01T00:00:00.000Z',
    host,
    apps: [{ id: 'z-app', name: 'Z App', description: 'old app', version: '1.0.0', icon: { type: 'data', dataUrl: 'data:image/svg+xml;base64,AA==' }, platforms: { windows: { downloadUrl: 'https://example.com/z.zip', sha256: 'b'.repeat(64) } } }],
    plugins: [{ id: 'z-plugin', name: 'Z Plugin' }, { id: 'a-plugin', name: 'A Plugin' }],
  }
  const next = upsertStoreApp(catalog, {
    id: 'a-app',
    name: 'A App',
    description: 'new app',
    version: '1.0.0',
    icon: { type: 'data', dataUrl: 'data:image/svg+xml;base64,AA==' },
    platforms: { windows: { downloadUrl: 'https://example.com/a.zip', sha256: 'c'.repeat(64) } },
  }, '2026-05-02T00:00:00.000Z')

  assert.deepEqual(next.host, host)
  assert.equal(next.generatedAt, '2026-05-02T00:00:00.000Z')
  assert.deepEqual(next.apps.map(app => app.id), ['a-app', 'z-app'])
  assert.deepEqual(next.plugins.map(plugin => plugin.id), ['a-plugin', 'z-plugin'])
})

test('store catalog rebuild preserves host metadata when removing apps', () => {
  const host = fakeHostCatalogEntry()
  const { catalog, removed } = removeStoreApp({
    catalogVersion: 2,
    host,
    apps: [
      { id: 'remove-me', name: 'Remove Me', description: 'old app', version: '1.0.0', icon: { type: 'data', dataUrl: 'data:image/svg+xml;base64,AA==' }, platforms: { windows: { downloadUrl: 'https://example.com/remove.zip', sha256: 'd'.repeat(64) } } },
      { id: 'keep-me', name: 'Keep Me', description: 'old app', version: '1.0.0', icon: { type: 'data', dataUrl: 'data:image/svg+xml;base64,AA==' }, platforms: { windows: { downloadUrl: 'https://example.com/keep.zip', sha256: 'e'.repeat(64) } } },
    ],
    plugins: [],
  }, 'remove-me', '2026-05-03T00:00:00.000Z')

  assert.equal(removed.id, 'remove-me')
  assert.deepEqual(catalog.host, host)
  assert.deepEqual(catalog.apps.map(app => app.id), ['keep-me'])
})

test('store catalog rebuild rejects invalid host metadata', () => {
  assert.throws(
    () => buildStoreCatalog({ catalogVersion: 2, host: { ...fakeHostCatalogEntry(), id: 'other' }, apps: [], plugins: [] }),
    /catalog\.host\.id 必须是 fast-window/
  )
})

test('manifest rejects reserved staging container paths inside package files', async () => {
  const { root } = await createFakeApp()
  try {
    const appDir = path.join(root, 'apps', 'reserved-app')
    await fs.mkdir(path.join(appDir, 'build', 'assets'), { recursive: true })
    await fs.writeFile(path.join(appDir, 'build', 'fake.exe'), 'exe', 'utf8')
    await fs.writeFile(path.join(appDir, 'build', 'assets', 'icon.svg'), '<svg />', 'utf8')
    await fs.writeFile(path.join(appDir, 'version.json'), JSON.stringify({ version: '1.0.0' }), 'utf8')
    const manifest = await writePackageManifest(appDir, {
      id: 'reserved-app',
      releaseFiles: [{ from: 'build/fake.exe', to: 'data/fake.exe' }],
    })

    assert.throws(
      () => normalizeV5AppPackageManifest(manifest, {
        appDir,
        expectedId: 'reserved-app',
        manifestPath: path.join(appDir, 'fw-app.package.json'),
      }),
      /不允许写入 staging 容器保留目录/
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('manifest rejects stageDir ending in reserved container entry', async () => {
  const { root } = await createFakeApp()
  try {
    const appDir = path.join(root, 'apps', 'bad-stage-dir')
    await fs.mkdir(path.join(appDir, 'build', 'assets'), { recursive: true })
    await fs.writeFile(path.join(appDir, 'build', 'fake.exe'), 'exe', 'utf8')
    await fs.writeFile(path.join(appDir, 'build', 'assets', 'icon.svg'), '<svg />', 'utf8')
    await fs.writeFile(path.join(appDir, 'version.json'), JSON.stringify({ version: '1.0.0' }), 'utf8')
    const manifest = await writePackageManifest(appDir, { id: 'bad-stage-dir', releaseStageDir: 'dist-app/v5-windows/package' })

    assert.throws(
      () => normalizeV5AppPackageManifest(manifest, {
        appDir,
        expectedId: 'bad-stage-dir',
        manifestPath: path.join(appDir, 'fw-app.package.json'),
      }),
      /不能以保留目录 package 结尾/
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
