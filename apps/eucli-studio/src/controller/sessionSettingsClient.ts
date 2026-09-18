type EbNetRequest = (req: any) => Promise<any>

type RoleSessionInput = {
  roleId: string
  sessionId: string
}

type GroupSessionInput = {
  groupId: string
  sessionId: string
}

type WorkspaceSessionInput = {
  workspaceId: string
  roleId: string
  sessionId: string
}

export type SessionSettingsPatch = {
  streamEnabled?: boolean
  reasoningEffort?: string
  modelOverride?: { kind: string; providerId: string; groupId: string; modelId: string } | null
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function settingsBody(patch: SessionSettingsPatch) {
  const body: any = {}
  if (typeof patch.streamEnabled === 'boolean') body.streamEnabled = patch.streamEnabled
  if (patch.reasoningEffort !== undefined) body.reasoningEffort = text(patch.reasoningEffort)
  if (patch.modelOverride !== undefined) {
    body.modelOverride = patch.modelOverride ? { ...patch.modelOverride } : { kind: '', providerId: '', groupId: '', modelId: '' }
  }
  return body
}

export async function updateRoleSessionSettings(netRequest: EbNetRequest, input: RoleSessionInput, patch: SessionSettingsPatch) {
  const roleId = text(input.roleId)
  const sessionId = text(input.sessionId)
  if (!roleId || !sessionId) throw new Error('当前会话无效')
  const response = await netRequest({
    method: 'PATCH',
    path: `/api/roles/${encodeURIComponent(roleId)}/sessions/${encodeURIComponent(sessionId)}/settings`,
    body: settingsBody(patch),
    timeoutMs: 15000,
  })
  return response?.body
}

export async function updateGroupSessionSettings(netRequest: EbNetRequest, input: GroupSessionInput, patch: SessionSettingsPatch) {
  const groupId = text(input.groupId)
  const sessionId = text(input.sessionId)
  if (!groupId || !sessionId) throw new Error('当前会话无效')
  const response = await netRequest({
    method: 'PATCH',
    path: `/api/groups/${encodeURIComponent(groupId)}/sessions/${encodeURIComponent(sessionId)}/settings`,
    body: settingsBody(patch),
    timeoutMs: 15000,
  })
  return response?.body
}

export async function updateWorkspaceSessionSettings(netRequest: EbNetRequest, input: WorkspaceSessionInput, patch: SessionSettingsPatch) {
  const workspaceId = text(input.workspaceId)
  const roleId = text(input.roleId)
  const sessionId = text(input.sessionId)
  if (!workspaceId || !roleId || !sessionId) throw new Error('当前会话无效')
  const response = await netRequest({
    method: 'PATCH',
    path: `/api/workspaces/${encodeURIComponent(workspaceId)}/roles/${encodeURIComponent(roleId)}/sessions/${encodeURIComponent(sessionId)}/settings`,
    body: settingsBody(patch),
    timeoutMs: 15000,
  })
  return response?.body
}
