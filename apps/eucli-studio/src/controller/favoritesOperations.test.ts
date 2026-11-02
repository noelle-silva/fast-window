import { describe, expect, it, vi } from 'vitest'
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
  it('新建、改名、删除、移动都只通知 entities:favorites', () => {
    const harness = createHarness()
    const favoritesScope = refreshScopes.entities('favorites')

    const folderId = harness.ops.createFavoriteFolder('新收藏夹')
    harness.ops.renameFavoriteFolder(folderId, '重命名')
    harness.ops.moveFavoriteFolder(folderId, '')
    harness.ops.clearFavoriteFolderRefs(folderId)
    harness.ops.deleteFavoriteFolderTree(folderId)

    expect(harness.emitScope.mock.calls.length).toBeGreaterThan(0)
    expect(harness.emitScope.mock.calls.every((call) => call[0] === favoritesScope)).toBe(true)
  })
})

describe('工作区会话收藏身份', () => {
  it('保存收藏时分别保留工作区编号与角色编号', () => {
    const harness = createHarness()

    harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-b', 'session-b1', ['fav-1'])

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1']).toMatchObject([
      { targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'session-b1' },
    ])
    expect(harness.ops.getFavoriteFolderIdsForChat('workspace', 'ws-1', 'role-b', 'session-b1')).toEqual(['fav-1'])
    expect(harness.ops.getFavoriteFolderIdsForChat('workspace', 'ws-1', 'role-a', 'session-b1')).toEqual([])
  })

  it('删除工作区时按工作区编号清理其全部角色下的收藏', () => {
    const harness = createHarness()
    harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-a', 'session-a1', ['fav-1'])
    harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-b', 'session-b1', ['fav-1'])
    harness.ops.setChatFavoriteFolders('workspace', 'ws-2', 'role-a', 'session-c1', ['fav-1'])

    harness.ops.cleanupFavoriteRefsForTarget('workspace', 'ws-1')

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1']).toMatchObject([
      { targetKind: 'workspace', targetId: 'ws-2', roleId: 'role-a', chatId: 'session-c1' },
    ])
  })

  it('删除会话时按工作区编号与角色编号精确清理收藏', () => {
    const harness = createHarness()
    harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-a', 'session-a1', ['fav-1'])
    harness.ops.setChatFavoriteFolders('workspace', 'ws-1', 'role-b', 'session-b1', ['fav-1'])

    harness.ops.cleanupFavoriteRefsForChat('workspace', 'ws-1', 'role-b', 'session-b1')

    expect(harness.ops.getFavoriteFolderIdsForChat('workspace', 'ws-1', 'role-b', 'session-b1')).toEqual([])
    expect(harness.ops.getFavoriteFolderIdsForChat('workspace', 'ws-1', 'role-a', 'session-a1')).toEqual(['fav-1'])
  })

  it('角色与群聊收藏保持原有身份，不携带角色归属', () => {
    const harness = createHarness()
    harness.ops.setChatFavoriteFolders('role', 'role-a', '', 'session-r1', ['fav-1'])
    harness.ops.setChatFavoriteFolders('group', 'group-a', '', 'session-g1', ['fav-1'])

    expect(harness.state.data.favorites.chatRefsByFolderId['fav-1']).toMatchObject([
      { targetKind: 'role', targetId: 'role-a', roleId: '', chatId: 'session-r1' },
      { targetKind: 'group', targetId: 'group-a', roleId: '', chatId: 'session-g1' },
    ])
    expect(harness.ops.getFavoriteFolderIdsForChat('role', 'role-a', '', 'session-r1')).toEqual(['fav-1'])
    expect(harness.ops.getFavoriteFolderIdsForChat('group', 'group-a', '', 'session-g1')).toEqual(['fav-1'])
  })
})
