import type { AiChatRuntimeStore } from './types'

function timeoutErr(label: string) {
  return new Error(`${label} timeout`)
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  const t = Math.max(1, Math.floor(ms || 0))
  return await Promise.race([p, new Promise<T>((_resolve, reject) => setTimeout(() => reject(timeoutErr(label)), t))])
}

export function wrapRuntimeStoreWithTimeout(
  store: AiChatRuntimeStore,
  opts?: { readMs?: number; writeMs?: number; listDirMs?: number }
): AiChatRuntimeStore {
  const readMs = Math.max(200, Math.min(30_000, Math.floor(opts?.readMs ?? 2500)))
  const writeMs = Math.max(200, Math.min(30_000, Math.floor(opts?.writeMs ?? 2500)))
  const listDirMs = Math.max(200, Math.min(60_000, Math.floor(opts?.listDirMs ?? 8000)))

  return {
    get: (key: string) => withTimeout(store.get(key), readMs, `store.get:${key}`),
    set: (key: string, value: any) => withTimeout(store.set(key, value), writeMs, `store.set:${key}`),
    remove: (key: string) => withTimeout(store.remove(key), writeMs, `store.remove:${key}`),
    listDir:
      typeof store.listDir === 'function'
        ? (dir: string) => withTimeout(store.listDir!(dir), listDirMs, `store.listDir:${dir}`)
        : undefined,
  }
}

