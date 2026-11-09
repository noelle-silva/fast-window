import { describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../domain/uiRefreshScope'
import { deskFlatRefs } from '../domain/desks'
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
  it('添加后写回同一份数据并只通知 entities:desks', () => {
    const h = setup()

    expect(h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')).toBe(true)

    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-1'])
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.emitScope.mock.calls.every((call) => call[0] === refreshScopes.entities('desks'))).toBe(true)
    expect(h.state.data.desks.folders.map((f: any) => f.id)).toContain('desk-root')
  })

  it('重复添加只提示，不重复写盘', () => {
    const h = setup()
    h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')
    h.save.mockClear()
    h.showToast.mockClear()

    expect(h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')).toBe(false)

    expect(deskFlatRefs(h.state.data.desks)).toHaveLength(1)
    expect(h.save).not.toHaveBeenCalled()
    expect(h.showToast).toHaveBeenCalledTimes(1)
  })

  it('移除与换位都落在同一份清单上', () => {
    const h = setup()
    h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')
    h.ops.addChatToDesk('workspace', 'ws-1', 'role-b', 'chat-2')

    h.ops.moveDeskChat('workspace::ws-1::role-b::chat-2', 'role::role-a::::chat-1')
    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-2', 'chat-1'])

    h.ops.removeChatFromDesk('workspace', 'ws-1', 'role-b', 'chat-2')
    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-1'])
  })

  it('会话或目标删除时按同一套规则清理', () => {
    const h = setup()
    h.ops.addChatToDesk('role', 'role-a', '', 'chat-1')
    h.ops.addChatToDesk('workspace', 'ws-1', 'role-b', 'chat-2')

    h.ops.cleanupDeskRefsByChatId('chat-2')
    expect(deskFlatRefs(h.state.data.desks).map((it: any) => it.chatId)).toEqual(['chat-1'])

    h.ops.cleanupDeskRefsForTarget('role', 'role-a')
    expect(deskFlatRefs(h.state.data.desks)).toEqual([])
  })
})
