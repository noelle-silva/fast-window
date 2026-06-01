import { invoke } from '@tauri-apps/api/core'
import { extFromMime } from '../core'
import type { VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { AssetUploadTaskSnapshot, LocalAssetFile } from '../gateway/types'
import type { HyperCortexNoteResourceRef } from '../noteSchema'

const UPLOAD_POLL_INTERVAL_MS = 300

type StagedPastedAssetFile = {
  path?: string
  name?: string
}

export function filesFromClipboardData(data: DataTransfer | null | undefined): File[] {
  const directFiles = Array.from(data?.files || []).filter(isUsableClipboardFile)
  if (directFiles.length) return directFiles

  return Array.from(data?.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter(isUsableClipboardFile)
}

export async function startPastedAssetUploadTask(
  gateway: HyperCortexGateway,
  scope: VaultScope,
  files: File[],
): Promise<AssetUploadTaskSnapshot | null> {
  let uploadFiles: LocalAssetFile[] = []
  try {
    uploadFiles = await clipboardFilesToLocalAssetFiles(files)
    if (!uploadFiles.length) return null
    return await gateway.assets.startUpload(scope, uploadFiles)
  } catch (error) {
    await cleanupStagedPastedAssetFiles(uploadFiles)
    throw error
  }
}

export async function uploadPastedAssetFiles(
  gateway: HyperCortexGateway,
  scope: VaultScope,
  files: File[],
): Promise<HyperCortexNoteResourceRef[]> {
  const task = await startPastedAssetUploadTask(gateway, scope, files)
  if (!task) return []
  const completed = await waitForUploadTask(gateway, task)
  return completed.result || (completed.files.map(file => file.resource).filter(Boolean) as HyperCortexNoteResourceRef[])
}

function isUsableClipboardFile(file: File | null | undefined): file is File {
  return Boolean(file && file.size > 0)
}

async function fileToLocalAssetFile(file: File): Promise<LocalAssetFile> {
  const displayName = normalizePastedFileName(file)
  const staged = await stagePastedAssetFile(file, displayName)
  return {
    path: staged.path,
    name: displayName,
    displayName,
    size: file.size,
    deleteSourceAfterUpload: true,
  }
}

async function clipboardFilesToLocalAssetFiles(files: File[]): Promise<LocalAssetFile[]> {
  const uploadFiles: LocalAssetFile[] = []
  for (const file of files) {
    if (!isUsableClipboardFile(file)) continue
    uploadFiles.push(await fileToLocalAssetFile(file))
  }
  return uploadFiles
}

async function stagePastedAssetFile(file: File, name: string): Promise<StagedPastedAssetFile> {
  const staged = await invoke<StagedPastedAssetFile>('stage_pasted_asset_file', {
    input: {
      name,
      contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
    },
  })
  const path = String(staged?.path || '').trim()
  if (!path) throw new Error('粘贴附件临时文件创建失败')
  return { path, name: String(staged?.name || name).trim() || name }
}

async function cleanupStagedPastedAssetFiles(files: LocalAssetFile[]): Promise<void> {
  const paths = files
    .filter(file => file.deleteSourceAfterUpload)
    .map(file => String(file.path || '').trim())
    .filter(Boolean)
  if (!paths.length) return
  await invoke('cleanup_staged_pasted_asset_files', { paths }).catch(() => {})
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
