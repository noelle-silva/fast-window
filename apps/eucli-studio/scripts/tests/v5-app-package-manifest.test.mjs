import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { existsSync } from 'node:fs'
import {
  V5_APP_MANIFEST_PATH,
  loadAppConfig,
  normalizeV5AppBuildConfig,
  normalizeV5AppManifest,
} from '../lib/v5-app-package-manifest.mjs'

test('应用清单源位于协议目录且可完整装载', async () => {
  assert.equal(existsSync(V5_APP_MANIFEST_PATH), true)
  assert.equal(path.basename(path.dirname(V5_APP_MANIFEST_PATH)), '.fast-window-dev-protocol')

  const config = await loadAppConfig()
  assert.equal(config.id, 'eucli-studio')
  assert.equal(config.type, 'desktop-app')
  assert.equal(config.executable, 'eucli-studio-app.exe')
  assert.equal(config.icon, 'assets/icon.svg')
  assert.equal(config.versionSource, 'src-tauri/tauri.conf.json')
  assert.deepEqual(Object.keys(config.profiles).sort(), ['dev', 'release'])
  for (const profile of Object.values(config.profiles)) {
    assert.ok(profile.files.some(file => file.to === config.executable))
  }
})

test('清单拒绝非桌面类型', () => {
  assert.throws(
    () => normalizeV5AppManifest(
      {
        type: 'service-app',
        id: 'sample',
        name: 'sample',
        description: '样例',
        versionSource: 'version.json',
        package: { windowsExecutable: 'sample.exe', icon: 'icon.svg' },
        displayMode: 'default',
        commands: [],
      },
      { appDir: 'C:/sample', expectedId: 'sample', manifestPath: 'fw-app.json' },
    ),
    /type 必须为 desktop-app/,
  )
})

test('构建配置拒绝写入 staging 保留目录', () => {
  const buildConfig = {
    profiles: {
      release: {
        build: { command: 'pnpm', args: ['build'] },
        stageDir: 'dist-app/v5-windows',
        files: [{ from: 'target/release/app.exe', to: 'data/app.exe' }],
      },
      dev: {
        build: { command: 'pnpm', args: ['build:dev'] },
        stageDir: 'dist-app/v5-windows-dev',
        files: [{ from: 'target/debug/app.exe', to: 'app.exe' }],
      },
    },
  }
  assert.throws(
    () => normalizeV5AppBuildConfig(buildConfig, { buildPath: 'fw-app.build.json' }),
    /不允许写入 staging 容器保留目录/,
  )
})

test('构建配置缺少 profile 时快速失败', () => {
  assert.throws(
    () => normalizeV5AppBuildConfig(
      {
        profiles: {
          release: {
            build: { command: 'pnpm', args: ['build'] },
            stageDir: 'dist-app/v5-windows',
            files: [{ from: 'target/release/app.exe', to: 'app.exe' }],
          },
        },
      },
      { buildPath: 'fw-app.build.json' },
    ),
    /profiles\.dev 缺失/,
  )
})
