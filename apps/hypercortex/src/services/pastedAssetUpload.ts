import { extFromMime } from '../core'
import type { VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { AssetUploadTaskSnapshot, LocalAssetFile } from '../gateway/types'
import type { HyperCortexNoteResourceRef } from '../noteSchema'

const UPLOAD_POLL_INTERVAL_MS = 300

export function filesFromClipboardData(data: DataTransfer | null | undefined): File[] {
  const files = Array.from(data?.files || [])
  return files.filter(file => file.size > 0)
}

export async function uploadPastedAssetFiles(
  gateway: HyperCortexGateway,
  scope: VaultScope,
  files: File[],
): Promise<HyperCortexNoteResourceRef[]> {
  const uploadFiles = await Promise.all(files.map(fileToLocalAssetFile))
  const task = await gateway.assets.startUpload(scope, uploadFiles)
  const completed = await waitForUploadTask(gateway, task)
  return completed.result || (completed.files.map(file => file.resource).filter(Boolean) as HyperCortexNoteResourceRef[])
}

async function fileToLocalAssetFile(file: File): Promise<LocalAssetFile> {
  const name = normalizePastedFileName(file)
  return {
    name,
    displayName: name,
    mime: String(file.type || '').trim() || undefined,
    size: file.size,
    dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
  }
}

function normalizePastedFileName(file: File): string {
  const rawName = String(file.name || '').trim()
  if (rawName) return rawName
  const ext = extFromMime(file.type)
  if (ext) return `pasted-attachment.${ext}`
  return 'pasted-attachment'
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

async function waitForUploadTask(gateway: HyperCortexGateway, initial: AssetUploadTaskSnapshot): Promise<AssetUploadTaskSnapshot> {
  let task = initial
  while (task.status === 'queued' || task.status === 'running' || task.status === 'paused') {
    await delay(UPLOAD_POLL_INTERVAL_MS)
    const tasks = await gateway.assets.listUploadTasks()
    task = tasks.find(item => item.id === initial.id) || task
  }

  if (task.status !== 'completed') {
    throw new Error(task.error || '附件上传未完成')
  }
  return task
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}
