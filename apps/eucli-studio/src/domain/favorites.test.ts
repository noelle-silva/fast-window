import { describe, expect, it } from 'vitest'
import { favoriteChatRefKey, normalizeFavorites } from './favorites'

describe('收藏会话地址', () => {
  it('工作区会话收藏保留独立工作区编号与角色编号', () => {
    const favorites = normalizeFavorites({
      folders: [{ id: 'fav-1', name: '收藏夹' }],
      chatRefsByFolderId: {
        'fav-1': [{ targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-a', chatId: 'session-1', addedAt: 1 }],
      },
    })

    expect(favorites.chatRefsByFolderId['fav-1']).toMatchObject([
      { targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-a', chatId: 'session-1' },
    ])
  })

  it('工作区收藏缺少角色编号时丢弃，不同角色的同号会话互不冲突', () => {
    const favorites = normalizeFavorites({
      folders: [{ id: 'fav-1', name: '收藏夹' }],
      chatRefsByFolderId: {
        'fav-1': [
          { targetKind: 'workspace', targetId: 'ws-1', chatId: 'session-1', addedAt: 1 },
          { targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-a', chatId: 'session-1', addedAt: 1 },
          { targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'session-1', addedAt: 1 },
        ],
      },
    })

    expect(favorites.chatRefsByFolderId['fav-1'].map((ref: any) => ref.roleId)).toEqual(['role-a', 'role-b'])
    expect(favoriteChatRefKey('workspace', 'ws-1', 'role-a', 'session-1')).not.toBe(favoriteChatRefKey('workspace', 'ws-1', 'role-b', 'session-1'))
  })
})
