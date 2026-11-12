import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../domain/uiRefreshScope'
import { deskChatRowId, deskFlatRefs } from '../domain/desks'
import { addDeskDraft, findDeskDraftByPending, resetDeskDrafts } from '../domain/deskDrafts'
import { createDeskOperations } from './deskOperations'

function setup(desks: any = { folders: [], chatRefsByFolderId: {} }) {
  const state: any = { data: { desks } }
  const emitScope = vi.fn()
  const save = vi.fn(async () => {})
  const showToast = vi.fn()
  const ops = createDeskOperations({ getState: () => state, save, emitScope, showToast })
  return { state, emitScope, save, showToast, ops }
}

describe('工作桌面动作（后端 sessions/desks 那一份）', () => {
  beforeEach(() => {
    resetDeskDrafts()
  })

  it('添加后写回同一份数据并只通知 entities:desks', async () => {
    const h = setup()

    expect(await h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')).toBe(true)

    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-1'])
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.emitScope.mock.calls.every((call) => call[0] === refreshScopes.entities('desks'))).toBe(true)
    expect(h.state.data.desks.items).toHaveLength(1)
  })

  it('重复添加只提示，不重复写盘', async () => {
    const h = setup()
    await h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')
    h.save.mockClear()
    h.showToast.mockClear()

    expect(await h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')).toBe(false)

    expect(deskFlatRefs(h.state.data.desks)).toHaveLength(1)
    expect(h.save).not.toHaveBeenCalled()
    expect(h.showToast).toHaveBeenCalledTimes(1)
  })

  it('移除与换位都落在同一份清单上', async () => {
    const h = setup()
    await h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')
    await h.ops.addChatToDesk('workspace', 'ws-1', 'role-b', 'chat-2')

    await h.ops.moveDeskUnit(
      deskChatRowId('workspace::ws-1::role-b::chat-2'),
      deskChatRowId('role::role-a::::chat-1'),
    )
    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-2', 'chat-1'])

    await h.ops.removeChatFromDesk('workspace', 'ws-1', 'role-b', 'chat-2')
    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-1'])
  })

  it('会话或目标删除时按同一套规则清理', async () => {
    const h = setup()
    await h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')
    await h.ops.addChatToDesk('workspace', 'ws-1', 'role-b', 'chat-2')

    await h.ops.cleanupDeskRefsByChatId('chat-2')
    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-1'])

    await h.ops.cleanupDeskRefsForTarget('role', 'role-a')
    expect(deskFlatRefs(h.state.data.desks)).toEqual([])
  })
  it('临时条目转正：按草稿原位插入，成功后摘掉草稿', async () => {
    const h = setup()
    await h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')

    addDeskDraft({ pendingChatId: 'draft-1', targetKind: 'role', targetId: 'role-a', title: '新聊天' })
    expect(await h.ops.promoteDeskDraft('draft-1', 'chat-9')).toBe(true)

    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-9', 'chat-1'])
    expect(findDeskDraftByPending('draft-1')).toBeNull()
  })

  it('转正写后端失败时，草稿保留、桌面不变', async () => {
    const h = setup()
    addDeskDraft({ pendingChatId: 'draft-2', targetKind: 'role', targetId: 'role-a' })
    h.save.mockRejectedValueOnce(new Error('写失败'))

    expect(await h.ops.promoteDeskDraft('draft-2', 'chat-9')).toBe(false)

    expect(deskFlatRefs(h.state.data.desks)).toEqual([])
    expect(findDeskDraftByPending('draft-2')).not.toBeNull()
  })

  it('写后端失败时界面不生效：既不加条目，也不发通知', async () => {
    const h = setup()
    h.save.mockRejectedValueOnce(new Error('未知 storage key：sessions/desks'))

    expect(await h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')).toBe(false)

    expect(deskFlatRefs(h.state.data.desks)).toEqual([])
    expect(h.emitScope).not.toHaveBeenCalled()
    expect(h.showToast).toHaveBeenCalledTimes(1)
  })
})
