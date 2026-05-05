import { promises as fs } from 'node:fs'
import path from 'node:path'

export type BackendFileSystemPort = {
  ensureDir(targetPath: string): Promise<void>
  listFiles(dir: string): Promise<Array<{ name: string; path: string; isFile: boolean; mtimeMs: number }>>
  readText(targetPath: string): Promise<string>
  writeText(targetPath: string, text: string): Promise<void>
  readBinary(targetPath: string): Promise<Uint8Array>
  writeBinary(targetPath: string, bytes: Uint8Array): Promise<void>
  deleteFile(targetPath: string): Promise<void>
}

export function assertInsideRoot(root: string, relativePath: string) {
  const normalized = path.normalize(String(relativePath || '')).replace(/^([/\\])+/, '')
  if (!normalized || normalized === '.' || normalized.startsWith('..') || path.isAbsolute(normalized)) throw new Error('路径无效')
  const full = path.resolve(root, normalized)
  const base = path.resolve(root)
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) throw new Error('路径越界')
  return { relativePath: normalized, fullPath: full }
}

export function createNodeFileSystemPort(): BackendFileSystemPort {
  return {
    ensureDir: (targetPath) => fs.mkdir(targetPath, { recursive: true }).then(() => undefined),
    async listFiles(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      const out = await Promise.all(entries.map(async (entry) => {
        const full = path.join(dir, entry.name)
        const stat = await fs.stat(full).catch(() => null)
        return { name: entry.name, path: full, isFile: entry.isFile(), mtimeMs: stat?.mtimeMs || 0 }
      }))
      return out
    },
    readText: (targetPath) => fs.readFile(targetPath, 'utf8'),
    async writeText(targetPath, text) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, text, 'utf8')
    },
    readBinary: (targetPath) => fs.readFile(targetPath),
    async writeBinary(targetPath, bytes) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, bytes)
    },
    async deleteFile(targetPath) {
      const stat = await fs.stat(targetPath)
      if (!stat.isFile()) throw new Error('只允许删除文件')
      await fs.unlink(targetPath)
    },
  }
}
