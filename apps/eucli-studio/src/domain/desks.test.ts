import { describe, expect, it } from 'vitest'
import { DESK_ROOT_FOLDER_ID, normalizeDesks, resolveDeskEntries } from './desks'
import { SESSION_REF_PENDING_TITLE } from './sessionRefPlaceholder'

function desksOf(refs: any[]) {
  return normalizeDesks({
    folders: [{ id: DESK_ROOT_FOLDER_ID, name: '桌面', parentId: '', createdAt: 1, updatedAt: 1 }],
    chatRefsByFolderId: { [DESK_ROOT_FOLDER_ID]: refs },
  })
}

function ref(targetKind: 'role' | 'group' | 'workspace', targetId: string, roleId: string, chatId: string) {
  return { targetKind, targetId, roleId, chatId, addedAt: 1 }
}

function dataOf(overrides: Record<string, any> = {}) {
  return {
    roles: [
      { id: 'role-a', name: '甲角色' },
      { id: 'role-b', name: '乙角色' },
    ],
    groups: [{ id: 'group-a', name: '甲群聊' }],
    workspaces: [{ id: 'ws-1', name: '工作区一' }],
    chatsByRole: { 'role-a': { chatMetas: [{ id: 'chat-1', title: '甲会话' }] } },
    chatsByGroup: { 'group-a': { chatMetas: [{ id: 'chat-g', title: '群会话' }] } },
    chatsByWorkspace: { 'ws-1::role-b': { chatMetas: [{ id: 'chat-w', title: '工作区会话甲' }] } },
    ...overrides,
  }
}

describe('工作桌面条目的会话事实', () => {
  it('索引里有这条会话时给出真实标题', () => {
    const entries = resolveDeskEntries(dataOf(), desksOf([ref('role', 'role-a', '', 'chat-1')]))
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe('loaded')
    expect(entries[0].title).toBe('甲会话')
  })

  it('工作区按「工作区::角色」两段身份取会话', () => {
    const entries = resolveDeskEntries(dataOf(), desksOf([ref('workspace', 'ws-1', 'role-b', 'chat-w')]))
    expect(entries[0].status).toBe('loaded')
    expect(entries[0].title).toBe('工作区会话甲')
    expect(entries[0].targetName).toBe('工作区一')
    expect(entries[0].roleName).toBe('乙角色')
  })

  it('组合索引还没进内存时是待加载，不冒充「新聊天」', () => {
    const entries = resolveDeskEntries(dataOf(), desksOf([ref('workspace', 'ws-1', 'role-x', 'chat-x')]))
    expect(entries[0].status).toBe('pending')
    expect(entries[0].title).toBe(SESSION_REF_PENDING_TITLE)
    expect(entries[0].title).not.toBe('新聊天')
  })

  it('真正的新建会话仍按后端事实显示「新聊天」', () => {
    const data = dataOf({ chatsByRole: { 'role-a': { chatMetas: [{ id: 'chat-new', title: '新聊天' }] } } })
    const entries = resolveDeskEntries(data, desksOf([ref('role', 'role-a', '', 'chat-new')]))
    expect(entries[0].status).toBe('loaded')
    expect(entries[0].title).toBe('新聊天')
  })

  it('索引缺失标题时按目标类型兜底，三种来源各自一致', () => {
    const data = dataOf({
      chatsByRole: { 'role-a': { chatMetas: [{ id: 'chat-1' }] } },
      chatsByGroup: { 'group-a': { chatMetas: [{ id: 'chat-g' }] } },
      chatsByWorkspace: { 'ws-1::role-b': { chatMetas: [{ id: 'chat-w' }] } },
    })
    const entries = resolveDeskEntries(
      data,
      desksOf([
        ref('role', 'role-a', '', 'chat-1'),
        ref('group', 'group-a', '', 'chat-g'),
        ref('workspace', 'ws-1', 'role-b', 'chat-w'),
      ]),
    )
    expect(entries.map((entry) => entry.title)).toEqual(['新聊天', '群聊', '工作区会话'])
  })
})

describe('工作桌面条目的上下文用量', () => {
  it('索引里有真值时取索引值', () => {
    const data = dataOf({
      chatsByRole: { 'role-a': { chatMetas: [{ id: 'chat-1', title: '甲会话', contextTokens: 32000 }] } },
    })
    const entries = resolveDeskEntries(data, desksOf([ref('role', 'role-a', '', 'chat-1')]))
    expect(entries[0].contextTokens).toBe(32000)
  })

  it('正文在内存时取正文里最后一条带真值的消息，它比索引新', () => {
    const data = dataOf({
      chatsByRole: {
        'role-a': {
          chatMetas: [{ id: 'chat-1', title: '甲会话', contextTokens: 32000 }],
          chats: [
            {
              id: 'chat-1',
              title: '甲会话',
              messages: [
                { id: 'm1', contextTokens: 41000 },
                { id: 'm2' },
              ],
            },
          ],
        },
      },
    })
    const entries = resolveDeskEntries(data, desksOf([ref('role', 'role-a', '', 'chat-1')]))
    expect(entries[0].contextTokens).toBe(41000)
  })

  it('两处都没有真值时是 0，不估算', () => {
    const entries = resolveDeskEntries(dataOf(), desksOf([ref('role', 'role-a', '', 'chat-1')]))
    expect(entries[0].contextTokens).toBe(0)
  })
})
