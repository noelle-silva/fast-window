import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFaceFiles, normalizeFaceParams, parseFaceArgs } from '../new-face.mjs'

function fileOf(files, suffix) {
  return files.find(file => file.path.endsWith(suffix))?.content || ''
}

test('parseFaceArgs 应用默认值：能力画像与可选件全关', () => {
  const params = parseFaceArgs(['node', 'new-face.mjs', '--kind', 'mindmap', '--label', '思维导图'])
  assert.equal(params.kind, 'mindmap')
  assert.equal(params.label, '思维导图')
  assert.equal(params.editable, true)
  assert.equal(params.searchable, false)
  assert.equal(params.previewable, true)
  assert.equal(params.creatable, true)
  assert.equal(params.deletable, true)
  assert.equal(params.refs, false)
  assert.equal(params.toolbar, '')
  assert.equal(params.contentPreview, false)
  assert.equal(params.settings, false)
  assert.equal(params.dryRun, false)
})

test('parseFaceArgs 支持能力开关与可选件开关', () => {
  const params = parseFaceArgs([
    'node', 'new-face.mjs', '--kind', 'board', '--label', '白板',
    '--no-editable', '--searchable', '--refs', '--toolbar', 'both', '--content-preview', '--settings', '--dry-run',
  ])
  assert.equal(params.editable, false)
  assert.equal(params.searchable, true)
  assert.equal(params.refs, true)
  assert.equal(params.toolbar, 'both')
  assert.equal(params.contentPreview, true)
  assert.equal(params.settings, true)
  assert.equal(params.dryRun, true)
})

test('normalizeFaceParams 校验类型标识、展示名与工具条插槽', () => {
  assert.throws(() => normalizeFaceParams({ kind: 'Mind-Map', label: '思维导图' }), /类型标识非法/)
  assert.throws(() => normalizeFaceParams({ kind: 'mindmap', label: '  ' }), /缺少展示名/)
  assert.throws(() => normalizeFaceParams({ kind: 'mindmap', label: '思维导图', toolbar: 'top' }), /工具条插槽非法/)
  const params = normalizeFaceParams({ kind: 'canvas', label: '画布' })
  assert.equal(params.faceId, 'canvas')
  assert.equal(params.fileName, 'canvas.txt')
})

test('默认只生成必需件，可选件不生成', async () => {
  const { files } = await buildFaceFiles({ kind: 'canvas', label: '画布' })
  const paths = files.map(file => file.path)
  assert.deepEqual(paths, [
    'src/facePlugins/canvas/index.ts',
    'src/facePlugins/canvas/readView.tsx',
    'src/facePlugins/canvas/editView.tsx',
    'backend-go/faceplugins/canvas/plugin.go',
  ])
  const plugin = fileOf(files, 'plugin.go')
  assert.doesNotMatch(plugin, /ExtractRefs:/)
  assert.doesNotMatch(plugin, /SearchText:/)
  assert.doesNotMatch(plugin, /SettingsTitle:/)
})

test('可编辑且可搜索时生成编辑态视窗与搜索文本', async () => {
  const { files } = await buildFaceFiles({ kind: 'canvas', label: '画布', editable: true, searchable: true })
  const paths = files.map(file => file.path)
  assert.ok(paths.includes('src/facePlugins/canvas/editView.tsx'))
  assert.ok(paths.includes('backend-go/faceplugins/canvas/search_text.go'))
  const index = fileOf(files, 'index.ts')
  assert.match(index, /kind: 'canvas'/)
  assert.match(index, /CanvasReadView/)
  assert.match(index, /CanvasEditView/)
  const plugin = fileOf(files, 'plugin.go')
  assert.match(plugin, /Searchable:\s+true/)
  assert.match(plugin, /SearchText:\s+SearchText,/)
})

test('只读且不可搜索时不生成编辑态视窗与搜索文本', async () => {
  const { files } = await buildFaceFiles({ kind: 'board', label: '白板', editable: false, searchable: false })
  const paths = files.map(file => file.path)
  assert.ok(!paths.includes('src/facePlugins/board/editView.tsx'))
  assert.ok(!paths.includes('backend-go/faceplugins/board/search_text.go'))
  assert.doesNotMatch(fileOf(files, 'index.ts'), /EditView/)
  assert.match(fileOf(files, 'plugin.go'), /Editable:\s+false/)
})

test('--refs 生成前后端引用提取并接线', async () => {
  const { files } = await buildFaceFiles({ kind: 'canvas', label: '画布', refs: true })
  const paths = files.map(file => file.path)
  assert.ok(paths.includes('src/facePlugins/canvas/extractRefs.ts'))
  assert.ok(paths.includes('backend-go/faceplugins/canvas/refs.go'))
  assert.match(fileOf(files, 'index.ts'), /extractRefs: extractCanvasFaceRefs,/)
  assert.match(fileOf(files, 'plugin.go'), /ExtractRefs:\s+ExtractRefs,/)
})

test('--toolbar both 生成左右插槽并接线', async () => {
  const { files } = await buildFaceFiles({ kind: 'canvas', label: '画布', toolbar: 'both' })
  assert.ok(files.some(file => file.path.endsWith('toolbar.tsx')))
  const index = fileOf(files, 'index.ts')
  assert.match(index, /Toolbars: \{ left: CanvasLeftToolbar, right: CanvasRightToolbar \},/)
  const toolbar = fileOf(files, 'toolbar.tsx')
  assert.match(toolbar, /export function CanvasLeftToolbar/)
  assert.match(toolbar, /export function CanvasRightToolbar/)
})

test('--toolbar left 只生成左插槽', async () => {
  const { files } = await buildFaceFiles({ kind: 'canvas', label: '画布', toolbar: 'left' })
  const index = fileOf(files, 'index.ts')
  assert.match(index, /Toolbars: \{ left: CanvasLeftToolbar \},/)
  assert.doesNotMatch(index, /RightToolbar/)
})

test('--content-preview 生成只读预览并接线', async () => {
  const { files } = await buildFaceFiles({ kind: 'canvas', label: '画布', contentPreview: true })
  assert.ok(files.some(file => file.path.endsWith('contentPreview.tsx')))
  assert.match(fileOf(files, 'index.ts'), /ContentPreview: CanvasContentPreview,/)
})

test('--settings 生成设置声明并接线', async () => {
  const { files } = await buildFaceFiles({ kind: 'canvas', label: '画布', settings: true })
  assert.ok(files.some(file => file.path.endsWith('settings.go')))
  const plugin = fileOf(files, 'plugin.go')
  assert.match(plugin, /SettingsTitle:\s+"画布面设置",/)
  assert.match(plugin, /Settings:\s+settingsDeclaration\(\),/)
})

test('全量生成时无残留占位符', async () => {
  const { files } = await buildFaceFiles({
    kind: 'canvas', label: '画布', editable: true, searchable: true,
    refs: true, toolbar: 'both', contentPreview: true, settings: true,
  })
  for (const file of files) {
    assert.doesNotMatch(file.content, /\{\{[A-Z_]+\}\}/, `${file.path} 残留未替换占位符`)
  }
})
