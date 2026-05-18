import { uid, clamp } from '../core/utils'
import { MAX_DRAFT_FILES } from './constants'

export type DraftFileKind = 'txt' | 'md' | 'pdf' | 'docx' | 'ppt'

export interface DraftFileItem {
  id: string
  name: string
  size: number
  kind: DraftFileKind
  pending: boolean
  text: string
  sendPct: number
  error: string
}

export interface DraftImageItem {
  id: string
  name: string
  dataUrl: string
}

export function fileExtLower(name: string): string {
  const n = String(name || '')
  const i = n.lastIndexOf('.')
  if (i < 0) return ''
  return n.slice(i + 1).toLowerCase()
}

export function detectDraftFileKind(file: File): DraftFileKind | '' {
  const ext = fileExtLower(file?.name || '')
  if (ext === 'txt') return 'txt'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'ppt' || ext === 'pptx') return 'ppt'
  const mime = String(file?.type || '').toLowerCase()
  if (mime === 'text/plain') return 'txt'
  if (mime === 'text/markdown') return 'md'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (mime === 'application/vnd.ms-powerpoint') return 'ppt'
  if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'ppt'
  return ''
}

export function addDraftFilePlaceholder(
  draftFiles: DraftFileItem[],
  file: File,
  kind: DraftFileKind
): DraftFileItem | null {
  if (draftFiles.length >= MAX_DRAFT_FILES) return null
  const it: DraftFileItem = {
    id: uid('f'),
    name: String(file?.name || '文件'),
    size: clamp(Number(file?.size || 0), 0, Number.MAX_SAFE_INTEGER),
    kind,
    pending: true,
    text: '',
    sendPct: 100,
    error: '',
  }
  draftFiles.push(it)
  return it
}

export function removeDraftFile(draftFiles: DraftFileItem[], id: string): DraftFileItem[] {
  const rid = String(id || '')
  if (!rid) return draftFiles
  return draftFiles.filter((x) => String(x?.id || '') !== rid)
}

export function removeDraftImage(images: DraftImageItem[], id: string): DraftImageItem[] {
  const rid = String(id || '')
  if (!rid) return images
  return images.filter((x) => String(x?.id || '') !== rid)
}
