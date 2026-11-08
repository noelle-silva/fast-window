import { describe, expect, it, vi } from 'vitest'
import { createDeskActions } from './deskActions'

function setup(settings: Record<string, any> = {}) {
  const state: any = { data: { settings } }
  const emitScope = vi.fn()
  const saveMeta = vi.fn(async () => {})
  const showToast = vi.fn()
  const actions = createDeskActions({ state, emitScope, saveMeta, showToast })
  return { state, emitScope, saveMeta, showToast, actions }
}

function refsOf(state: any) {
  return (state.data.settings.desk?.refs || []).map((it: any) => it.chatId)
}

describe('工作桌面动作', () => {
  it('添加会话后落盘并发出设置地址刷新', () => {
    const { state, emitScope, saveMeta, actions } = setup()

    expect(actions.addChatToDesk('role', 'role-a', '', 'chat-1')).toBe(true)

    expect(refsOf(state)).toEqual(['chat-1'])
    expect(saveMeta).toHaveBeenCalledTimes(1)
    expect(emitScope.mock.calls.map((call) => call[0])).toEqual(['settings'])
  })

  it('重复添加只提示，不改清单也不落盘', () => {
    const { state, saveMeta, showToast, actions } = setup()

    actions.addChatToDesk('role', 'role-a', '', 'chat-1')
    expect(actions.addChatToDesk('role', 'role-a', '', 'chat-1')).toBe(false)

    expect(refsOf(state)).toEqual(['chat-1'])
    expect(saveMeta).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it('叉掉就只摘掉这一条', () => {
    const { state, actions } = setup()
    actions.addChatToDesk('role', 'role-a', '', 'chat-1')
    actions.addChatToDesk('workspace', 'ws-1', 'role-b', 'chat-2')

    actions.removeChatFromDesk('role', 'role-a', '', 'chat-1')

    expect(refsOf(state)).toEqual(['chat-2'])
  })

  it('拖动排序改的是同一份清单', () => {
    const { state, actions } = setup()
    actions.addChatToDesk('role', 'role-a', '', 'chat-1')
    actions.addChatToDesk('role', 'role-a', '', 'chat-2')

    actions.moveDeskChat('role::role-a::::chat-2', 'role::role-a::::chat-1')

    expect(refsOf(state)).toEqual(['chat-2', 'chat-1'])
  })

  it('清理入口摘掉对应引用，没有命中时不落盘', () => {
    const { state, saveMeta, actions } = setup()
    actions.addChatToDesk('role', 'role-a', '', 'chat-1')
    actions.addChatToDesk('workspace', 'ws-1', 'role-b', 'chat-2')
    saveMeta.mockClear()

    actions.cleanupDeskRefsByChatId('chat-2')
    expect(refsOf(state)).toEqual(['chat-1'])
    expect(saveMeta).toHaveBeenCalledTimes(1)

    actions.cleanupDeskRefsForTarget('role', 'role-x')
    expect(saveMeta).toHaveBeenCalledTimes(1)
  })
})
