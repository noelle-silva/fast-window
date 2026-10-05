import { describe, expect, it } from 'vitest'
import { mergeNoteResources } from './noteResources'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 锁定资源清单合并的键规则、去重顺序与字段归一化行为。
 */

describe('mergeNoteResources', () => {
  it('returns an empty list when nothing is provided', () => {
    expect(mergeNoteResources([], [])).toEqual([])
  })

  it('dedupes by asset id when no extension is present', () => {
    expect(mergeNoteResources([{ assetId: 'a' }], [{ assetId: 'a' }])).toEqual([{ assetId: 'a' }])
  })

  it('keys entries by asset id plus lowercased extension', () => {
    expect(mergeNoteResources([], [{ assetId: 'a', ext: 'PNG' }, { assetId: 'a', ext: 'png' }])).toEqual([
      { assetId: 'a', ext: 'png' },
    ])
    expect(mergeNoteResources([], [{ assetId: 'a', ext: 'png' }, { assetId: 'a', ext: 'jpg' }])).toEqual([
      { assetId: 'a', ext: 'png' },
      { assetId: 'a', ext: 'jpg' },
    ])
  })

  it('lets later entries override fields while keeping first-seen order', () => {
    expect(mergeNoteResources(
      [{ assetId: 'a', name: 'first' }, { assetId: 'b' }],
      [{ assetId: 'a', name: 'second' }, { assetId: 'c' }],
    )).toEqual([
      { assetId: 'a', name: 'second' },
      { assetId: 'b' },
      { assetId: 'c' },
    ])
  })

  it('skips entries without a usable asset id', () => {
    expect(mergeNoteResources([{ assetId: '' }, { assetId: '   ' }, { assetId: 'a' }], [])).toEqual([{ assetId: 'a' }])
    expect(mergeNoteResources([], [{ assetId: '', ext: 'png' }])).toEqual([])
  })

  it('trims ids and fields, mapping blank optional fields to undefined', () => {
    expect(mergeNoteResources([], [{ assetId: ' a ', mime: '  ', ext: ' PNG ', kind: '  ', name: '  n  ' }])).toEqual([
      { assetId: 'a', ext: 'png', name: 'n' },
    ])
  })

  it('coerces non-string ids to strings', () => {
    expect(mergeNoteResources([], [{ assetId: 123 as unknown as string }])).toEqual([{ assetId: '123' }])
  })

  it('drops the transient marker field from the merged result', () => {
    expect(mergeNoteResources([], [{ assetId: 'a', marker: '{{asset:a}}' }])).toEqual([{ assetId: 'a' }])
  })
})
