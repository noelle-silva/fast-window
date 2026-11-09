import { describe, expect, it, vi } from 'vitest'
import { favoriteChatRefKey } from '../domain/favorites'
import { refreshScopes } from '../domain/uiRefreshScope'
import { createFavoritesOperations } from './favoritesOperations'

function createHarness() {
  const state: any = {
    data: {
      favorites: {
        folders: [{ id: 'fav-1', name: '收藏夹' }],
        chatRefsByFolderId: { 'fav-1': [] },
      },
    },
  }
  const emitScope = vi.fn()
  const ops = createFavoritesOperations({
    getState: () => state,
    save: async () => {},
    emitScope,
    showToast: vi.fn(),
    activeTargetKind: () => 'workspace',
    activeRole: () => null,
    activeGroup: () => null,
  })
  return { state, ops, emitScope }
}

describe('收藏夹通知地址', () => {
  it('新建、改名、删除、移动都只通知 entities:favorites', async () => {
    const harness = createHarness()
    const favoritesScope = refreshScopes.entities('favorites')

    const folderId = await harness.ops.createFavoriteFolder('新收藏夹')
    await harness.ops.renameFavoriteFolder(folderId, '重命名')
    await harness.ops.moveFavoriteFolder(folderId, '')
    await harness.ops.clearFavoriteFolderRefs(folderId)
    await harness.ops.deleteFavoriteFolderTree(folderId)

    expect(harness.emitScope.mock.calls.length).toBeGreaterThan(0)
    expect(harness.emitScope.mock.calls.every((call) => call[0] === favoritesScope)).toBe(true)
  })
})

describe('工作区会话收藏身份', () => {
  it('保存收藏时分别保留工作区编号与角色编号', async () => {
    const harness = createHarness()

    await harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-b', 'session-b1', ['fav-1'])

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1']).toMatchObject([
      { targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'session-b1' },
    ])
    expect(await harness.ops.getFavoriteFolderIdsForChat('workspace', 'ws-1', 'role-b', 'session-b1')).toEqual(['fav-1'])
    expect(await harness.ops.getFavoriteFolderIdsForChat('workspace', 'ws-1', 'role-a', 'session-b1')).toEqual([])
  })

  it('删除工作区时按工作区编号清理其全部角色下的收藏', async () => {
    const harness = createHarness()
    await harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-a', 'session-a1', ['fav-1'])
    await harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-b', 'session-b1', ['fav-1'])
    await harness.ops.setChatFavoriteFolders('workspace', 'ws-2', 'role-a', 'session-c1', ['fav-1'])

    await harness.ops.cleanupFavoriteRefsForTarget('workspace', 'ws-1')

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1']).toMatchObject([
      { targetKind: 'workspace', targetId: 'ws-2', roleId: 'role-a', chatId: 'session-c1' },
    ])
  })

  it('删除会话时按工作区编号与角色编号精确清理收藏', async () => {
    const harness = createHarness()
    await harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-a', 'session-a1', ['fav-1'])
    await harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-b', 'session-b1', ['fav-1'])

    await harness.ops.cleanupFavoriteRefsForChat('workspace', 'ws-1', 'role-b', 'session-b1')

    expect(await harness.ops.getFavoriteFolderIdsForChat('workspace', 'ws-1', 'role-b', 'session-b1')).toEqual([])
    expect(await harness.ops.getFavoriteFolderIdsForChat('workspace', 'ws-1', 'role-a', 'session-a1')).toEqual(['fav-1'])
  })

  it('角色与群聊收藏保持原有身份，不携带角色归属', async () => {
    const harness = createHarness()
    await harness.ops.setChatFavoriteFolders('role', 'role-a', '', 'session-r1', ['fav-1'])
    await harness.ops.setChatFavoriteFolders('group', 'group-a', '', 'session-g1', ['fav-1'])

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1']).toMatchObject([
      { targetKind: 'role', targetId: 'role-a', roleId: '', chatId: 'session-r1' },
      { targetKind: 'group', targetId: 'group-a', roleId: '', chatId: 'session-g1' },
    ])
    expect(await harness.ops.getFavoriteFolderIdsForChat('role', 'role-a', '', 'session-r1')).toEqual(['fav-1'])
    expect(await harness.ops.getFavoriteFolderIdsForChat('group', 'group-a', '', 'session-g1')).toEqual(['fav-1'])
  })
})

describe('收藏夹层级排序与会话移动', () => {
  function rootFolderIds(harness: ReturnType<typeof createHarness>) {
    return harness.state.data.favorites.folders
      .filter((folder: any) => String(folder.parentId || '') === '')
      .map((folder: any) => folder.id)
  }

  it('同层文件夹按给定顺序重排，其他层不受影响', async () => {
    const harness = createHarness()
    const a = await harness.ops.createFavoriteFolder('甲')
    const b = await harness.ops.createFavoriteFolder('乙')
    const child = await harness.ops.createFavoriteFolder('子', a)

    await harness.ops.reorderFavoriteFolders('', [b, a, 'fav-1'])

    expect(rootFolderIds(harness)).toEqual([b, a, 'fav-1'])
    expect(harness.state.data.favorites.folders.find((folder: any) => folder.id === child).parentId).toBe(a)
  })

  it('序列只覆盖部分同层文件夹时，未列出的按原顺序补在末尾', async () => {
    const harness = createHarness()
    const a = await harness.ops.createFavoriteFolder('甲')
    const b = await harness.ops.createFavoriteFolder('乙')

    await harness.ops.reorderFavoriteFolders('', [b])

    expect(rootFolderIds(harness)).toEqual([b, 'fav-1', a])
  })

  it('层内会话按给定顺序重排', async () => {
    const harness = createHarness()
    await harness.ops.setChatFavoriteFolders('role', 'role-a', '', 'chat-1', ['fav-1'])
    await harness.ops.setChatFavoriteFolders('role', 'role-a', '', 'chat-2', ['fav-1'])
    const key1 = favoriteChatRefKey('role', 'role-a', '', 'chat-1')
    const key2 = favoriteChatRefKey('role', 'role-a', '', 'chat-2')

    await harness.ops.reorderFavoriteChatRefs('fav-1', [key2, key1])

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1'].map((ref: any) => ref.chatId)).toEqual(['chat-2', 'chat-1'])
  })

  it('把会话移进目标文件夹，落在末尾且不留在原层', async () => {
    const harness = createHarness()
    const target = String(await harness.ops.createFavoriteFolder('目标'))
    await harness.ops.setChatFavoriteFolders('role', 'role-a', '', 'chat-1', ['fav-1'])
    await harness.ops.setChatFavoriteFolders('role', 'role-a', '', 'chat-2', ['fav-1'])
    const key1 = favoriteChatRefKey('role', 'role-a', '', 'chat-1')

    await harness.ops.moveFavoriteChatRef(key1, target)

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1'].map((ref: any) => ref.chatId)).toEqual(['chat-2'])
    expect(harness.state.data.favorites.chatRefsByFolderId[target].map((ref: any) => ref.chatId)).toEqual(['chat-1'])
  })

  it('层内有失效引用时，可见项仍能排序，失效项留在末尾', async () => {
    const harness = createHarness()
    await harness.ops.setChatFavoriteFolders('role', 'role-a', '', 'chat-1', ['fav-1'])
    await harness.ops.setChatFavoriteFolders('role', 'role-a', '', 'chat-2', ['fav-1'])
    harness.state.data.favorites.chatRefsByFolderId['fav-1'].push({
      targetKind: 'role',
      targetId: 'role-gone',
      roleId: '',
      chatId: 'chat-gone',
      addedAt: 3,
    })
    const key1 = favoriteChatRefKey('role', 'role-a', '', 'chat-1')
    const key2 = favoriteChatRefKey('role', 'role-a', '', 'chat-2')

    await harness.ops.reorderFavoriteChatRefs('fav-1', [key2, key1])

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1'].map((ref: any) => ref.chatId)).toEqual([
      'chat-2',
      'chat-1',
      'chat-gone',
    ])
  })
})
