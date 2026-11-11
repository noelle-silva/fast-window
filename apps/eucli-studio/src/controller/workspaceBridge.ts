import { applyLoadedSessionVersion } from '../domain/sessionVersion'
import { normalizeMessageContextTokens } from '../domain/message'
import { normalizeStoredChat } from '../storage/normalizeStoredChat'
import { normalizeWorkspaceIcon, type UiWorkspaceIcon } from '../domain/workspaceIcon'
import {
  workspaceDirectoryHealthByPath,
  type WorkspaceDirectoryHealth,
} from '../domain/workspaceHealth'

type EbNetRequest = (req: any) => Promise<any>

type UiWorkspaceDirectory = {
  path: string
  alias: string
  description: string
  health?: WorkspaceDirectoryHealth
}

export type UiWorkspace = {
  id: string
  name: string
  /** 描述是给人看的备注：随工作区文档存取，不参与提示词，也不发给模型。 */
  description: string
  directories: UiWorkspaceDirectory[]
  prompt: string
  registeredRoleIds: string[]
  actualPrompt: string
  /** 图标是独立资源：只有在列表读取时才会挂上，其余路径按「没有图标」处理。 */
  icon?: UiWorkspaceIcon | null
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

function textList(value: unknown) {
  return list(value).map((item) => text(item)).filter(Boolean)
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

function attachDirectoryHealth(directory: UiWorkspaceDirectory, healthByPath: Map<string, WorkspaceDirectoryHealth>): UiWorkspaceDirectory {
  const health = healthByPath.get(directory.path)
  return health ? { ...directory, health } : directory
}

export function normalizeWorkspace(raw: unknown): UiWorkspace | null {
  const box = object(raw)
  const id = text(box.id)
  if (!id) return null
  const createdAt = workspaceFallbackTime(box.createdAt)
  const updatedAt = timeMs(box.updatedAt, createdAt)
  const healthByPath = workspaceDirectoryHealthByPath(object(box.health).directories)
  return {
    id,
    name: text(box.name) || '未命名工作区',
    description: text(box.description),
    directories: list(box.directories)
      .map(normalizeWorkspaceDirectory)
      .filter((directory): directory is UiWorkspaceDirectory => !!directory)
      .map((directory) => attachDirectoryHealth(directory, healthByPath)),
    prompt: text(box.prompt),
    registeredRoleIds: textList(box.registeredRoleIds),
    actualPrompt: String(box.actualPrompt ?? ''),
    // 图标是独立资源（GET /icon），不随工作区文档下发；由读取方按需挂上。
    icon: null,
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
  // 会话版本是事件新旧的本地判据：归一化会丢掉原始载荷字段，必须在出口处保留。
  return applyLoadedSessionVersion(normalizeStoredChat(chat, 'workspace'), session, null)
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
    lastMessagePreview: text(summary.lastMessagePreview),
    messageCount: 0,
    hasPending: status === 'running' || status === 'waiting_confirmation',
    runStatus: status === 'running' || status === 'waiting_confirmation' ? 'running' : 'idle',
    runStatusChangedAt: updatedAt,
    // 摘要没有消息级事件，锚点只能取最后落盘的活动时间：它是静止快照。
    listAnchorAt: updatedAt,
    // 工作区会话摘要与角色 / 群聊同一份索引口径：上下文真值原样带上，缺了就是 0。
    contextTokens: normalizeMessageContextTokens(summary.contextTokens),
  }
}

// 工作区会话摘要的 version 是断线恢复的版本指纹。
// 版本表与列表来自同一次权威读取，调用方不得用本地时间推断新旧。
export function workspaceSessionVersions(summariesRaw: unknown): Record<string, number> {
  const versions: Record<string, number> = {}
  for (const summaryRaw of list(summariesRaw)) {
    const summary = object(summaryRaw)
    const id = text(summary.id)
    const version = Number(summary.version)
    if (!id || !Number.isFinite(version) || version <= 0) continue
    versions[id] = Math.floor(version)
  }
  return versions
}

function workspaceToWire(workspace: UiWorkspace) {
  const createdAt = workspaceFallbackTime(workspace.createdAt)
  const updatedAt = timeMs(workspace.updatedAt, createdAt)
  return {
    id: text(workspace.id),
    name: text(workspace.name) || '未命名工作区',
    description: text(workspace.description),
    directories: workspace.directories.map((directory) => ({
      path: text(directory.path),
      alias: text(directory.alias),
      description: text(directory.description),
    })),
    prompt: text(workspace.prompt),
    registeredRoleIds: workspace.registeredRoleIds.map(text),
    createdAt: timeIso(createdAt),
    updatedAt: timeIso(updatedAt),
  }
}

export async function loadWorkspace(netRequest: EbNetRequest, workspaceId: string) {
  const id = text(workspaceId)
  if (!id) throw new Error('工作区无效')
  const response = await netRequest({ method: 'GET', path: `/api/workspaces/${encodeURIComponent(id)}` })
  return normalizeWorkspace(response?.body)
}

export async function listWorkspacesDetailed(netRequest: EbNetRequest) {
  const response = await netRequest({ method: 'GET', path: '/api/workspaces' })
  const items = list(response?.body)
  const out: UiWorkspace[] = []
  for (const summary of items) {
    const workspace = await loadWorkspace(netRequest, text(object(summary).id)).catch(() => null)
    if (!workspace) continue
    // 图标是装饰性资源：单个读取失败只让这一条没有图标，不影响工作区列表本身的权威性。
    workspace.icon = await loadWorkspaceIcon(netRequest, workspace.id).catch(() => null)
    out.push(workspace)
  }
  return out
}

export async function saveWorkspace(netRequest: EbNetRequest, workspace: UiWorkspace) {
  const body = workspaceToWire(workspace)
  if (!body.id) throw new Error('工作区无效')
  await netRequest({ method: 'POST', path: '/api/workspaces', body })
}

export async function previewWorkspacePrompt(netRequest: EbNetRequest, workspace: UiWorkspace) {
  const response = await netRequest({ method: 'POST', path: '/api/workspaces/prompt-preview', body: workspaceToWire(workspace) })
  return String(object(response?.body).actualPrompt ?? '')
}

export async function deleteWorkspace(netRequest: EbNetRequest, workspaceId: string) {
  const id = text(workspaceId)
  if (!id) throw new Error('工作区无效')
  await netRequest({ method: 'DELETE', path: `/api/workspaces/${encodeURIComponent(id)}` })
}

// 工作区图标是独立资源：读写都不经过工作区文档，全量保存工作区不会碰到它。
// 没有图标时后端以 404 表达，这里换算成 null。
export async function loadWorkspaceIcon(netRequest: EbNetRequest, workspaceId: string): Promise<UiWorkspaceIcon | null> {
  const id = text(workspaceId)
  if (!id) return null
  const response = await netRequest({ method: 'GET', path: `/api/workspaces/${encodeURIComponent(id)}/icon` })
  const status = Number(response?.status || 0)
  if (status === 404) return null
  if (status && (status < 200 || status >= 300)) throw new Error(`读取工作区图标失败：HTTP ${status}`)
  const icon = normalizeWorkspaceIcon(response?.body)
  if (!icon) throw new Error('读取工作区图标失败：回执不是有效图标')
  return icon
}

export async function saveWorkspaceIcon(netRequest: EbNetRequest, workspaceId: string, icon: UiWorkspaceIcon) {
  const id = text(workspaceId)
  if (!id) throw new Error('工作区无效')
  const body = icon.kind === 'image' ? { kind: 'image', dataUrl: icon.dataUrl } : { kind: 'svg', svg: icon.svg }
  await netRequest({ method: 'PUT', path: `/api/workspaces/${encodeURIComponent(id)}/icon`, body })
}

export async function deleteWorkspaceIcon(netRequest: EbNetRequest, workspaceId: string) {
  const id = text(workspaceId)
  if (!id) throw new Error('工作区无效')
  await netRequest({ method: 'DELETE', path: `/api/workspaces/${encodeURIComponent(id)}/icon` })
}

export async function listWorkspaceSessionSummaries(netRequest: EbNetRequest, workspaceId: string, roleId: string) {
  const id = text(workspaceId)
  const rid = text(roleId)
  if (!id || !rid) return []
  const response = await netRequest({ method: 'GET', path: `/api/workspaces/${encodeURIComponent(id)}/roles/${encodeURIComponent(rid)}/sessions` })
  return list(response?.body)
}

export async function loadWorkspaceSession(netRequest: EbNetRequest, workspaceId: string, roleId: string, sessionId: string) {
  const wid = text(workspaceId)
  const rid = text(roleId)
  const sid = text(sessionId)
  if (!wid || !rid || !sid) throw new Error('工作区会话无效')
  const response = await netRequest({ method: 'GET', path: `/api/workspaces/${encodeURIComponent(wid)}/roles/${encodeURIComponent(rid)}/sessions/${encodeURIComponent(sid)}` })
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
  })
  return workspaceSessionToChat(response?.body)
}

export async function deleteWorkspaceSession(netRequest: EbNetRequest, workspaceId: string, roleId: string, sessionId: string) {
  const wid = text(workspaceId)
  const rid = text(roleId)
  const sid = text(sessionId)
  if (!wid || !rid || !sid) throw new Error('工作区会话无效')
  await netRequest({ method: 'DELETE', path: `/api/workspaces/${encodeURIComponent(wid)}/roles/${encodeURIComponent(rid)}/sessions/${encodeURIComponent(sid)}` })
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
  })
  return response?.body
}
