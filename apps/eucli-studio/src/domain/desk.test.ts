import { describe, expect, it } from 'vitest'
import {
  DESK_SETTING_KEY,
  deskChatRefKey,
  moveDeskChatRef,
  normalizeDesk,
  removeDeskChatRef,
  removeDeskRefsByChatId,
  removeDeskRefsForTarget,
  resolveDeskData,
  resolveDeskEntries,
  upsertDeskChatRef,
} from './desk'

const roleRef = { targetKind: 'role', targetId: 'role-a', roleId: '', chatId: 'chat-1' }
const wsRef = { targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'chat-2' }

describe('工作桌面的引用清单', () => {
  it('丢弃缺少目标或会话的引用，工作区还要求角色', () => {
    const desk = normalizeDesk({
      refs: [
        roleRef,
        { targetKind: 'role', targetId: '', chatId: 'chat-x' },
        { targetKind: 'role', targetId: 'role-a', chatId: '' },
        { targetKind: 'workspace', targetId: 'ws-1', roleId: '', chatId: 'chat-y' },
        wsRef,
      ],
    })

    expect(desk.refs.map((it) => it.chatId)).toEqual(['chat-1', 'chat-2'])
  })

  it('同一个会话只留一条', () => {
    const desk = normalizeDesk({ refs: [roleRef, roleRef] })

    expect(desk.refs).toHaveLength(1)
  })

  it('读取时只认 settings 里的这一份', () => {
    expect(resolveDeskData({ [DESK_SETTING_KEY]: { refs: [roleRef] } }).refs).toHaveLength(1)
    expect(resolveDeskData({}).refs).toHaveLength(0)
    expect(resolveDeskData(null).refs).toHaveLength(0)
  })

  it('添加到末尾，重复添加不改动清单', () => {
    const once = upsertDeskChatRef([], roleRef)
    expect(once.map((it) => it.chatId)).toEqual(['chat-1'])

    const twice = upsertDeskChatRef(once, roleRef)
    expect(twice).toHaveLength(1)

    const two = upsertDeskChatRef(twice, wsRef)
    expect(two.map((it) => it.chatId)).toEqual(['chat-1', 'chat-2'])
  })

  it('按引用键摘除一条', () => {
    const refs = upsertDeskChatRef(upsertDeskChatRef([], roleRef), wsRef)
    expect(removeDeskChatRef(refs, wsRef).map((it) => it.chatId)).toEqual(['chat-1'])
    expect(removeDeskChatRef(refs, { targetKind: 'role', targetId: 'other', chatId: 'chat-1' })).toHaveLength(2)
  })

  it('排序把拖动项挪到目标位置，其余相对次序不变', () => {
    const refs = upsertDeskChatRef(upsertDeskChatRef(upsertDeskChatRef([], roleRef), wsRef), { ...roleRef, chatId: 'chat-3' })
    const moved = moveDeskChatRef(refs, deskChatRefKey(roleRef), deskChatRefKey({ ...roleRef, chatId: 'chat-3' }))

    expect(moved.map((it) => it.chatId)).toEqual(['chat-2', 'chat-3', 'chat-1'])
  })

  it('会话被删除时按标识摘除，目标被删除时按目标摘除', () => {
    const refs = upsertDeskChatRef(upsertDeskChatRef([], roleRef), wsRef)

    expect(removeDeskRefsByChatId(refs, 'chat-2').map((it) => it.chatId)).toEqual(['chat-1'])
    expect(removeDeskRefsForTarget(refs, 'workspace', 'ws-1').map((it) => it.chatId)).toEqual(['chat-1'])
    expect(removeDeskRefsForTarget(refs, 'role', 'role-a').map((it) => it.chatId)).toEqual(['chat-2'])
  })

  it('装配条目时补上会话标题与来源名，会话还没加载也不丢', () => {
    const data = {
      roles: [{ id: 'role-a', name: '甲角色' }],
      workspaces: [{ id: 'ws-1', name: '工作区一' }],
      chatsByRole: { 'role-a': { chatMetas: [{ id: 'chat-1', title: '甲会话' }] } },
      chatsByWorkspace: {},
    }
    const refs = normalizeDesk({ refs: [roleRef, wsRef] }).refs

    const entries = resolveDeskEntries(data, refs)

    expect(entries[0]).toMatchObject({ title: '甲会话', targetName: '甲角色' })
    expect(entries[1]).toMatchObject({ title: '新聊天', targetName: '工作区一' })
  })
})
