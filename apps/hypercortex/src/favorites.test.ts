import { describe, expect, it } from 'vitest'
import {
  canMoveRefToFolder,
  moveRef,
  resolveMoveDropTargetRefId,
  type FavoriteFolder,
  type FavoriteItemRef,
  type HyperCortexFavoritesDocV1,
} from './favorites'

function folder(id: string): FavoriteFolder {
  return { id, title: id, description: '', createdAtMs: 1, updatedAtMs: 1 }
}

function itemRef(id: string, folderId: string, kind: FavoriteItemRef['kind'], targetId: string): FavoriteItemRef {
  return { id, folderId, kind, targetId, layout: { x: 0, y: 0, w: 2, h: 2 }, createdAtMs: 1, updatedAtMs: 1 }
}

// root › a › b，另有平级 c；b 里有一条 note 引用。
function fixture(): HyperCortexFavoritesDocV1 {
  return {
    version: 1,
    rootFolderId: 'root',
    folders: { root: folder('root'), a: folder('a'), b: folder('b'), c: folder('c') },
    refsByFolderId: {
      root: [itemRef('ref-a', 'root', 'folder', 'a')],
      a: [itemRef('ref-b', 'a', 'folder', 'b')],
      b: [itemRef('ref-note', 'b', 'note', 'n1')],
      c: [],
    },
  }
}

describe('canMoveRefToFolder', () => {
  it('allows note refs to move into any other existing folder', () => {
    const doc = fixture()
    const noteRef = doc.refsByFolderId.b[0]
    expect(canMoveRefToFolder(doc, noteRef, 'root')).toBe(true)
    expect(canMoveRefToFolder(doc, noteRef, 'a')).toBe(true)
    expect(canMoveRefToFolder(doc, noteRef, 'c')).toBe(true)
  })

  it('rejects blank, missing and origin folders', () => {
    const doc = fixture()
    const noteRef = doc.refsByFolderId.b[0]
    expect(canMoveRefToFolder(doc, noteRef, '')).toBe(false)
    expect(canMoveRefToFolder(doc, noteRef, '  ')).toBe(false)
    expect(canMoveRefToFolder(doc, noteRef, 'missing')).toBe(false)
    const here = itemRef('ref-here', 'c', 'note', 'n1')
    expect(canMoveRefToFolder(doc, here, 'c')).toBe(false)
  })

  it('rejects moving a folder ref into itself or its descendants', () => {
    const doc = fixture()
    const folderA = doc.refsByFolderId.root[0]
    expect(canMoveRefToFolder(doc, folderA, 'a')).toBe(false)
    expect(canMoveRefToFolder(doc, folderA, 'b')).toBe(false)
  })

  it('allows moving a folder ref into an ancestor or unrelated folder', () => {
    const doc = fixture()
    const folderB = doc.refsByFolderId.a[0]
    expect(canMoveRefToFolder(doc, folderB, 'root')).toBe(true)
    expect(canMoveRefToFolder(doc, folderB, 'c')).toBe(true)
  })
})

describe('resolveMoveDropTargetRefId', () => {
  it('resolves a hovered folder ref that can accept the dragged ref', () => {
    const doc = fixture()
    expect(resolveMoveDropTargetRefId(doc, 'ref-note', 'ref-a')).toBe('ref-a')
  })

  it('ignores hovered non-folder, missing and mismatched refs', () => {
    const doc = fixture()
    expect(resolveMoveDropTargetRefId(doc, 'ref-note', 'ref-note')).toBe('')
    expect(resolveMoveDropTargetRefId(doc, 'ref-note', 'missing')).toBe('')
    expect(resolveMoveDropTargetRefId(doc, 'missing', 'ref-a')).toBe('')
  })

  it('ignores illegal targets such as cycles and self references', () => {
    const doc = fixture()
    expect(resolveMoveDropTargetRefId(doc, 'ref-a', 'ref-b')).toBe('')
    expect(resolveMoveDropTargetRefId(doc, 'ref-a', 'ref-a')).toBe('')
  })
})

describe('moveRef target filtering', () => {
  it('moves a ref to the target and drops the source reference', () => {
    const doc = fixture()
    const result = moveRef(doc, 'ref-note', ['c'])
    expect(result.outcome).toBe('moved')
    expect(result.movedCount).toBe(1)
    expect(result.skippedCount).toBe(0)
    expect(result.doc).not.toBe(doc)
    expect(result.doc.refsByFolderId.b).toHaveLength(0)
    expect(result.doc.refsByFolderId.c.map(ref => ref.targetId)).toEqual(['n1'])
  })

  it('reports no-target and keeps the doc when every target is illegal', () => {
    const doc = fixture()
    const cyclic = moveRef(doc, 'ref-a', ['b'])
    expect(cyclic.outcome).toBe('no-target')
    expect(cyclic.doc).toBe(doc)
    expect(cyclic.skippedCount).toBe(1)

    const self = moveRef(doc, 'ref-a', ['a'])
    expect(self.outcome).toBe('no-target')
    expect(self.doc).toBe(doc)
    expect(self.skippedCount).toBe(1)
  })

  it('ignores the source folder among targets', () => {
    const doc = fixture()
    const result = moveRef(doc, 'ref-note', ['b', 'c'])
    expect(result.outcome).toBe('moved')
    expect(result.movedCount).toBe(1)
    expect(result.doc.refsByFolderId.b).toHaveLength(0)
    expect(result.doc.refsByFolderId.c).toHaveLength(1)
  })

  it('treats an already-present target as landed and still removes the source', () => {
    const doc = fixture()
    doc.refsByFolderId.c.push(itemRef('ref-note-copy', 'c', 'note', 'n1'))
    const result = moveRef(doc, 'ref-note', ['c'])
    expect(result.outcome).toBe('moved')
    expect(result.movedCount).toBe(1)
    expect(result.doc.refsByFolderId.b).toHaveLength(0)
    expect(result.doc.refsByFolderId.c).toHaveLength(1)
  })
})
