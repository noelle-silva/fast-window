import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFaceFiles, normalizeFaceParams, parseFaceArgs } from '../new-face.mjs'

test('parseFaceArgs 应用默认能力画像', () => {
  const params = parseFaceArgs(['node', 'new-face.mjs', '--kind', 'mindmap', '--label', '思维导图'])
  assert.equal(params.kind, 'mindmap')
  assert.equal(params.label, '思维导图')
  assert.equal(params.editable, true)
  assert.equal(params.searchable, false)
  assert.equal(params.previewable, true)
  assert.equal(params.creatable, true)
  assert.equal(params.deletable, true)
  assert.equal(params.dryRun, false)
})

test('parseFaceArgs 支持能力开关与 dry-run', () => {
  const params = parseFaceArgs(['node', 'new-face.mjs', '--kind', 'board', '--label', '白板', '--no-editable', '--searchable', '--dry-run'])
  assert.equal(params.editable, false)
  assert.equal(params.searchable, true)
  assert.equal(params.dryRun, true)
})

test('normalizeFaceParams 校验类型标识并补齐默认值', () => {
  assert.throws(() => normalizeFaceParams({ kind: 'Mind-Map', label: '思维导图' }), /类型标识非法/)
  assert.throws(() => normalizeFaceParams({ kind: 'mindmap', label: '  ' }), /缺少展示名/)
  const params = normalizeFaceParams({ kind: 'canvas', label: '画布' })
  assert.equal(params.faceId, 'canvas')
  assert.equal(params.fileName, 'canvas.txt')
})

test('可编辑且可搜索时生成编辑态视窗与搜索文本', async () => {
  const { files } = await buildFaceFiles({ kind: 'canvas', label: '画布', editable: true, searchable: true })
  const paths = files.map(file => file.path)
  assert.ok(paths.includes('src/facePlugins/canvas/index.ts'))
  assert.ok(paths.includes('src/facePlugins/canvas/readView.tsx'))
  assert.ok(paths.includes('src/facePlugins/canvas/editView.tsx'))
  assert.ok(paths.includes('backend-go/faceplugins/canvas/plugin.go'))
  assert.ok(paths.includes('backend-go/faceplugins/canvas/refs.go'))
  assert.ok(paths.includes('backend-go/faceplugins/canvas/search_text.go'))

  const index = files.find(file => file.path.endsWith('index.ts')).content
  assert.match(index, /kind: 'canvas'/)
  assert.match(index, /CanvasReadView/)
  assert.match(index, /CanvasEditView/)

  const plugin = files.find(file => file.path.endsWith('plugin.go')).content
  assert.match(plugin, /Kind:\s+"canvas"/)
  assert.match(plugin, /Editable:\s+true/)
  assert.match(plugin, /Searchable:\s+true/)
  assert.match(plugin, /SearchText:\s+SearchText,/)

  for (const file of files) {
    assert.doesNotMatch(file.content, /\{\{[A-Z_]+\}\}/, `${file.path} 残留未替换占位符`)
  }
})

test('只读且不可搜索时不生成编辑态视窗与搜索文本', async () => {
  const { files } = await buildFaceFiles({ kind: 'board', label: '白板', editable: false, searchable: false })
  const paths = files.map(file => file.path)
  assert.ok(!paths.includes('src/facePlugins/board/editView.tsx'))
  assert.ok(!paths.includes('backend-go/faceplugins/board/search_text.go'))

  const index = files.find(file => file.path.endsWith('index.ts')).content
  assert.doesNotMatch(index, /EditView/)

  const plugin = files.find(file => file.path.endsWith('plugin.go')).content
  assert.match(plugin, /Editable:\s+false/)
  assert.match(plugin, /Searchable:\s+false/)
  assert.doesNotMatch(plugin, /SearchText:/)
})

test('自定义默认面标识与默认文件名会写入声明', async () => {
  const { files } = await buildFaceFiles({ kind: 'mindmap', label: '思维导图', faceId: 'mind', fileName: 'map.json' })
  const plugin = files.find(file => file.path.endsWith('plugin.go')).content
  assert.match(plugin, /DefaultFaceID:\s+"mind"/)
  assert.match(plugin, /DefaultFileName:\s+"map\.json"/)
})
