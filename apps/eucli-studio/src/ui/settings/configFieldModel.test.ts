import { describe, expect, it } from 'vitest'
import { arrayItemSeed, buildArrayItemFields, buildConfigFields, buildObjectChildFields } from './configFieldModel'

describe('arrayItemSeed', () => {
  it('seeds from item default and property defaults', () => {
    const seed = arrayItemSeed({
      type: 'object',
      default: { key: '' },
      properties: { id: { type: 'string' }, description: { type: 'string', default: '未命名' }, key: { type: 'string' } },
    })
    expect(seed).toEqual({ key: '', description: '未命名' })
    expect(Object.prototype.hasOwnProperty.call(seed, 'id')).toBe(false)
  })

  it('falls back to an empty object without declarations', () => {
    expect(arrayItemSeed({ type: 'object' })).toEqual({})
  })
})

describe('buildConfigFields', () => {
  it('marks object-list, string-list and unknown-item arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        endpoint: { type: 'string', title: '访问地址' },
        levels: { type: 'string', enum: ['a', 'b'] },
        repos: { type: 'array', title: '仓库条目', items: { type: 'object', title: '仓库', properties: { id: { type: 'string' } } } },
        tags: { type: 'array', items: { type: 'string' } },
        weird: { type: 'array', items: { type: 'number' } },
      },
    }
    const fields = buildConfigFields(schema, {}, { repos: [{ id: 'notes' }] }, { repos: [{ id: 'notes' }] })
    const byKey = new Map(fields.map((field) => [field.key, field]))
    expect(byKey.get('endpoint')?.type).toBe('string')
    expect(byKey.get('levels')?.enumOptions).toEqual([{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }])
    expect(byKey.get('repos')?.itemKind).toBe('object')
    expect(byKey.get('repos')?.itemTitle).toBe('仓库')
    expect(byKey.get('tags')?.itemKind).toBe('string')
    expect(byKey.get('weird')?.itemKind).toBe('other')
  })

  it('renders the repo-list shape used by hypercortex_reader', () => {
    const schema = {
      type: 'object',
      properties: {
        repos: {
          type: 'array',
          title: '仓库条目',
          items: {
            type: 'object',
            title: '仓库',
            properties: { id: { type: 'string', title: '仓库 id' }, description: { type: 'string' }, key: { type: 'string', title: '访问钥匙' } },
          },
        },
      },
    }
    const draft = { repos: [{ id: 'notes', description: '主力知识库', key: 'k' }] }
    const repoField = buildConfigFields(schema, {}, draft, draft).find((field) => field.key === 'repos')
    expect(repoField?.itemKind).toBe('object')
    expect(repoField?.itemTitle).toBe('仓库')
    const rowFields = buildArrayItemFields(repoField?.schema.items, draft.repos[0], ['repos', '0'])
    expect(rowFields.map((field) => field.key)).toEqual(['id', 'description', 'key'])
    expect(rowFields[0].path.join('.')).toBe('repos.0.id')
  })

  it('renders nested object children from declared schema and existing keys', () => {
    const children = buildObjectChildFields(
      { type: 'object', properties: { id: { type: 'string', title: '编号' }, description: { type: 'string' } } },
      { id: 'notes', extra: 1 },
      ['repos', '0'],
    )
    expect(children.map((child) => child.path.join('.'))).toEqual(['repos.0.id', 'repos.0.description', 'repos.0.extra'])
    expect(children[0].label).toBe('编号')
    expect(children[0].currentValue).toBe('notes')
  })
})
