export type PersistentPort = {
  id: string
  name: string
  port: number
  desiredState: 'enabled' | 'disabled' | string
  actualState: 'running' | 'stopped' | 'failed' | string
  failureReason?: string
  createdAt: string
}

export type PersistentKeyView = {
  id: string
  name: string
  enabled: boolean
  expiresAt: string | null
  createdAt: string
  lastUsedAt: string | null
}

export type PersistentKeyCreated = {
  id: string
  name: string
  plainKey: string
  expiresAt: string | null
  createdAt: string
}

export type BoxInfo = {
  version: string
  dataVersion: string
  clientCompatibility: {
    compatible: boolean
    reason: string
    currentEucliBoxVersion: string
    requiredEucliBoxCompatibility: { minimumVersion: string; maximumVersionExclusive: string }
  } | null
}

export function normalizePersistentPort(value: unknown): PersistentPort {
  const source = objectValue(value)
  return {
    id: text(source.id),
    name: text(source.name),
    port: finiteNumber(source.port),
    desiredState: text(source.desiredState) || 'disabled',
    actualState: text(source.actualState) || 'stopped',
    failureReason: text(source.failureReason) || undefined,
    createdAt: text(source.createdAt),
  }
}

export function normalizePersistentKeyView(value: unknown): PersistentKeyView {
  const source = objectValue(value)
  return {
    id: text(source.id),
    name: text(source.name),
    enabled: source.enabled === true,
    expiresAt: source.expiresAt ? text(source.expiresAt) : null,
    createdAt: text(source.createdAt),
    lastUsedAt: source.lastUsedAt ? text(source.lastUsedAt) : null,
  }
}

export function normalizePersistentKeyCreated(value: unknown): PersistentKeyCreated {
  const source = objectValue(value)
  return {
    id: text(source.id),
    name: text(source.name),
    plainKey: text(source.plainKey),
    expiresAt: source.expiresAt ? text(source.expiresAt) : null,
    createdAt: text(source.createdAt),
  }
}

export function normalizeBoxInfo(value: unknown): BoxInfo {
  const source = objectValue(value)
  return {
    version: text(source.version),
    dataVersion: text(source.dataVersion),
    clientCompatibility: source.clientCompatibility && typeof source.clientCompatibility === 'object'
      ? {
          compatible: (source.clientCompatibility as any).compatible === true,
          reason: text((source.clientCompatibility as any).reason),
          currentEucliBoxVersion: text((source.clientCompatibility as any).currentEucliBoxVersion),
          requiredEucliBoxCompatibility: {
            minimumVersion: text((source.clientCompatibility as any).requiredEucliBoxCompatibility?.minimumVersion),
            maximumVersionExclusive: text((source.clientCompatibility as any).requiredEucliBoxCompatibility?.maximumVersionExclusive),
          },
        }
      : null,
  }
}

export function persistentPortStateLabel(port: PersistentPort): string {
  if (port.actualState === 'running') return '已开放'
  if (port.actualState === 'failed') return '开放失败'
  if (port.desiredState === 'enabled') return '等待开放'
  return '已停止'
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function finiteNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}
