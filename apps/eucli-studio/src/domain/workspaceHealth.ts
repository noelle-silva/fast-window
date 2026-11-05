export type WorkspaceDirectoryHealthStatus = 'available' | 'missing' | 'not_directory' | 'unavailable'

export type WorkspaceDirectoryHealth = {
  status: WorkspaceDirectoryHealthStatus
  detail?: string
}

const HEALTH_STATUS_LABELS: Record<WorkspaceDirectoryHealthStatus, string> = {
  available: '可用',
  missing: '路径不存在',
  not_directory: '不是目录',
  unavailable: '无法访问',
}

function object(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null
}

function text(value: unknown) {
  return String(value || '').trim()
}

function isHealthStatus(value: string): value is WorkspaceDirectoryHealthStatus {
  return value === 'available' || value === 'missing' || value === 'not_directory' || value === 'unavailable'
}

export function normalizeWorkspaceDirectoryHealth(raw: unknown): WorkspaceDirectoryHealth | null {
  const box = object(raw)
  if (!box) return null
  const status = text(box.status)
  if (!isHealthStatus(status)) return null
  const detail = text(box.detail || box.message)
  return detail ? { status, detail } : { status }
}

export function workspaceDirectoryHealthByPath(rawDirectories: unknown): Map<string, WorkspaceDirectoryHealth> {
  const result = new Map<string, WorkspaceDirectoryHealth>()
  const entries = Array.isArray(rawDirectories) ? rawDirectories : []
  for (const raw of entries) {
    const box = object(raw)
    if (!box) continue
    const path = text(box.path)
    const health = normalizeWorkspaceDirectoryHealth(box)
    if (!path || !health) continue
    result.set(path, health)
  }
  return result
}

export function workspaceDirectoryNeedsRepair(directory: unknown): boolean {
  const health = normalizeWorkspaceDirectoryHealth(object(directory)?.health)
  return !!health && health.status !== 'available'
}

export function workspaceUnavailableDirectoryCount(workspace: unknown): number {
  const box = object(workspace)
  const directories = Array.isArray(box?.directories) ? box.directories : []
  return directories.filter(workspaceDirectoryNeedsRepair).length
}

export function workspaceDirectoryHealthLabel(raw: unknown): string {
  const health = normalizeWorkspaceDirectoryHealth(raw)
  if (!health) return ''
  const label = HEALTH_STATUS_LABELS[health.status]
  return health.status === 'unavailable' && health.detail ? `${label}：${health.detail}` : label
}
