import type { AiDrawStorageKey } from './storageKeys'

export type TextFilePort = {
  listDir: (scope: 'data', dir: string | null) => Promise<Array<{ name?: string; isFile?: boolean }>>
  readText: (scope: 'data', path: string) => Promise<string>
  writeText: (scope: 'data', path: string, text: string, overwrite: boolean) => Promise<void>
  delete: (scope: 'data', path: string) => Promise<void>
}

export type ShardedStorage = {
  read: <T>(key: AiDrawStorageKey) => Promise<T | null>
  write: <T>(key: AiDrawStorageKey, value: T) => Promise<void>
  remove: (key: AiDrawStorageKey) => Promise<void>
}

const SHARD_META_PATH = '_meta.json'
const OLD_SHARDS_DIR = 'files/storage'

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

async function readJsonFromFiles(files: TextFilePort, path: string) {
  let text = ''
  try {
    text = await files.readText('data', path)
  } catch {
    return null
  }
  const s = String(text || '').trim()
  if (!s) return null
  try {
    return JSON.parse(s) as unknown
  } catch {
    throw new Error(`JSON 解析失败：${path}`)
  }
}

async function writeJsonToFiles(files: TextFilePort, path: string, value: unknown) {
  const text = JSON.stringify(value ?? null, null, 2) + '\n'
  await files.writeText('data', path, text, true)
}

export function createShardedStorage(files: TextFilePort): ShardedStorage {
  let shardReady = false
  let shardReadyPromise: Promise<void> | null = null

  async function ensureShardReady() {
    if (shardReady) return
    if (shardReadyPromise) return shardReadyPromise

    shardReadyPromise = Promise.resolve()
      .then(async () => {
        await files.listDir('data', null)
        const meta = await readJsonFromFiles(files, SHARD_META_PATH).catch(() => null)
        if (meta && typeof meta === 'object' && Number((meta as { schemaVersion?: unknown }).schemaVersion || 0) >= 1) {
          shardReady = true
          return
        }

        let existed = false
        try {
          const entries = await files.listDir('data', null).catch(() => [])
          const names = new Set(
            Array.isArray(entries) ? entries.filter((entry) => entry && entry.isFile).map((entry) => String(entry.name || '')) : [],
          )
          existed = Object.values(SHARD_KEY_TO_FILE).some((path) => names.has(path))
        } catch {
          existed = false
        }
        if (existed) {
          shardReady = true
          await writeJsonToFiles(files, SHARD_META_PATH, { schemaVersion: 1, migratedAt: Date.now(), reason: 'shards-existed' })
          return
        }

        const snapshot2: Record<string, unknown> = {}
        for (const key of Object.keys(SHARD_KEY_TO_FILE) as AiDrawStorageKey[]) {
          const file = SHARD_KEY_TO_FILE[key]
          const value = await readJsonFromFiles(files, `${OLD_SHARDS_DIR}/${file}`).catch(() => null)
          if (value != null) snapshot2[key] = value
        }

        if (Object.keys(snapshot2).length) {
          await writeJsonToFiles(files, `_backup-migrate-${nowId()}.json`, snapshot2).catch(() => {})

          for (const key of Object.keys(SHARD_KEY_TO_FILE) as AiDrawStorageKey[]) {
            if (snapshot2[key] == null) continue
            await writeJsonToFiles(files, SHARD_KEY_TO_FILE[key], snapshot2[key])
          }

          for (const key of Object.keys(SHARD_KEY_TO_FILE) as AiDrawStorageKey[]) {
            const file = SHARD_KEY_TO_FILE[key]
            await files.delete('data', `${OLD_SHARDS_DIR}/${file}`).catch(() => {})
          }

          await writeJsonToFiles(files, SHARD_META_PATH, {
            schemaVersion: 1,
            migratedAt: Date.now(),
            source: { from: 'files/storage' },
          })
          shardReady = true
          return
        }

        const source: Record<string, unknown> = { from: 'ai-draw.json' }
        const snapshot: Record<string, unknown> = {}

        try {
          const full = await readJsonFromFiles(files, 'ai-draw.json').catch(() => null)
          const obj = full && typeof full === 'object' ? (full as Record<string, unknown>) : null
          if (!obj) throw new Error('ai-draw.json is empty')
          for (const key of Object.keys(SHARD_KEY_TO_FILE) as AiDrawStorageKey[]) {
            const value = obj[key]
            if (value != null) snapshot[key] = value
          }
        } catch {
          source.fileReadable = false
        }

        if (Object.keys(snapshot).length) {
          await writeJsonToFiles(files, `_backup-migrate-${nowId()}.json`, snapshot).catch(() => {})
        }

        for (const key of Object.keys(SHARD_KEY_TO_FILE) as AiDrawStorageKey[]) {
          if (snapshot[key] == null) continue
          await writeJsonToFiles(files, SHARD_KEY_TO_FILE[key], snapshot[key])
        }

        await writeJsonToFiles(files, SHARD_META_PATH, { schemaVersion: 1, migratedAt: Date.now(), source })
        shardReady = true
      })
      .finally(() => {
        shardReadyPromise = null
      })

    return shardReadyPromise
  }

  return {
    read: async <T>(key: AiDrawStorageKey) => {
      await ensureShardReady()
      return (await readJsonFromFiles(files, SHARD_KEY_TO_FILE[key])) as T | null
    },
    write: async <T>(key: AiDrawStorageKey, value: T) => {
      await ensureShardReady()
      await writeJsonToFiles(files, SHARD_KEY_TO_FILE[key], value)
    },
    remove: async (key: AiDrawStorageKey) => {
      await ensureShardReady()
      await files.delete('data', SHARD_KEY_TO_FILE[key]).catch((e: unknown) => {
        const msg = String(e instanceof Error ? e.message : e || '')
        if (msg.includes('文件不存在')) return
        throw e
      })
    },
  }
}
