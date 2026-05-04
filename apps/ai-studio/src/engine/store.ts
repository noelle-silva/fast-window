import { now } from '../core/utils'
import type { AiChatRuntimeDirEntry, AiChatRuntimeStore, AiChatRun, AiChatRunProgress } from './types'
import { runKey, runProgressKey, runsDirKey } from './keys'

function normalizeEntryName(ent: AiChatRuntimeDirEntry) {
  const name = String(ent?.name || '').trim()
  return name
}

export function createAiChatRunStore(store: AiChatRuntimeStore) {
  async function getRun(runId: string): Promise<AiChatRun | null> {
    const key = runKey(runId)
    const raw = await store.get(key)
    if (!raw || typeof raw !== 'object') return null
    return raw as AiChatRun
  }

  async function setRun(run: AiChatRun) {
    await store.set(runKey(run.id), run)
  }

  async function patchRun(runId: string, patch: Partial<AiChatRun>) {
    const cur = (await getRun(runId)) || null
    if (!cur) return
    const next: AiChatRun = { ...(cur as any), ...(patch as any), id: cur.id, updatedAt: now() }
    await setRun(next)
  }

  async function getProgress(runId: string): Promise<AiChatRunProgress | null> {
    const raw = await store.get(runProgressKey(runId))
    if (!raw || typeof raw !== 'object') return null
    const text = typeof (raw as any).text === 'string' ? String((raw as any).text) : ''
    const updatedAt = Number((raw as any).updatedAt || 0)
    return { text, updatedAt: isFinite(updatedAt) ? updatedAt : 0 }
  }

  async function setProgress(runId: string, progress: AiChatRunProgress) {
    await store.set(runProgressKey(runId), progress)
  }

  async function removeProgress(runId: string) {
    try {
      await store.remove(runProgressKey(runId))
    } catch (_) {}
  }

  async function listRunIds(limit = 200) {
    if (typeof store.listDir !== 'function') throw new Error('runtimeStorage.listDir 不可用（需要桥接层支持）')
    const dir = runsDirKey()
    const entries = await store.listDir(dir).catch(() => [])
    const out: string[] = []
    for (const ent of entries) {
      if (!ent || !(ent as any).isFile) continue
      const name = normalizeEntryName(ent)
      if (!name.toLowerCase().endsWith('.json')) continue
      const base = name.slice(0, name.length - 5)
      if (!base) continue
      out.push(base)
      if (out.length >= Math.max(1, Math.min(1000, Math.floor(limit || 0)))) break
    }
    return out
  }

  async function removeRun(runId: string) {
    await store.remove(runKey(runId))
    await removeProgress(runId)
  }

  return { getRun, setRun, patchRun, getProgress, setProgress, removeProgress, listRunIds, removeRun }
}

