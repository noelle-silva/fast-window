import { describe, expect, it } from 'vitest'
import { favoriteChatRefKey, favoriteTargetMeta, normalizeFavorites } from './favorites'

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

describe('收藏目标元信息', () => {
  const sources = {
    roles: [{ id: 'role-a', name: '角色甲', avatarImage: 'data:image/png;base64,AAAA' }],
    groups: [{ id: 'group-a', name: '群组甲', avatarImage: 'data:image/png;base64,BBBB' }],
    workspaces: [
      { id: 'ws-svg', name: '工作区甲', icon: { kind: 'svg', svg: '<svg/>', dataUrl: '' } },
      { id: 'ws-image', name: '工作区乙', icon: { kind: 'image', svg: '', dataUrl: 'data:image/webp;base64,CCCC' } },
      { id: 'ws-plain', name: '工作区丙', icon: null },
    ],
  }

  it('工作区图标走独立资源，两种载体都给出可渲染地址', () => {
    const svg = favoriteTargetMeta('workspace', 'ws-svg', sources)
    expect(svg?.name).toBe('工作区甲')
    expect(svg?.image.startsWith('data:image/svg+xml')).toBe(true)
    expect(favoriteTargetMeta('workspace', 'ws-image', sources)?.image).toBe('data:image/webp;base64,CCCC')
    expect(favoriteTargetMeta('workspace', 'ws-plain', sources)?.image).toBe('')
  })

  it('角色与群组沿用各自头像字段，找不到实体时返回 null', () => {
    expect(favoriteTargetMeta('role', 'role-a', sources)?.image).toBe('data:image/png;base64,AAAA')
    expect(favoriteTargetMeta('group', 'group-a', sources)?.image).toBe('data:image/png;base64,BBBB')
    expect(favoriteTargetMeta('workspace', 'ws-missing', sources)).toBeNull()
    expect(favoriteTargetMeta('workspace', '', sources)).toBeNull()
  })
})
