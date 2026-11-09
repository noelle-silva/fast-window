import { describe, expect, it } from 'vitest'
import {
  createFavoriteFolderNav,
  goBackFavoriteFolder,
  navigateFavoriteFolder,
  reconcileFavoriteFolderNav,
} from './favoriteFolderNavigator'

describe('收藏夹层级导航', () => {
  it('默认停在根层，没有来路', () => {
    const nav = createFavoriteFolderNav()
    expect(nav.currentFolderId).toBe('')
    expect(nav.back).toEqual([])
  })

  it('下钻把当前层压入来路，返回沿来路回退', () => {
    let nav = navigateFavoriteFolder(createFavoriteFolderNav(), 'f1')
    nav = navigateFavoriteFolder(nav, 'f2')
    expect(nav.currentFolderId).toBe('f2')
    expect(nav.back).toEqual(['', 'f1'])

    nav = goBackFavoriteFolder(nav)
    expect(nav.currentFolderId).toBe('f1')
    nav = goBackFavoriteFolder(nav)
    expect(nav.currentFolderId).toBe('')
    expect(nav.back).toEqual([])
  })

  it('重复进入同一层不产生历史，根层返回原样', () => {
    const atRoot = createFavoriteFolderNav()
    expect(navigateFavoriteFolder(atRoot, '')).toBe(atRoot)
    expect(goBackFavoriteFolder(atRoot)).toBe(atRoot)

    const nav = navigateFavoriteFolder(atRoot, 'f1')
    expect(navigateFavoriteFolder(nav, 'f1')).toBe(nav)
  })

  it('当前层失效回到根，来路里失效的层一并剔除', () => {
    let nav = navigateFavoriteFolder(createFavoriteFolderNav(), 'f1')
    nav = navigateFavoriteFolder(nav, 'f2')

    expect(reconcileFavoriteFolderNav(nav, new Set(['f1', 'f2']))).toBe(nav)

    const dropped = reconcileFavoriteFolderNav(nav, new Set(['f1']))
    expect(dropped.currentFolderId).toBe('')
    expect(dropped.back).toEqual([])

    const trimmed = reconcileFavoriteFolderNav(navigateFavoriteFolder(nav, 'f3'), new Set(['f1', 'f3']))
    expect(trimmed.currentFolderId).toBe('f3')
    expect(trimmed.back).toEqual(['', 'f1'])
  })
})
