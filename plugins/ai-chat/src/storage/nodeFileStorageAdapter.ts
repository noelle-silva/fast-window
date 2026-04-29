import fs from 'node:fs/promises'
import path from 'node:path'
import { storageKeyToRelPath, runtimeKeyToRelPath } from './storageCodec'
import type { AiChatBackendDataDirs } from './backendDataDirs'
import type { AiChatPersistentStorageAdapter, AiChatRuntimeStorageAdapter } from './types'

function safeRelPath(rel: string): string {
  const p = path.normalize(rel).replace(/\\/g, '/')
  if (p.startsWith('/') || p.startsWith('..') || /\0/.test(p)) {
    throw new Error(`Invalid storage path: ${rel}`)
  }
  return p
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.tmp`
  const text = JSON.stringify(value ?? null, null, 2) + '\n'
  await fs.writeFile(tmpPath, text, 'utf-8')
  await fs.rename(tmpPath, filePath)
}

export function createNodeFileStorageAdapter(dirs: AiChatBackendDataDirs): {
  persistent: AiChatPersistentStorageAdapter
  runtime: AiChatRuntimeStorageAdapter
} {
  const dataDir = dirs.dataDir

  const persistent: AiChatPersistentStorageAdapter = {
    get: async <T = unknown>(key: string): Promise<T | null> => {
      const rel = safeRelPath(storageKeyToRelPath(key))
      const fullPath = path.join(dataDir, rel)
      try {
        const text = await fs.readFile(fullPath, 'utf-8')
        const s = text.trim()
        if (!s) return null
        return JSON.parse(s) as T
      } catch (e: any) {
        if (e?.code === 'ENOENT') return null
        throw e
      }
    },
    set: async <T = unknown>(key: string, value: T): Promise<void> => {
      const rel = safeRelPath(storageKeyToRelPath(key))
      const fullPath = path.join(dataDir, rel)
      await atomicWriteJson(fullPath, value)
    },
    remove: async (key: string): Promise<void> => {
      const rel = safeRelPath(storageKeyToRelPath(key))
      const fullPath = path.join(dataDir, rel)
      try {
        await fs.unlink(fullPath)
      } catch (e: any) {
        if (e?.code === 'ENOENT') return
        throw e
      }
    },
  }

  const runtime: AiChatRuntimeStorageAdapter = {
    get: async <T = unknown>(key: string): Promise<T | null> => {
      const rel = safeRelPath(runtimeKeyToRelPath(key))
      const fullPath = path.join(dataDir, rel)
      try {
        const text = await fs.readFile(fullPath, 'utf-8')
        const s = text.trim()
        if (!s) return null
        return JSON.parse(s) as T
      } catch (e: any) {
        if (e?.code === 'ENOENT') return null
        throw e
      }
    },
    set: async <T = unknown>(key: string, value: T): Promise<void> => {
      const rel = safeRelPath(runtimeKeyToRelPath(key))
      const fullPath = path.join(dataDir, rel)
      await atomicWriteJson(fullPath, value)
    },
    remove: async (key: string): Promise<void> => {
      const rel = safeRelPath(runtimeKeyToRelPath(key))
      const fullPath = path.join(dataDir, rel)
      try {
        await fs.unlink(fullPath)
      } catch (e: any) {
        if (e?.code === 'ENOENT') return
        throw e
      }
    },
    listDir: async (runtimeDirKey: string) => {
      const dirRel = safeRelPath(`runtime/${runtimeDirKey.replace(/\\/g, '/').replace(/\/$/, '')}`)
      const fullPath = path.join(dataDir, dirRel)
      try {
        const entries = await fs.readdir(fullPath, { withFileTypes: true })
        return entries.map((e) => ({
          name: e.name,
          isFile: e.isFile(),
          isDirectory: e.isDirectory(),
        }))
      } catch (e: any) {
        if (e?.code === 'ENOENT') return []
        throw e
      }
    },
  }

  return { persistent, runtime }
}
