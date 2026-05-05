import path from 'node:path'
import type { BackendFileSystemPort } from './fileSystemPort'

export type JsonStore = {
  read<T>(filePath: string): Promise<T | null>
  write<T>(filePath: string, value: T): Promise<void>
  remove(filePath: string): Promise<void>
}

export function createJsonStore(fs: BackendFileSystemPort): JsonStore {
  const writeQueues = new Map<string, Promise<void>>()

  return {
    async read<T>(filePath) {
      const text = await fs.readText(filePath).catch((error: any) => {
        if (String(error?.code || '') === 'ENOENT') return ''
        throw error
      })
      const trimmed = String(text || '').trim()
      if (!trimmed) return null
      try {
        return JSON.parse(trimmed) as T
      } catch (error) {
        throw new Error(`JSON 解析失败：${filePath}：${String((error as any)?.message || error)}`)
      }
    },
    write<T>(filePath, value) {
      const prev = writeQueues.get(filePath) || Promise.resolve()
      const next = prev.then(async () => {
        const temp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
        await fs.writeText(temp, `${JSON.stringify(value ?? null, null, 2)}\n`)
        await fs.ensureDir(path.dirname(filePath))
        await import('node:fs/promises').then((mod) => mod.rename(temp, filePath))
      }).finally(() => {
        if (writeQueues.get(filePath) === next) writeQueues.delete(filePath)
      })
      writeQueues.set(filePath, next)
      return next
    },
    remove(filePath) {
      return fs.deleteFile(filePath).catch((error: any) => {
        if (String(error?.code || '') === 'ENOENT') return
        throw error
      })
    },
  }
}
