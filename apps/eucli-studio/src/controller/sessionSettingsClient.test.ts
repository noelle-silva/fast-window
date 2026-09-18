import { describe, expect, it } from 'vitest'
import {
  updateGroupSessionSettings,
  updateRoleSessionSettings,
  updateWorkspaceSessionSettings,
} from './sessionSettingsClient'

describe('session settings client', () => {
  it.each([
    ['role', updateRoleSessionSettings, { roleId: 'role/1', sessionId: 'session 1' }, '/api/roles/role%2F1/sessions/session%201/settings'],
    ['group', updateGroupSessionSettings, { groupId: 'group/1', sessionId: 'session 1' }, '/api/groups/group%2F1/sessions/session%201/settings'],
    ['workspace', updateWorkspaceSessionSettings, { workspaceId: 'workspace/1', roleId: 'role/1', sessionId: 'session 1' }, '/api/workspaces/workspace%2F1/roles/role%2F1/sessions/session%201/settings'],
  ])('uses the %s target route and sends only the requested patch fields', async (_kind, update, input, path) => {
    const requests: any[] = []
    const session = { id: input.sessionId }
    const body = await update(async (request) => {
      requests.push(request)
      return { body: session }
    }, input as any, {
      streamEnabled: false,
      reasoningEffort: ' high ',
      modelOverride: null,
    })

    expect(body).toEqual(session)
    expect(requests).toEqual([{
      method: 'PATCH',
      path,
      body: { streamEnabled: false, reasoningEffort: 'high', modelOverride: { kind: '', providerId: '', groupId: '', modelId: '' } },
      timeoutMs: 15000,
    }])
  })

  it('rejects incomplete target identities before making a request', async () => {
    let called = false
    await expect(updateWorkspaceSessionSettings(async () => {
      called = true
      return { body: {} }
    }, { workspaceId: 'workspace-1', roleId: '', sessionId: 'session-1' }, { streamEnabled: false })).rejects.toThrow('当前会话无效')
    expect(called).toBe(false)
  })
})
