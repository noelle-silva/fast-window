import { normalizeStoredChat } from '../storage/normalizeStoredChat'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'

type EbNetRequest = (req: any) => Promise<any>

type UiWorkspaceDirectory = {
  path: string
  alias: string
  description: string
}

export type UiWorkspace = {
  id: string
  name: string
  directories: UiWorkspaceDirectory[]
  prompt: string
  actualPrompt: string
  createdAt: number
  updatedAt: number
}

function text(value: unknown) {
  return String(value || '').trim()
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function list(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function timeMs(value: unknown, fallback = Date.now()) {
  if (typeof value === 'number' && isFinite(value) && value > 0) return Math.floor(value)
  const raw = text(value)
  if (!raw) return fallback
  const numeric = Number(raw)
  if (isFinite(numeric) && numeric > 0) return Math.floor(numeric)
  const parsed = Date.parse(raw)
  return isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function timeIso(value: unknown, fallback = Date.now()) {
  return new Date(timeMs(value, fallback)).toISOString()
}

function workspaceFallbackTime(raw: unknown) {
  return timeMs(raw, Date.now())
}

function normalizeWorkspaceDirectory(raw: unknown): UiWorkspaceDirectory | null {
  const box = object(raw)
  const path = text(box.path)
  if (!path) return null
  return {
    path,
    alias: text(box.alias),
    description: text(box.description),
  }
}

export function normalizeWorkspace(raw: unknown): UiWorkspace | null {
  const box = object(raw)
  const id = text(box.id)
  if (!id) return null
  const createdAt = workspaceFallbackTime(box.createdAt)
  const updatedAt = timeMs(box.updatedAt, createdAt)
  return {
    id,
    name: text(box.name) || '未命名工作区',
    directories: list(box.directories)
      .map(normalizeWorkspaceDirectory)
      .filter(Boolean) as UiWorkspaceDirectory[],
    prompt: text(box.prompt),
    actualPrompt: String(box.actualPrompt ?? ''),
    createdAt,
    updatedAt,
  }
}

export function workspaceSessionToChat(raw: unknown) {
  const session = object(raw)
  const id = text(session.id)
  if (!id) return null
  const createdAt = timeMs(session.createdAt, Date.now())
  const updatedAt = timeMs(session.updatedAt, timeMs(session.lastActive, createdAt))
  const chat: any = {
    ...session,
    id,
    roleId: text(session.roleId),
    workspaceId: text(session.workspaceId),
    title: text(session.title) || '工作区会话',
    status: text(session.status),
    createdAt,
    updatedAt,
    messages: list(session.messages).map((message) => ({ ...object(message) })),
  }
  return normalizeStoredChat(chat, 'workspace')
}

export function workspaceSessionSummaryToMeta(raw: unknown) {
  const summary = object(raw)
  const id = text(summary.id)
  if (!id) return null
  const updatedAt = timeMs(summary.updatedAt, timeMs(summary.lastActive, Date.now()))
  const status = text(summary.status)
  return {
    id,
    roleId: text(summary.roleId),
    workspaceId: text(summary.workspaceId),
    title: text(summary.title) || '工作区会话',
    createdAt: timeMs(summary.createdAt, updatedAt),
    updatedAt,
    lastMessagePreview: '',
    messageCount: 0,
    hasPending: status === 'running' || status === 'waiting_confirmation',
    runStatus: status === 'running' || status === 'waiting_confirmation' ? 'running' : 'idle',
    runStatusChangedAt: updatedAt,
  }
}

export function workspaceSessionTargetId(workspaceIdRaw: unknown, roleIdRaw: unknown) {
  return workspaceRoleTargetId(workspaceIdRaw, roleIdRaw)
}

function workspaceToWire(workspace: UiWorkspace) {
  const createdAt = workspaceFallbackTime(workspace.createdAt)
  const updatedAt = timeMs(workspace.updatedAt, createdAt)
  return {
    id: text(workspace.id),
    name: text(workspace.name) || '未命名工作区',
    directories: workspace.directories.map((directory) => ({
      path: text(directory.path),
      alias: text(directory.alias),
      description: text(directory.description),
    })),
    prompt: text(workspace.prompt),
    createdAt: timeIso(createdAt),
    updatedAt: timeIso(updatedAt),
  }
}

export async function loadWorkspace(netRequest: EbNetRequest, workspaceId: string) {
  const id = text(workspaceId)
  if (!id) throw new Error('工作区无效')
  const response = await netRequest({ method: 'GET', path: `/api/workspaces/${encodeURIComponent(id)}`, timeoutMs: 15000 })
  return normalizeWorkspace(response?.body)
}

export async function listWorkspacesDetailed(netRequest: EbNetRequest) {
  const response = await netRequest({ method: 'GET', path: '/api/workspaces', timeoutMs: 15000 })
  const items = list(response?.body)
  const out: UiWorkspace[] = []
  for (const summary of items) {
    const workspace = await loadWorkspace(netRequest, text(object(summary).id)).catch(() => null)
    if (workspace) out.push(workspace)
  }
  return out
}

export async function saveWorkspace(netRequest: EbNetRequest, workspace: UiWorkspace) {
  const body = workspaceToWire(workspace)
  if (!body.id) throw new Error('工作区无效')
  await netRequest({ method: 'POST', path: '/api/workspaces', body, timeoutMs: 15000 })
}

export async function previewWorkspacePrompt(netRequest: EbNetRequest, workspace: UiWorkspace) {
  const response = await netRequest({ method: 'POST', path: '/api/workspaces/prompt-preview', body: workspaceToWire(workspace), timeoutMs: 15000 })
  return String(object(response?.body).actualPrompt ?? '')
}

export async function deleteWorkspace(netRequest: EbNetRequest, workspaceId: string) {
  const id = text(workspaceId)
  if (!id) throw new Error('工作区无效')
  await netRequest({ method: 'DELETE', path: `/api/workspaces/${encodeURIComponent(id)}`, timeoutMs: 15000 })
}

export async function listWorkspaceSessionSummaries(netRequest: EbNetRequest, workspaceId: string, roleId: string) {
  const id = text(workspaceId)
  const rid = text(roleId)
  if (!id || !rid) return []
  const response = await netRequest({ method: 'GET', path: `/api/workspaces/${encodeURIComponent(id)}/roles/${encodeURIComponent(rid)}/sessions`, timeoutMs: 15000 })
  return list(response?.body)
}

export async function loadWorkspaceSession(netRequest: EbNetRequest, workspaceId: string, roleId: string, sessionId: string) {
  const wid = text(workspaceId)
  const rid = text(roleId)
  const sid = text(sessionId)
  if (!wid || !rid || !sid) throw new Error('工作区会话无效')
  const response = await netRequest({ method: 'GET', path: `/api/workspaces/${encodeURIComponent(wid)}/roles/${encodeURIComponent(rid)}/sessions/${encodeURIComponent(sid)}`, timeoutMs: 15000 })
  return workspaceSessionToChat(response?.body)
}

export async function createWorkspaceSession(netRequest: EbNetRequest, input: { workspaceId: string; roleId: string; title?: string }) {
  const workspaceId = text(input.workspaceId)
  const roleId = text(input.roleId)
  if (!workspaceId) throw new Error('工作区无效')
  if (!roleId) throw new Error('角色无效')
  const response = await netRequest({
    method: 'POST',
    path: `/api/workspaces/${encodeURIComponent(workspaceId)}/roles/${encodeURIComponent(roleId)}/sessions/create`,
    body: { title: text(input.title) || '工作区会话' },
    timeoutMs: 15000,
  })
  return workspaceSessionToChat(response?.body)
}

export async function deleteWorkspaceSession(netRequest: EbNetRequest, workspaceId: string, roleId: string, sessionId: string) {
  const wid = text(workspaceId)
  const rid = text(roleId)
  const sid = text(sessionId)
  if (!wid || !rid || !sid) throw new Error('工作区会话无效')
  await netRequest({ method: 'DELETE', path: `/api/workspaces/${encodeURIComponent(wid)}/roles/${encodeURIComponent(rid)}/sessions/${encodeURIComponent(sid)}`, timeoutMs: 15000 })
}

export async function updateWorkspaceSessionTitle(netRequest: EbNetRequest, input: { workspaceId: string; roleId: string; sessionId: string; title: string }) {
  const workspaceId = text(input.workspaceId)
  const roleId = text(input.roleId)
  const sessionId = text(input.sessionId)
  if (!workspaceId || !roleId || !sessionId) throw new Error('工作区会话无效')
  const response = await netRequest({
    method: 'PATCH',
    path: `/api/workspaces/${encodeURIComponent(workspaceId)}/roles/${encodeURIComponent(roleId)}/sessions/${encodeURIComponent(sessionId)}/title`,
    body: { title: text(input.title) || '工作区会话' },
    timeoutMs: 15000,
  })
  return response?.body
}
