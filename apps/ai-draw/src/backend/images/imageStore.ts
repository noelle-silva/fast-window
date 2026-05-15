import path from 'node:path'
import { inferImageMimeFromBase64, normalizeImageBase64, normalizeImageDataUrlOrBase64 } from '../../core/images'
import type { BackendFileSystemPort } from '../storage/fileSystemPort'
import { assertInsideRoot } from '../storage/fileSystemPort'

export type ImageStore = {
  list(): Promise<string[]>
  read(relativePath: string): Promise<string>
  saveBase64(dataUrlOrBase64: string): Promise<string>
  exportToDir(relativePaths: string[], targetDir: string): Promise<string[]>
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
    async exportToDir(relativePaths, targetDir) {
      const paths = normalizeImagePathList(relativePaths, 5000)
      if (!paths.length) throw new Error('请选择要导出的图片')
      const targetDirText = String(targetDir || '').trim()
      if (!targetDirText || !path.isAbsolute(targetDirText)) throw new Error('导出目录无效')
      const safeTargetDir = path.resolve(targetDirText)
      await fs.ensureDir(safeTargetDir)
      await assertWritableDir(safeTargetDir, fs)

      const exportedPaths: string[] = []
      for (const relativePath of paths) {
        const source = assertInsideRoot(rootDir, relativePath)
        if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(source.relativePath)) throw new Error('只能导出图片文件')
        const bytes = await fs.readBinary(source.fullPath)
        const target = await uniqueTargetPath(safeTargetDir, path.basename(source.relativePath), fs)
        await fs.writeBinaryExclusive(target, bytes)
        exportedPaths.push(target)
      }
      return exportedPaths
    },
    async delete(relativePath) {
      const safe = assertInsideRoot(rootDir, relativePath)
      await fs.deleteFile(safe.fullPath)
    },
  }
}

async function assertWritableDir(targetDir: string, fs: BackendFileSystemPort) {
  const testPath = path.join(targetDir, `.fw-ai-draw-write-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await fs.writeBinaryExclusive(testPath, Buffer.from('ok'))
  await fs.deleteFile(testPath)
}

function normalizeImagePathList(raw: string[], limit: number) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const value = String(item || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (limit > 0 && out.length >= limit) break
  }
  return out
}

async function uniqueTargetPath(targetDir: string, fileName: string, fs: BackendFileSystemPort) {
  const safeName = path.basename(String(fileName || '').trim()) || 'image.png'
  const ext = path.extname(safeName)
  const stem = path.basename(safeName, ext) || 'image'
  const first = path.join(targetDir, safeName)
  if (!(await fileExists(first, fs))) return first
  for (let index = 1; ; index++) {
    const candidate = path.join(targetDir, `${stem}-${index}${ext}`)
    if (!(await fileExists(candidate, fs))) return candidate
  }
}

async function fileExists(targetPath: string, fs: BackendFileSystemPort) {
  try {
    await fs.readBinary(targetPath)
    return true
  } catch {
    return false
  }
}
