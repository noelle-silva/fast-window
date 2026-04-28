import { readFile, rm } from 'node:fs/promises'
import { extname } from 'node:path'
import { isManagedClipboardImagePath } from '../shared/imagePaths'
import type { ClipboardHistoryItem } from '../shared/types'
import { resolvePathInOutput } from './paths'

function mimeFromPath(path: string) {
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

export async function readOutputImage(path: string): Promise<string> {
  const safePath = resolvePathInOutput(path)
  const data = await readFile(safePath)
  return `data:${mimeFromPath(path)};base64,${data.toString('base64')}`
}

export async function deleteManagedOutputImage(path: string): Promise<void> {
  if (!isManagedClipboardImagePath(path)) return
  await rm(resolvePathInOutput(path), { force: true })
}

export async function deleteManagedImagesForHistory(items: ClipboardHistoryItem[]): Promise<void> {
  await Promise.allSettled(
    (Array.isArray(items) ? items : [])
      .filter(item => item && item.type === 'image')
      .map(item => deleteManagedOutputImage(item.path || item.content)),
  )
}
