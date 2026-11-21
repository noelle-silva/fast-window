import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertAppPublishVersionPolicy,
  assertStoreCatalogShape,
  buildStoreCatalog,
  removeStoreApp,
  upsertStoreApp,
} from '../modules/fast-window-dev-store-catalog.mjs'
import { compareSemverStrict, isSafeId, parseSemverStrict } from '../modules/fast-window-dev-store-common.mjs'

const icon = { type: 'data', dataUrl: 'data:image/svg+xml;base64,AA==' }

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

function appEntry(id, name, version = '1.0.0') {
  return { id, name, description: `${name} app`, version, icon, platforms: { windows: { downloadUrl: `https://example.com/${id}.zip`, sha256: 'b'.repeat(64) } } }
}

function catalogWith(apps, extra = {}) {
  return { catalogVersion: 2, apps, plugins: [], ...extra }
}

test('商店值规则：应用 id 与严格版本号', () => {
  assert.equal(isSafeId('ai-draw_2'), true)
  assert.equal(isSafeId(''), false)
  assert.equal(isSafeId('a/b'), false)
  assert.equal(parseSemverStrict(' 1.2.3 '), '1.2.3')
  assert.equal(parseSemverStrict('1.2'), '')
  assert.equal(parseSemverStrict('v1.2.3'), '')
  assert.equal(parseSemverStrict('01.2.3'), '')
  assert.equal(parseSemverStrict('1.2.03'), '')
  assert.equal(parseSemverStrict('0.10.0'), '0.10.0')
  assert.equal(compareSemverStrict('1.10.0', '1.9.9'), 1)
  assert.equal(compareSemverStrict('1.2.3', '1.2.3'), 0)
  assert.equal(compareSemverStrict('0.9.0', '1.0.0'), -1)
  assert.throws(() => compareSemverStrict('1.2', '1.2.3'), /x\.y\.z/)
})

test('商店目录形态校验', () => {
  assert.doesNotThrow(() => assertStoreCatalogShape(catalogWith([])))
  assert.throws(() => assertStoreCatalogShape(null, 'catalog.json'), /catalog\.json 必须是对象/)
  assert.throws(() => assertStoreCatalogShape({ catalogVersion: 1, apps: [], plugins: [] }), /catalogVersion 必须为 2/)
  assert.throws(() => assertStoreCatalogShape({ catalogVersion: 2, apps: {}, plugins: [] }), /apps 必须是数组/)
  assert.throws(() => assertStoreCatalogShape({ catalogVersion: 2, apps: [] }), /plugins 必须是数组/)
})

test('上架保留宿主条目并按名称排序', () => {
  const host = fakeHostCatalogEntry()
  const catalog = catalogWith([appEntry('z-app', 'Z App')], {
    generatedAt: '2026-05-01T00:00:00.000Z',
    host,
    plugins: [{ id: 'z-plugin', name: 'Z Plugin' }, { id: 'a-plugin', name: 'A Plugin' }],
  })
  const next = upsertStoreApp(catalog, { type: 'desktop-app', ...appEntry('a-app', 'A App') }, '2026-05-02T00:00:00.000Z')

  assert.deepEqual(next.host, host)
  assert.equal(next.generatedAt, '2026-05-02T00:00:00.000Z')
  assert.deepEqual(next.apps.map(app => app.id), ['a-app', 'z-app'])
  assert.equal(next.apps.find(app => app.id === 'a-app')?.type, 'desktop-app')
  assert.deepEqual(next.plugins.map(plugin => plugin.id), ['a-plugin', 'z-plugin'])
})

test('上架同 id 应用替换旧条目', () => {
  const next = upsertStoreApp(catalogWith([appEntry('demo', 'Demo', '1.0.0')]), appEntry('demo', 'Demo', '1.1.0'))
  assert.deepEqual(next.apps.map(app => [app.id, app.version]), [['demo', '1.1.0']])
})

test('下架保留宿主条目并回报被移除条目', () => {
  const host = fakeHostCatalogEntry()
  const { catalog, removed } = removeStoreApp(
    catalogWith([appEntry('remove-me', 'Remove Me'), appEntry('keep-me', 'Keep Me')], { host }),
    'remove-me',
    '2026-05-03T00:00:00.000Z',
  )
  assert.equal(removed.id, 'remove-me')
  assert.deepEqual(catalog.host, host)
  assert.deepEqual(catalog.apps.map(app => app.id), ['keep-me'])
})

test('下架不存在或非法 id 快速失败', () => {
  assert.throws(() => removeStoreApp(catalogWith([]), 'missing'), /不存在应用: missing/)
  assert.throws(() => removeStoreApp(catalogWith([]), 'a/b'), /app id 不合法/)
})

test('重建拒绝不合法的宿主条目', () => {
  assert.throws(
    () => buildStoreCatalog(catalogWith([], { host: { ...fakeHostCatalogEntry(), id: 'other' } })),
    /catalog\.host\.id 必须是 fast-window/,
  )
})

test('发布版本策略：首发放行、递增放行、同版本与回退拒绝', () => {
  const catalog = catalogWith([appEntry('demo', 'Demo', '1.2.3')])
  assert.doesNotThrow(() => assertAppPublishVersionPolicy(catalog, 'fresh', '0.1.0'))
  assert.doesNotThrow(() => assertAppPublishVersionPolicy(catalog, 'demo', '1.2.4'))
  assert.throws(() => assertAppPublishVersionPolicy(catalog, 'demo', '1.2.3'), /严禁覆盖: demo@1\.2\.3/)
  assert.throws(() => assertAppPublishVersionPolicy(catalog, 'demo', '1.2.2'), /版本号必须递增/)
})
