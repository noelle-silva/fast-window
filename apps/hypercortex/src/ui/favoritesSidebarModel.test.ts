import { describe, expect, it } from 'vitest'
import { buildFavoriteFolderView, isFavoriteRefActive } from './favoritesSidebarModel'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'

function ref(id: string, kind: FavoriteItemRef['kind'], targetId: string): FavoriteItemRef {
  return { id, folderId: 'root', kind, targetId, layout: { x: 0, y: 0, w: 2, h: 2 }, createdAtMs: 1, updatedAtMs: 1 }
}

function doc(refs: FavoriteItemRef[]): HyperCortexFavoritesDocV1 {
  return {
    version: 1,
    rootFolderId: 'root',
    folders: { root: { id: 'root', title: '', description: '', createdAtMs: 1, updatedAtMs: 1 } },
    refsByFolderId: { root: refs },
  }
}

const ASSET_INDEX = { 'img.png': { assetId: 'img', ext: 'png', relPath: 'Assets/img.png', fileName: 'img.png' } }

describe('buildFavoriteFolderView', () => {
  it('returns refs verbatim and maps note/asset refs into detail entries', () => {
    const refs = [
      ref('n1', 'note', 'noteA'),
      ref('n2', 'note', 'noteA'),
      ref('f1', 'folder', 'gx'),
      ref('a1', 'asset', 'img.png'),
    ]
    const view = buildFavoriteFolderView({ doc: doc(refs), folderId: 'root', assetIndex: ASSET_INDEX })
    expect(view.refs.length).toBe(4)
    expect(view.entries.map(e => ({ tabKey: e.tabKey, refId: e.ref.id }))).toEqual([
      { tabKey: 'note:noteA', refId: 'n1' },
      { tabKey: 'asset:img.png', refId: 'a1' },
    ])
  })

  it('excludes folder refs from the entries', () => {
    const view = buildFavoriteFolderView({ doc: doc([ref('f1', 'folder', 'gx')]), folderId: 'root' })
    expect(view.entries).toEqual([])
  })

  it('excludes asset refs that cannot be resolved against the index', () => {
    const view = buildFavoriteFolderView({ doc: doc([ref('a1', 'asset', 'missing.png')]), folderId: 'root', assetIndex: ASSET_INDEX })
    expect(view.entries).toEqual([])
  })

  it('keeps only the first ref per detail tab key', () => {
    const refs = [ref('n2', 'note', 'noteA'), ref('n1', 'note', 'noteA')]
    const view = buildFavoriteFolderView({ doc: doc(refs), folderId: 'root' })
    expect(view.entries.map(e => e.ref.id)).toEqual(['n2'])
  })

  it('returns an empty view for a null doc', () => {
    const view = buildFavoriteFolderView({ doc: null, folderId: 'root' })
    expect(view.refs).toEqual([])
    expect(view.entries).toEqual([])
  })

  it('returns an empty view for a folder with no refs', () => {
    const view = buildFavoriteFolderView({ doc: doc([]), folderId: 'root' })
    expect(view.entries).toEqual([])
  })
})

describe('isFavoriteRefActive', () => {
  const view = buildFavoriteFolderView({
    doc: doc([ref('n1', 'note', 'noteA'), ref('f1', 'folder', 'gx'), ref('a1', 'asset', 'img.png')]),
    folderId: 'root',
    assetIndex: ASSET_INDEX,
  })
  const [noteRef, folderRef, assetRef] = view.refs

  it('matches a note ref against its note tab key', () => {
    expect(isFavoriteRefActive(noteRef, 'note:noteA', view.lookup)).toBe(true)
  })

  it('matches an asset ref against its asset tab key', () => {
    expect(isFavoriteRefActive(assetRef, 'asset:img.png', view.lookup)).toBe(true)
  })

  it('never matches a folder ref', () => {
    expect(isFavoriteRefActive(folderRef, 'note:noteA', view.lookup)).toBe(false)
  })

  it('trims the active tab key before comparing', () => {
    expect(isFavoriteRefActive(noteRef, '  note:noteA  ', view.lookup)).toBe(true)
  })

  it('returns false for a mismatching tab key', () => {
    expect(isFavoriteRefActive(noteRef, 'note:other', view.lookup)).toBe(false)
  })
})
