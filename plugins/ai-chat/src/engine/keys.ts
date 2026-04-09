import { now, uid } from '../core/utils'

export const AI_CHAT_ENGINE_VERSION = 1

export const AI_CHAT_ENGINE_PREFIX = 'engine.v1'

export function newRunId() {
  return uid('run')
}

export function runsDirKey() {
  return `${AI_CHAT_ENGINE_PREFIX}/runs`
}

export function runKey(runId: string) {
  const id = String(runId || '').trim()
  if (!id) throw new Error('runId 不能为空')
  return `${runsDirKey()}/${id}`
}

export function runProgressDirKey() {
  return `${AI_CHAT_ENGINE_PREFIX}/progress`
}

export function runProgressKey(runId: string) {
  const id = String(runId || '').trim()
  if (!id) throw new Error('runId 不能为空')
  return `${runProgressDirKey()}/${id}`
}

function fnv1a32(input: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

export function runScopeKey(params: { kind: string; targetId: string; chatId: string; branchId: string }) {
  const kind = String(params.kind || '').trim() === 'group' ? 'group' : 'role'
  const tid = String(params.targetId || '').trim()
  const cid = String(params.chatId || '').trim()
  const bid = String(params.branchId || '').trim()
  if (!tid || !cid || !bid) throw new Error('scope key 参数不完整')
  return `${kind}:${tid}/${cid}@${bid}`
}

export function scopeLockKey(scopeKey: string) {
  const s = String(scopeKey || '').trim()
  if (!s) throw new Error('scopeKey 不能为空')
  const h = fnv1a32(s).toString(16).padStart(8, '0')
  return `${AI_CHAT_ENGINE_PREFIX}/locks/scope/${h}`
}

export function newOwnerId() {
  return uid('owner')
}

export function lockPayload(owner: string, ttlMs: number) {
  const o = String(owner || '').trim()
  if (!o) throw new Error('owner 不能为空')
  const ttl = Math.max(300, Math.min(30_000, Math.floor(ttlMs || 0)))
  return { owner: o, expiresAt: now() + ttl }
}

