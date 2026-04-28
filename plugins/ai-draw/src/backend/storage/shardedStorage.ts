import path from 'node:path'
import type { AiDrawStorageKey } from '../../gateway/storageKeys'
import type { JsonStore } from './jsonStore'

export type ShardedStorage = {
  read<T>(key: AiDrawStorageKey): Promise<T | null>
  write<T>(key: AiDrawStorageKey, value: T): Promise<void>
  remove(key: AiDrawStorageKey): Promise<void>
}

const SHARD_KEY_TO_FILE: Record<AiDrawStorageKey, string> = {
  settings: 'settings.json',
  taskHistory: 'taskHistory.json',
  bgSavedResults: 'bgSavedResults.json',
  bgSaveRequests: 'bgSaveRequests.json',
  bgSaveResponses: 'bgSaveResponses.json',
  promptLibrary: 'promptLibrary.json',
  refLibraryIndex: 'refLibraryIndex.json',
  refImages: 'refImages.json',
  refImageHistory: 'refImageHistory.json',
}

function nowId() {
  const d = new Date()
  const pad = (n: number, w: number) => String(n).padStart(w, '0')
  return `${pad(d.getFullYear(), 4)}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`
}

export function createBackendShardedStorage(options: { dataDir: string; filesDataDir: string; store: JsonStore }): ShardedStorage {
  let ready = false
  let readyPromise: Promise<void> | null = null
  const fileForKey = (key: AiDrawStorageKey) => path.join(options.dataDir, SHARD_KEY_TO_FILE[key])

  async function readLegacyShard(file: string) {
    return options.store.read(path.join(options.filesDataDir, 'files', 'storage', file)).catch(() => null)
  }

  async function ensureReady() {
    if (ready) return
    if (readyPromise) return readyPromise
    readyPromise = Promise.resolve().then(async () => {
      const meta = await options.store.read<any>(path.join(options.dataDir, '_meta.json')).catch(() => null)
      if (meta && Number(meta.schemaVersion || 0) >= 1) {
        ready = true
        return
      }

      const snapshot: Record<string, unknown> = {}
      for (const [key, file] of Object.entries(SHARD_KEY_TO_FILE) as Array<[AiDrawStorageKey, string]>) {
        const direct = await options.store.read(fileForKey(key)).catch(() => null)
        const legacy = direct ?? await readLegacyShard(file)
        if (legacy != null) snapshot[key] = legacy
      }

      if (!Object.keys(snapshot).length) {
        const legacyPack = await options.store.read<Record<string, unknown>>(path.join(options.dataDir, 'ai-draw.json')).catch(() => null)
        if (legacyPack && typeof legacyPack === 'object') {
          for (const key of Object.keys(SHARD_KEY_TO_FILE) as AiDrawStorageKey[]) {
            if (legacyPack[key] != null) snapshot[key] = legacyPack[key]
          }
        }
      }

      if (Object.keys(snapshot).length) {
        await options.store.write(path.join(options.dataDir, `_backup-migrate-${nowId()}.json`), snapshot).catch(() => {})
        for (const key of Object.keys(SHARD_KEY_TO_FILE) as AiDrawStorageKey[]) {
          if (snapshot[key] != null) await options.store.write(fileForKey(key), snapshot[key])
        }
      }

      await options.store.write(path.join(options.dataDir, '_meta.json'), { schemaVersion: 1, migratedAt: Date.now() })
      ready = true
    }).finally(() => {
      readyPromise = null
    })
    return readyPromise
  }

  return {
    async read<T>(key) {
      await ensureReady()
      return options.store.read<T>(fileForKey(key))
    },
    async write<T>(key, value) {
      await ensureReady()
      await options.store.write(fileForKey(key), value)
    },
    async remove(key) {
      await ensureReady()
      await options.store.remove(fileForKey(key))
    },
  }
}
