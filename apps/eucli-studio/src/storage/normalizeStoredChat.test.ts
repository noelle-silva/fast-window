import { describe, expect, it } from 'vitest'
import { normalizeStoredChat } from './normalizeStoredChat'

const baseSession = {
  id: 'session-1',
  title: 'Session',
  createdAt: '2026-08-28T10:00:00Z',
  updatedAt: '2026-08-28T10:00:00Z',
  messages: [],
}

describe('normalizeStoredChat', () => {
  it.each([
    ['role', { roleId: 'role-1' }],
    ['group', { groupId: 'group-1' }],
    ['workspace', { workspaceId: 'workspace-1/role-1', roleId: 'role-1' }],
  ])('keeps session facts for %s chat input', (_kind, identity) => {
    const chat = normalizeStoredChat({
      ...baseSession,
      ...identity,
      metadata: {
        streamEnabled: 'false',
        reasoningEffort: 'very_high',
        'modelOverride.kind': 'provider',
        'modelOverride.providerId': 'provider-1',
        'modelOverride.modelId': 'model-1',
        'hookPrompt.mode': 'none',
      },
    }, _kind as 'role' | 'group' | 'workspace')

    expect(chat).toMatchObject({
      id: 'session-1',
      streamEnabled: false,
      reasoningEffort: 'very_high',
      modelOverride: { kind: 'provider', providerId: 'provider-1', groupId: '', modelId: 'model-1' },
      hookPromptMode: 'none',
    })
  })

  it('keeps streamEnabled=false from a canonical PATCH response', () => {
    const chat = normalizeStoredChat({ ...baseSession, roleId: 'role-1', metadata: { streamEnabled: 'false' } }, 'role')
    expect(chat).toHaveProperty('streamEnabled', false)
  })

  it('clears stale false when a canonical response restores default streaming', () => {
    const chat = normalizeStoredChat({
      ...baseSession,
      roleId: 'role-1',
      metadata: {},
    }, 'role')

    expect(chat).not.toHaveProperty('streamEnabled')
  })

  it('accepts explicit top-level view fields without reinterpreting them', () => {
    const chat = normalizeStoredChat({
      ...baseSession,
      roleId: 'role-1',
      streamEnabled: false,
      reasoningEffort: 'low',
      modelOverride: { kind: 'provider', providerId: 'provider-2', modelId: 'model-2' },
      hookPromptMode: 'preset',
      hookPromptPresetId: 'preset-2',
      metadata: {
        streamEnabled: 'false',
        reasoningEffort: 'high',
        'modelOverride.kind': 'provider',
        'modelOverride.providerId': 'provider-1',
        'modelOverride.modelId': 'model-1',
        'hookPrompt.mode': 'none',
      },
    }, 'role')

    expect(chat).toMatchObject({
      streamEnabled: false,
      reasoningEffort: 'low',
      modelOverride: { providerId: 'provider-2', modelId: 'model-2' },
      hookPromptMode: 'preset',
      hookPromptPresetId: 'preset-2',
    })
  })

})

describe('normalizeStoredChat 消息树契约', () => {
  it('后端原始用户消息的 parentMessageId 归一化为 parentMid', () => {
    const chat = normalizeStoredChat({
      ...baseSession,
      roleId: 'role-1',
      messages: [
        { id: 'u1', type: 'user', content: '第一问', branchId: 'main', createdAt: '2026-10-31T17:32:31.8294373Z', updatedAt: '2026-10-31T17:32:31.8294373Z' },
        { id: 'a1', type: 'assistant', content: '第一答', parentMessageId: 'u1', branchId: 'main', createdAt: '2026-10-31T17:32:35.0548421Z', updatedAt: '2026-10-31T17:32:35.0548421Z' },
        { id: 'u2', type: 'user', content: '第二问', parentMessageId: 'a1', branchId: 'main', createdAt: '2026-10-31T17:38:02.5199299Z', updatedAt: '2026-10-31T17:38:02.5199299Z' },
      ],
    }, 'role')

    const messages = chat?.messages || []
    expect(messages.find((m: any) => m.id === 'u2')?.parentMid).toBe('a1')
    expect(messages.find((m: any) => m.id === 'u2')?.role).toBe('user')
    expect(typeof messages.find((m: any) => m.id === 'u2')?.createdAt).toBe('number')
  })
})