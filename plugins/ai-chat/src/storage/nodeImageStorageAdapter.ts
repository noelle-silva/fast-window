import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AiChatImageStorageAdapter } from './types'

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp'])
const BASE64_MIME_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/

function generateSafeName(ext: string): string {
  const hash = crypto.randomBytes(16).toString('hex')
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`
  return `${hash}${safeExt}`
}

function validateExtension(ext: string): void {
  const lower = ext.toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(lower)) {
    throw new Error(`Unsupported image extension: ${ext}`)
  }
}

function safePath(filesDir: string, relPath: string): string {
  const resolved = path.resolve(filesDir, relPath)
  const normalized = path.normalize(resolved)
  if (!normalized.startsWith(path.normalize(filesDir) + path.sep) && normalized !== path.normalize(filesDir)) {
    throw new Error('Path traversal detected')
  }
  return normalized
}

function base64ToBuffer(dataUrl: string): { buffer: Buffer; ext: string; mime: string } {
  const match = BASE64_MIME_RE.exec(dataUrl)
  if (!match) throw new Error('Invalid data URL format')

  const mime = match[1].toLowerCase()
  const extMap: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
  }
  const ext = extMap[mime]
  if (!ext) throw new Error(`Unsupported MIME type: ${mime}`)

  const b64 = dataUrl.slice(match[0].length)
  return { buffer: Buffer.from(b64, 'base64'), ext, mime }
}

export function createNodeImageStorageAdapter(filesDataDir: string): AiChatImageStorageAdapter {
  return {
    writeBase64: async (req: unknown) => {
      const r = req as any
      const dataUrl = String(r?.dataUrlOrBase64 || r?.dataUrl || r?.base64 || '').trim()
      if (!dataUrl) throw new Error('dataUrl is required')

      const { buffer, ext, mime } = base64ToBuffer(dataUrl)

      let relPath = String(r?.relPath || r?.path || '').trim()
      if (!relPath) {
        relPath = generateSafeName(ext)
      } else {
        validateExtension(path.extname(relPath))
      }

      const fullPath = safePath(filesDataDir, relPath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, buffer)

      return { relPath, mime, size: buffer.length }
    },

    read: async (req: unknown) => {
      const r = req as any
      const relPath = String(r?.relPath || r?.path || '').trim()
      if (!relPath) throw new Error('relPath is required')

      const fullPath = safePath(filesDataDir, relPath)
      const buffer = await fs.readFile(fullPath)
      const ext = path.extname(relPath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      return `data:${mime};base64,${buffer.toString('base64')}`
    },

    delete: async (req: unknown) => {
      const r = req as any
      const relPath = String(r?.relPath || r?.path || '').trim()
      if (!relPath) throw new Error('relPath is required')

      const fullPath = safePath(filesDataDir, relPath)
      try {
        await fs.unlink(fullPath)
      } catch (e: any) {
        if (e?.code === 'ENOENT') return
        throw e
      }
    },
  }
}
