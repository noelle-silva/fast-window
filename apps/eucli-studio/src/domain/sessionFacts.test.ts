import { describe, expect, it } from 'vitest'
import { normalizeSessionFacts } from './sessionFacts'

describe('normalizeSessionFacts', () => {
  it.each([
    ['role', { roleId: 'role-1' }],
    ['group', { groupId: 'group-1' }],
    ['workspace', { workspaceId: 'workspace-1', roleId: 'role-1' }],
  ])('normalizes metadata for a %s session', (_kind, identity) => {
    const facts = normalizeSessionFacts({
      ...identity,
      metadata: {
        streamEnabled: 'false',
        reasoningEffort: 'high',
        'modelOverride.kind': 'provider',
        'modelOverride.providerId': 'provider-1',
        'modelOverride.groupId': '',
        'modelOverride.modelId': 'model-1',
        'hookPrompt.mode': 'preset',
        'hookPrompt.presetId': 'preset-1',
      },
    })

    expect(facts).toEqual({
      streamEnabled: false,
      reasoningEffort: 'high',
      modelOverride: { kind: 'provider', providerId: 'provider-1', groupId: '', modelId: 'model-1' },
      hookPromptMode: 'preset',
      hookPromptPresetId: 'preset-1',
    })
  })

  it('uses the canonical metadata false marker and restores implicit streaming when absent', () => {
    expect(normalizeSessionFacts({ metadata: { streamEnabled: 'false' } }).streamEnabled).toBe(false)
    expect(normalizeSessionFacts({ metadata: {} })).not.toHaveProperty('streamEnabled')
  })

  it('lets explicit top-level view fields take precedence over metadata', () => {
    const facts = normalizeSessionFacts({
      streamEnabled: true,
      reasoningEffort: 'low',
      modelOverride: { kind: 'model_group', groupId: 'group-2', modelId: 'model-2' },
      hookPromptMode: 'none',
      metadata: {
        streamEnabled: 'false',
        reasoningEffort: 'high',
        'modelOverride.kind': 'provider',
        'modelOverride.providerId': 'provider-1',
        'modelOverride.modelId': 'model-1',
        'hookPrompt.mode': 'preset',
        'hookPrompt.presetId': 'preset-1',
      },
    })

    expect(facts).toEqual({
      reasoningEffort: 'low',
      modelOverride: { kind: 'model_group', providerId: '', groupId: 'group-2', modelId: 'model-2' },
      hookPromptMode: 'none',
    })
  })

  it('honors explicit clears for reasoning and model override', () => {
    expect(normalizeSessionFacts({ reasoningEffort: '', metadata: { reasoningEffort: 'high' } })).toEqual({})
    expect(normalizeSessionFacts({ modelOverride: null, metadata: { 'modelOverride.providerId': 'p', 'modelOverride.modelId': 'm' } })).toEqual({})
  })
})
