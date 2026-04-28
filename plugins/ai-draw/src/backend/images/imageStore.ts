import path from 'node:path'
import { inferImageMimeFromBase64, normalizeImageBase64, normalizeImageDataUrlOrBase64 } from '../../core/images'
import type { BackendFileSystemPort } from '../storage/fileSystemPort'
import { assertInsideRoot } from '../storage/fileSystemPort'

export type ImageStore = {
  list(): Promise<string[]>
  read(relativePath: string): Promise<string>
  saveBase64(dataUrlOrBase64: string): Promise<string>
  delete(relativePath: string): Promise<void>
}

function extFromMime(mime: string) {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

function randomName(ext: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')
  return `${stamp}-${Math.random().toString(16).slice(2)}.${ext}`
}

export function createImageStore(rootDir: string, fs: BackendFileSystemPort): ImageStore {
  return {
    async list() {
      await fs.ensureDir(rootDir)
      const entries = await fs.listFiles(rootDir)
      return entries
        .filter((entry) => entry.isFile && /\.(png|jpg|jpeg|webp|gif)$/i.test(entry.name))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .map((entry) => entry.name)
    },
    async read(relativePath) {
      const safe = assertInsideRoot(rootDir, relativePath)
      const bytes = await fs.readBinary(safe.fullPath)
      const ext = path.extname(safe.relativePath).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/png'
      return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
    },
    async saveBase64(dataUrlOrBase64) {
      const dataUrl = normalizeImageDataUrlOrBase64(dataUrlOrBase64)
      const base64 = normalizeImageBase64(dataUrl)
      if (!base64) throw new Error('图片数据无效')
      const mime = inferImageMimeFromBase64(dataUrl) || 'image/png'
      const fileName = randomName(extFromMime(mime))
      const target = path.join(rootDir, fileName)
      await fs.writeBinary(target, Buffer.from(base64, 'base64'))
      return fileName
    },
    async delete(relativePath) {
      const safe = assertInsideRoot(rootDir, relativePath)
      await fs.deleteFile(safe.fullPath)
    },
  }
}
