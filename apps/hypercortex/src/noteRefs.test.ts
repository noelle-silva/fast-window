import { describe, expect, it, vi } from 'vitest'
import {
  backlinksFromRelations,
  extractRefsFromText,
  faceBacklinksFromRelations,
  isBacklinkStaleFromRelations,
  type NoteRefRelationEdge,
} from './noteRefs'

/**
 * 行为锁定测试（084 · 拆分期护栏）：
 * 锁定占位符提取与由引用边推导反链/失效判定的纯逻辑行为。
 */

function edge(fromNoteId: string, toNoteId: string, opts: { fromFaceId?: string; toFaceId?: string } = {}): NoteRefRelationEdge {
  return { fromNoteId, toNoteId, ...opts }
}

describe('extractRefsFromText', () => {
  it('returns nothing for empty or non-placeholder text', () => {
    expect(extractRefsFromText('')).toEqual([])
    expect(extractRefsFromText(null as unknown as string)).toEqual([])
    expect(extractRefsFromText('plain text without refs')).toEqual([])
  })

  it('extracts a note-level reference', () => {
    expect(extractRefsFromText('see [[note_id=n1]] here')).toEqual([{ noteId: 'n1', faceId: undefined }])
  })

  it('extracts a face reference', () => {
    expect(extractRefsFromText('[[note_id=n1|face=f1]]')).toEqual([{ noteId: 'n1', faceId: 'f1' }])
  })

  it('dedupes identical noteId + face pairs', () => {
    expect(extractRefsFromText('[[note_id=n1]][[note_id=n1]]')).toEqual([{ noteId: 'n1', faceId: undefined }])
  })

  it('keeps the same note id with different faces as separate refs', () => {
    expect(extractRefsFromText('[[note_id=n1|face=f1]][[note_id=n1|face=f2]]')).toEqual([
      { noteId: 'n1', faceId: 'f1' },
      { noteId: 'n1', faceId: 'f2' },
    ])
  })

  it('preserves first-seen order', () => {
    expect(extractRefsFromText('[[note_id=b]][[note_id=a]]')).toEqual([
      { noteId: 'b', faceId: undefined },
      { noteId: 'a', faceId: undefined },
    ])
  })

  it('trims the inner body and treats a blank face as undefined', () => {
    expect(extractRefsFromText('[[  note_id=n1 | face=  ]]')).toEqual([{ noteId: 'n1', faceId: undefined }])
  })

  it('ignores placeholders that do not parse to a note id', () => {
    expect(extractRefsFromText('[[hello]] [[face=f1]] [[note_id=]]')).toEqual([])
  })

  it('does not match placeholders spanning a newline', () => {
    expect(extractRefsFromText('[[note_id=n1\nface=f1]]')).toEqual([])
  })
})

describe('backlinksFromRelations', () => {
  it('returns nothing for a blank target or no edges', () => {
    expect(backlinksFromRelations([], 'n1')).toEqual([])
    expect(backlinksFromRelations([edge('a', 'n1')], '   ')).toEqual([])
  })

  it('derives a whole-note backlink from a face-less edge', () => {
    expect(backlinksFromRelations([edge('a', 'n1')], 'n1')).toEqual([{ noteId: 'a' }])
  })

  it('preserves the source face and records the target face', () => {
    expect(backlinksFromRelations([edge('a', 'n1', { fromFaceId: 'af', toFaceId: 'tf' })], 'n1')).toEqual([
      { noteId: 'a', faceId: 'tf', fromFaceId: 'af' },
    ])
  })

  it('keeps the first face-target edge per source note', () => {
    expect(backlinksFromRelations([edge('a', 'n1', { toFaceId: 'f1' }), edge('a', 'n1', { toFaceId: 'f2' })], 'n1')).toEqual([
      { noteId: 'a', faceId: 'f1' },
    ])
  })

  it('lets a later whole-note edge replace a face backlink', () => {
    expect(backlinksFromRelations([edge('a', 'n1', { toFaceId: 'f1' }), edge('a', 'n1')], 'n1')).toEqual([
      { noteId: 'a' },
    ])
  })

  it('ignores later face edges once a whole-note backlink exists', () => {
    expect(backlinksFromRelations([edge('a', 'n1'), edge('a', 'n1', { toFaceId: 'f1' })], 'n1')).toEqual([
      { noteId: 'a' },
    ])
  })

  it('ignores edges to other targets and blank sources', () => {
    expect(backlinksFromRelations([edge('a', 'other'), edge('', 'n1'), edge('b', 'n1')], 'n1')).toEqual([{ noteId: 'b' }])
  })

  it('trims the target id and source face', () => {
    expect(backlinksFromRelations([edge(' a ', ' n1 ', { fromFaceId: '  ' })], ' n1 ')).toEqual([{ noteId: 'a' }])
  })
})

describe('faceBacklinksFromRelations', () => {
  it('returns nothing for a blank target note or face', () => {
    expect(faceBacklinksFromRelations([edge('a', 'n1', { toFaceId: 'f1' })], '', 'f1')).toEqual([])
    expect(faceBacklinksFromRelations([edge('a', 'n1', { toFaceId: 'f1' })], 'n1', '')).toEqual([])
  })

  it('keeps only edges targeting the requested face', () => {
    expect(faceBacklinksFromRelations([
      edge('a', 'n1', { toFaceId: 'f1' }),
      edge('b', 'n1', { toFaceId: 'f2' }),
      edge('c', 'n1'),
    ], 'n1', 'f1')).toEqual([{ noteId: 'a', faceId: 'f1' }])
  })

  it('preserves the source face', () => {
    expect(faceBacklinksFromRelations([edge('a', 'n1', { fromFaceId: 'af', toFaceId: 'f1' })], 'n1', 'f1')).toEqual([
      { noteId: 'a', faceId: 'f1', fromFaceId: 'af' },
    ])
  })

  it('lets the last edge per source note win', () => {
    expect(faceBacklinksFromRelations([edge('a', 'n1', { toFaceId: 'f1', fromFaceId: 'x' }), edge('a', 'n1', { toFaceId: 'f1', fromFaceId: 'y' })], 'n1', 'f1')).toEqual([
      { noteId: 'a', faceId: 'f1', fromFaceId: 'y' },
    ])
  })

  it('trims ids and faces before matching', () => {
    expect(faceBacklinksFromRelations([edge(' a ', ' n1 ', { toFaceId: ' f1 ' })], 'n1', 'f1')).toEqual([
      { noteId: 'a', faceId: 'f1' },
    ])
  })
})

describe('isBacklinkStaleFromRelations', () => {
  it('returns false for a blank target or source', () => {
    expect(isBacklinkStaleFromRelations([edge('a', 'n1', { toFaceId: 'f1' })], '', 'a', () => false)).toBe(false)
    expect(isBacklinkStaleFromRelations([edge('a', 'n1', { toFaceId: 'f1' })], 'n1', '', () => false)).toBe(false)
  })

  it('returns false when there is no matching edge', () => {
    expect(isBacklinkStaleFromRelations([edge('b', 'n1', { toFaceId: 'f1' })], 'n1', 'a', () => false)).toBe(false)
  })

  it('treats a whole-note edge as not stale', () => {
    expect(isBacklinkStaleFromRelations([edge('a', 'n1')], 'n1', 'a', () => false)).toBe(false)
  })

  it('is stale only when every matching face is missing', () => {
    expect(isBacklinkStaleFromRelations([edge('a', 'n1', { toFaceId: 'f1' })], 'n1', 'a', () => false)).toBe(true)
    expect(isBacklinkStaleFromRelations([edge('a', 'n1', { toFaceId: 'f1' })], 'n1', 'a', () => true)).toBe(false)
  })

  it('is not stale when any matching edge points at an existing face', () => {
    const faceExists = (faceId: string) => faceId === 'f1'
    expect(isBacklinkStaleFromRelations([
      edge('a', 'n1', { toFaceId: 'f1' }),
      edge('a', 'n1', { toFaceId: 'f2' }),
    ], 'n1', 'a', faceExists)).toBe(false)
  })

  it('is stale when all matching edges point at missing faces', () => {
    expect(isBacklinkStaleFromRelations([
      edge('a', 'n1', { toFaceId: 'f1' }),
      edge('a', 'n1', { toFaceId: 'f2' }),
    ], 'n1', 'a', () => false)).toBe(true)
  })

  it('ignores edges from other sources or to other targets', () => {
    expect(isBacklinkStaleFromRelations([
      edge('b', 'n1', { toFaceId: 'f1' }),
      edge('a', 'other', { toFaceId: 'f1' }),
    ], 'n1', 'a', () => false)).toBe(false)
  })

  it('trims ids and asks about the trimmed face id', () => {
    const faceExists = vi.fn(() => false)
    expect(isBacklinkStaleFromRelations([edge(' a ', ' n1 ', { toFaceId: ' f1 ' })], ' n1 ', ' a ', faceExists)).toBe(true)
    expect(faceExists).toHaveBeenCalledWith('f1')
  })
})
