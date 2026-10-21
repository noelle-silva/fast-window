import { describe, expect, it } from 'vitest'
import { collectRunningSessions, normalizeRunningSessionStatus, runningSessionKey } from './runningSessions'

function card(patch: Record<string, any> = {}) {
  return {
    kind: 'eb-role-run',
    runId: 'run-1',
    roleId: 'role-a',
    groupId: '',
    workspaceId: '',
    sessionId: 'session-1',
    inputMessageId: 'message-1',
    lastMessageId: 'message-1',
    anchorMessageId: 'message-1',
    dependencyMessageIds: [],
    status: 'running',
    stream: true,
    retry: null,
    cancelledByUser: false,
    createdAt: 100,
    updatedAt: 100,
    ...patch,
  }
}

function state(cards: any[]) {
  return { activeRunCards: cards }
}

function data(patch: Record<string, any> = {}) {
  return {
    roles: [{ id: 'role-a', name: '角色A', avatarImage: 'role-a.png' }],
    groups: [{ id: 'group-a', name: '群组A', avatarImage: 'group-a.png' }],
    workspaces: [{ id: 'workspace-a', name: '工作区A' }],
    chatsByRole: {
      'role-a': {
        chatMetas: [{ id: 'session-1', title: '角色会话' }],
      },
    },
    chatsByGroup: {
      'group-a': {
        chatMetas: [{ id: 'group-session', title: '群组会话' }],
      },
    },
    chatsByWorkspace: {
      'workspace-a::role-a': {
        chatMetas: [{ id: 'workspace-session', title: '工作区会话' }],
      },
    },
    ...patch,
  }
}

describe('运行中会话汇总', () => {
  it('按目标与会话合并多条运行，并保留最新一条的状态', () => {
    const entries = collectRunningSessions({
      state: state([
        card({ runId: 'run-old', status: 'queued', updatedAt: 100 }),
        card({ runId: 'run-new', status: 'waiting_confirmation', updatedAt: 200 }),
      ]),
      data: data(),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe('role:role-a:session-1')
    expect(entries[0].statusKey).toBe('waiting_confirmation')
    expect(entries[0].statusLabel).toBe('等待确认')
    expect(entries[0].title).toBe('角色会话')
  })

  it('工作区会话使用工作区与角色的复合目标', () => {
    const entries = collectRunningSessions({
      state: state([card({ workspaceId: 'workspace-a', sessionId: 'workspace-session' })]),
      data: data(),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0].targetKind).toBe('workspace')
    expect(entries[0].targetId).toBe('workspace-a::role-a')
    expect(entries[0].targetName).toBe('工作区A / 角色A')
    expect(entries[0].avatarImage).toBe('role-a.png')
    expect(entries[0].title).toBe('工作区会话')
  })

  it('群组入口关闭时不汇总群组会话', () => {
    const input = {
      state: state([card({ groupId: 'group-a', sessionId: 'group-session' })]),
      data: data(),
      includeGroups: false,
    }

    expect(collectRunningSessions(input)).toEqual([])
    expect(collectRunningSessions({ ...input, includeGroups: true })).toHaveLength(1)
  })

  it('缺少会话标题时用会话短标识兜底', () => {
    const entries = collectRunningSessions({
      state: state([card({ workspaceId: 'workspace-a', sessionId: 'session-12345678' })]),
      data: data({ chatsByWorkspace: {} }),
    })

    expect(entries[0].title).toBe('会话 12345678')
  })

  it('按最近更新时间倒序排列', () => {
    const entries = collectRunningSessions({
      state: state([
        card({ sessionId: 'session-old', updatedAt: 100 }),
        card({ sessionId: 'session-new', updatedAt: 300 }),
      ]),
      data: data({
        chatsByRole: {
          'role-a': {
            chatMetas: [
              { id: 'session-old', title: '旧会话' },
              { id: 'session-new', title: '新会话' },
            ],
          },
        },
      }),
    })

    expect(entries.map((entry) => entry.sessionId)).toEqual(['session-new', 'session-old'])
  })

  it('终态运行不进入汇总', () => {
    const entries = collectRunningSessions({
      state: state([card({ status: 'completed' })]),
      data: data(),
    })

    expect(entries).toEqual([])
  })

  it('会话键与状态文案保持统一口径', () => {
    expect(runningSessionKey('role', 'role-a', 'session-1')).toBe('role:role-a:session-1')
    expect(runningSessionKey('role', '', 'session-1')).toBe('')
    expect(normalizeRunningSessionStatus('queued')).toEqual({ key: 'queued', label: '排队中' })
    expect(normalizeRunningSessionStatus('running')).toEqual({ key: 'running', label: '生成中' })
    expect(normalizeRunningSessionStatus('waiting_confirmation')).toEqual({ key: 'waiting_confirmation', label: '等待确认' })
    expect(normalizeRunningSessionStatus('retrying')).toEqual({ key: 'retrying', label: '等待重试' })
    expect(normalizeRunningSessionStatus('unknown')).toEqual({ key: 'active', label: '运行中' })
  })
})
