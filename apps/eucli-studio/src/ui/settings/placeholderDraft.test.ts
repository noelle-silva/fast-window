import { describe, expect, it } from 'vitest'
import {
  addDraftPlaceholder,
  computeDirtyNames,
  createPlaceholderDraft,
  markDraftPlaceholderSaved,
  planPlaceholderSave,
  removeDraftPlaceholder,
  renameDraftPlaceholder,
  serverIdentityOf,
  setDraftFolderMembership,
  updateDraftPlaceholder,
  type PlaceholderDraft,
} from './placeholderDraft'
import type { PlaceholderLibrary } from '../../domain/placeholder'

function baseLibrary(): PlaceholderLibrary {
  return {
    placeholders: [{ name: 'a', value: '1', description: '', createdAt: '2024-01-01T00:00:00.000Z' }],
    folders: [{ id: 'f1', name: '常用', parentId: '', placeholderNames: ['a'], createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
  }
}

function newItem(name: string) {
  return { name, value: '', description: '', createdAt: '2024-01-02T00:00:00.000Z' }
}

function saveAndMark(base: PlaceholderLibrary, draft: PlaceholderDraft, name: string, membership?: Record<string, boolean>) {
  const plan = planPlaceholderSave(base, draft, name, membership)
  if (!plan.ok) throw new Error(plan.error)
  return { saved: plan.library, draft: markDraftPlaceholderSaved(draft, name) }
}

describe('placeholderDraft', () => {
  it('新建后未改名：保存一次即干净', () => {
    const base = baseLibrary()
    const created = newItem('新占位符')
    const draft = addDraftPlaceholder(createPlaceholderDraft(base), created)
    const serverAfterCreate = { ...base, placeholders: base.placeholders.concat(created) }
    const { saved, draft: marked } = saveAndMark(serverAfterCreate, draft, created.name)
    expect(computeDirtyNames(saved, marked)).toEqual(new Set())
  })

  it('新建后改名：保存一次即干净（回归）', () => {
    const base = baseLibrary()
    const created = newItem('新占位符')
    const serverAfterCreate = { ...base, placeholders: base.placeholders.concat(created) }
    const afterCreate = addDraftPlaceholder(createPlaceholderDraft(base), created)
    const renamed = renameDraftPlaceholder(afterCreate, afterCreate.library.placeholders.length - 1, 'myVar')

    expect(serverIdentityOf(renamed, 'myVar')).toBe('新占位符')
    expect(computeDirtyNames(serverAfterCreate, renamed).has('myVar')).toBe(true)

    const { saved, draft: marked } = saveAndMark(serverAfterCreate, renamed, 'myVar')
    expect(saved.placeholders.some((item) => item.name === 'myVar')).toBe(true)
    expect(saved.placeholders.some((item) => item.name === '新占位符')).toBe(false)
    expect(computeDirtyNames(saved, marked)).toEqual(new Set())
  })

  it('修改已有占位符的值：保存一次即干净', () => {
    const base = baseLibrary()
    const draft0 = createPlaceholderDraft(base)
    const edited = updateDraftPlaceholder(draft0, 0, { value: '2' })
    expect(computeDirtyNames(base, edited).has('a')).toBe(true)

    const { saved, draft: marked } = saveAndMark(base, edited, 'a')
    expect(computeDirtyNames(saved, marked)).toEqual(new Set())
  })

  it('已有占位符改名：保存时按服务端原名替换，收藏归属跟随改名', () => {
    const base = baseLibrary()
    const renamed = renameDraftPlaceholder(createPlaceholderDraft(base), 0, 'b')
    expect(serverIdentityOf(renamed, 'b')).toBe('a')
    expect(computeDirtyNames(base, renamed).has('b')).toBe(true)

    const { saved, draft: marked } = saveAndMark(base, renamed, 'b')
    expect(saved.placeholders.map((item) => item.name)).toEqual(['b'])
    expect(saved.folders[0].placeholderNames).toEqual(['b'])
    expect(computeDirtyNames(saved, marked)).toEqual(new Set())
  })

  it('收藏归属改动：保存一次即干净', () => {
    const base = baseLibrary()
    const removed = setDraftFolderMembership(createPlaceholderDraft(base), 'a', {})
    expect(computeDirtyNames(base, removed).has('a')).toBe(true)

    const { saved, draft: marked } = saveAndMark(base, removed, 'a', {})
    expect(saved.folders[0].placeholderNames).toEqual([])
    expect(computeDirtyNames(saved, marked)).toEqual(new Set())
  })

  it('删除占位符会同时清掉收藏归属与基线', () => {
    const base = baseLibrary()
    const removed = removeDraftPlaceholder(createPlaceholderDraft(base), 'a')
    expect(removed.library.placeholders).toEqual([])
    expect(removed.library.folders[0].placeholderNames).toEqual([])
    expect(removed.baselines.a).toBeUndefined()
  })

  it('重名时拒绝保存', () => {
    const base = baseLibrary()
    const draft = addDraftPlaceholder(addDraftPlaceholder(createPlaceholderDraft(base), newItem('x')), newItem('x'))
    const plan = planPlaceholderSave(base, draft, 'x')
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.error).toContain('唯一')
  })
})
