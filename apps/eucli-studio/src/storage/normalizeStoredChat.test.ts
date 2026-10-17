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

  it('carries session token usage truth and drops it when absent', () => {
    const withUsage = normalizeStoredChat({ ...baseSession, roleId: 'role-1', tokenUsage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } }, 'role')
    expect(withUsage).toMatchObject({ tokenUsage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } })

    const withoutUsage = normalizeStoredChat({ ...baseSession, roleId: 'role-1' }, 'role')
    expect(withoutUsage).not.toHaveProperty('tokenUsage')
  })

  it('carries session cache rate truth and drops it when absent', () => {
    const withCacheRate = normalizeStoredChat({ ...baseSession, roleId: 'role-1', cacheRate: 0.8 }, 'role')
    expect(withCacheRate).toMatchObject({ cacheRate: 0.8 })

    const withoutCacheRate = normalizeStoredChat({ ...baseSession, roleId: 'role-1' }, 'role')
    expect(withoutCacheRate).not.toHaveProperty('cacheRate')
  })
})
