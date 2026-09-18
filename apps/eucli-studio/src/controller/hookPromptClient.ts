import { normalizeHookPromptLibrary, type HookPromptLibrary } from '../domain/hookPrompt'

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

function text(value: unknown) {
  return String(value ?? '').trim()
}

export async function loadHookPromptLibrary(netRequest: EbNetRequest): Promise<HookPromptLibrary> {
  const response = await netRequest({ method: 'GET', path: '/api/hook-prompts', timeoutMs: 15000 })
  return normalizeHookPromptLibrary(response?.body)
}

export async function saveHookPromptLibrary(netRequest: EbNetRequest, library: HookPromptLibrary): Promise<HookPromptLibrary> {
  const response = await netRequest({ method: 'PUT', path: '/api/hook-prompts', body: normalizeHookPromptLibrary(library), timeoutMs: 15000 })
  return normalizeHookPromptLibrary(response?.body)
}

export async function updateRoleSessionHookPrompt(netRequest: EbNetRequest, input: RoleSessionInput & { mode: string; presetId: string }) {
  const roleId = text(input.roleId)
  const sessionId = text(input.sessionId)
  if (!roleId || !sessionId) throw new Error('当前会话无效')
  const response = await netRequest({
    method: 'PATCH',
    path: `/api/roles/${encodeURIComponent(roleId)}/sessions/${encodeURIComponent(sessionId)}/hook-prompt`,
    body: { mode: text(input.mode), presetId: text(input.presetId) },
    timeoutMs: 15000,
  })
  return response?.body
}

export async function updateGroupSessionHookPrompt(netRequest: EbNetRequest, input: GroupSessionInput & { mode: string; presetId: string }) {
  const groupId = text(input.groupId)
  const sessionId = text(input.sessionId)
  if (!groupId || !sessionId) throw new Error('当前会话无效')
  const response = await netRequest({
    method: 'PATCH',
    path: `/api/groups/${encodeURIComponent(groupId)}/sessions/${encodeURIComponent(sessionId)}/hook-prompt`,
    body: { mode: text(input.mode), presetId: text(input.presetId) },
    timeoutMs: 15000,
  })
  return response?.body
}

export async function updateWorkspaceSessionHookPrompt(netRequest: EbNetRequest, input: WorkspaceSessionInput & { mode: string; presetId: string }) {
  const workspaceId = text(input.workspaceId)
  const roleId = text(input.roleId)
  const sessionId = text(input.sessionId)
  if (!workspaceId || !roleId || !sessionId) throw new Error('当前会话无效')
  const response = await netRequest({
    method: 'PATCH',
    path: `/api/workspaces/${encodeURIComponent(workspaceId)}/roles/${encodeURIComponent(roleId)}/sessions/${encodeURIComponent(sessionId)}/hook-prompt`,
    body: { mode: text(input.mode), presetId: text(input.presetId) },
    timeoutMs: 15000,
  })
  return response?.body
}
