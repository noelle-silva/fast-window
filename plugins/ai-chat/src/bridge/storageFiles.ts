import { AnyRecord, FILE_SUFFIX, runtimeKeyToRelPath, storageKeyToRelPath } from './storageCodec'
import { createPluginFilesClient } from './pluginFilesClient'
import { migrateIfNeeded } from './migrate'

export function createAiChatStorage(tauri: any, pluginId: string) {
  const client = createPluginFilesClient(tauri, pluginId)

  let ready = false
  let readyPromise: Promise<void> | null = null

  async function ensureReady() {
    if (ready) return
    if (readyPromise) return readyPromise
    readyPromise = Promise.resolve()
      .then(async () => {
        await migrateIfNeeded(tauri, pluginId)
        ready = true
      })
      .finally(() => {
        readyPromise = null
      })
    return readyPromise
  }

  const storage = {
    get: async (key: any) => {
      await ensureReady()
      return client.readJson(storageKeyToRelPath(String(key ?? '')))
    },
    set: async (key: any, value: any) => {
      await ensureReady()
      await client.writeJson(storageKeyToRelPath(String(key ?? '')), value)
    },
    remove: async (key: any) => {
      await ensureReady()
      await client.deleteIfExists(storageKeyToRelPath(String(key ?? '')))
    },
    getAll: async () => {
      const out: AnyRecord = {}
      await ensureReady()
      const roots = ['meta', 'roles', 'chats', 'stickers']
      const walk = async (dir: string) => {
        const entries = await client.listDir(dir).catch(() => [])
        if (!Array.isArray(entries)) return
        for (const ent of entries) {
          if (!ent) continue
          const name = String((ent as any).name || '')
          if (!name) continue
          const full = `${dir}/${name}`
          if ((ent as any).isDirectory) {
            await walk(full)
            continue
          }
          if (!(ent as any).isFile) continue
          if (!name.toLowerCase().endsWith(FILE_SUFFIX)) continue
          const rel = full.replaceAll('\\', '/')
          const key = rel.slice(0, rel.length - FILE_SUFFIX.length)
          if (!key) continue
          out[key] = await client.readJson(rel)
        }
      }
      for (const r of roots) await walk(r)
      return out
    },
  }

  let rtWriteChain = Promise.resolve()
  const rtQueue = new Map<string, { t: 'set'; v: any } | { t: 'rm' }>()
  let rtFlushTimer: any = 0

  function scheduleRtFlush() {
    if (rtFlushTimer) return
    rtFlushTimer = setTimeout(() => {
      rtFlushTimer = 0
      if (rtQueue.size === 0) return
      const batch = Array.from(rtQueue.entries())
      rtQueue.clear()
      rtWriteChain = rtWriteChain
        .then(async () => {
          for (const [path, op] of batch) {
            if ((op as any).t === 'set') await client.writeJson(path, (op as any).v)
            else await client.deleteIfExists(path)
          }
        })
        .catch(() => {})
    }, 150)
  }

  async function runtimeSetRaw(key: string, value: any) {
    await ensureReady()
    const path = runtimeKeyToRelPath(key)
    rtQueue.set(path, { t: 'set', v: value })
    scheduleRtFlush()
  }

  async function runtimeRemoveRaw(key: string) {
    await ensureReady()
    const path = runtimeKeyToRelPath(key)
    rtQueue.set(path, { t: 'rm' })
    scheduleRtFlush()
  }

  async function runtimeFlush() {
    await ensureReady()
    if (rtFlushTimer) {
      clearTimeout(rtFlushTimer)
      rtFlushTimer = 0
    }
    if (rtQueue.size > 0) {
      const batch = Array.from(rtQueue.entries())
      rtQueue.clear()
      rtWriteChain = rtWriteChain
        .then(async () => {
          for (const [path, op] of batch) {
            if ((op as any).t === 'set') await client.writeJson(path, (op as any).v)
            else await client.deleteIfExists(path)
          }
        })
        .catch(() => {})
    }
    try {
      await rtWriteChain
    } catch (_) {}
  }

  const runtimeStorage = {
    get: async (key: any) => {
      await ensureReady()
      const p = runtimeKeyToRelPath(String(key ?? ''))
      const pending = rtQueue.get(p)
      if (pending) return (pending as any).t === 'set' ? (pending as any).v : null
      return client.readJson(p)
    },
    set: async (key: any, value: any) => runtimeSetRaw(String(key ?? ''), value),
    remove: async (key: any) => runtimeRemoveRaw(String(key ?? '')),
    flush: async () => runtimeFlush(),
  }

  return { storage, runtimeStorage }
}
