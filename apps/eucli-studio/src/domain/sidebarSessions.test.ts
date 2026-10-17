import { describe, expect, it } from 'vitest'
import { roleSidebarSessions, workspaceSidebarSessions } from './sidebarSessions'

describe('侧边栏会话列表', () => {
  it('角色模式只取当前角色的会话，并按默认顺序排列', () => {
    const data = {
      chatsByRole: {
        'role-a': {
          activeChatId: 'a2',
          chatMetas: [
            { id: 'a1', title: '旧会话', updatedAt: 10 },
            { id: 'a2', title: '新会话', updatedAt: 30 },
            { id: 'a3', title: '中间会话', updatedAt: 20 },
          ],
        },
        'role-b': {
          activeChatId: 'b1',
          chatMetas: [{ id: 'b1', title: '别人的会话', updatedAt: 99 }],
        },
      },
    }
    const result = roleSidebarSessions(data, 'role-a')
    expect(result.sessions.map((chat: any) => chat.id)).toEqual(['a2', 'a3', 'a1'])
    expect(result.activeChatId).toBe('a2')
  })

  it('工作区模式只取当前工作区与当前角色组合的会话', () => {
    const data = {
      chatsByWorkspace: {
        'ws-1::role-a': {
          activeChatId: 'wa1',
          chatMetas: [
            { id: 'wa1', title: '组合会话一', updatedAt: 10 },
            { id: 'wa2', title: '组合会话二', updatedAt: 20 },
          ],
        },
        'ws-1::role-b': {
          activeChatId: 'wb1',
          chatMetas: [{ id: 'wb1', title: '另一个角色', updatedAt: 99 }],
        },
        'ws-2::role-a': {
          activeChatId: 'x1',
          chatMetas: [{ id: 'x1', title: '另一个工作区', updatedAt: 99 }],
        },
      },
    }
    const result = workspaceSidebarSessions(data, 'ws-1', 'role-a')
    expect(result.sessions.map((chat: any) => chat.id)).toEqual(['wa2', 'wa1'])
    expect(result.activeChatId).toBe('wa1')
  })

  it('缺少目标时返回空列表', () => {
    expect(roleSidebarSessions({}, 'role-a')).toEqual({ sessions: [], activeChatId: '' })
    expect(workspaceSidebarSessions({}, 'ws-1', 'role-a')).toEqual({ sessions: [], activeChatId: '' })
  })
})
