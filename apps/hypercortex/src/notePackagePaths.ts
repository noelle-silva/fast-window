import { NOTES_DIR, noteMonthFolderFromIdOrNow } from './core'

export const TRASH_DIR = 'Trash'

export function normalizeVaultPath(path: string): string {
  return String(path || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
}

export function notePackageDirForId(id: string): string {
  const noteId = normalizeNotePackageId(id)
  return `${NOTES_DIR}/${noteMonthFolderFromIdOrNow(noteId)}/${noteId}`
}

export function notePathInPackage(packageDir: string, file: string): string {
  const dir = pathParts(packageDir).join('/')
  const name = normalizePathSegment(file, '文件名')
  return `${dir}/${name}`
}

export function noteDirToTrashDir(noteDir: string): string {
  const parts = notePackagePathParts(noteDir, NOTES_DIR, '移入回收站')
  return [TRASH_DIR, ...parts.slice(1)].join('/')
}

export function trashDirToNoteDir(trashDir: string): string {
  const parts = notePackagePathParts(trashDir, TRASH_DIR, '恢复')
  return [NOTES_DIR, ...parts.slice(1)].join('/')
}

export function canonicalOriginalDirForTrashPackage(trashPackageDir: string, originalDir: string | undefined, noteId: string): string {
  const source = String(originalDir || '').trim() || trashDirToNoteDir(trashPackageDir)
  return canonicalNoteDirForId(source, noteId)
}

export function canonicalNoteDirForId(noteDir: string, noteId: string): string {
  const id = normalizeNotePackageId(noteId)
  const parts = notePackagePathParts(noteDir, NOTES_DIR, '规范化')
  return [NOTES_DIR, parts[1], id].join('/')
}

function notePackagePathParts(path: string, expectedRoot: string, action: string): string[] {
  const parts = pathParts(path)
  if (parts.length !== 3 || parts[0] !== expectedRoot) throw new Error(`笔记目录无法${action}：${normalizeVaultPath(path)}`)
  return parts
}

function normalizeNotePackageId(id: string): string {
  const noteId = String(id || '').trim()
  if (!noteId) throw new Error('笔记 id 不能为空')
  if (noteId === '.' || noteId === '..' || /[\\/\u0000]/.test(noteId)) throw new Error(`笔记 id 不能作为文件夹名：${noteId}`)
  return noteId
}

function normalizePathSegment(value: string, label: string): string {
  const segment = String(value || '').trim()
  if (!segment) throw new Error(`${label}不能为空`)
  if (segment === '.' || segment === '..' || /[\\/\u0000]/.test(segment)) throw new Error(`${label}不能包含路径分隔符`)
  return segment
}

function pathParts(path: string): string[] {
  const normalized = normalizeVaultPath(path)
  if (!normalized) throw new Error('路径不能为空')
  const parts = normalized.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /\u0000/.test(part))) throw new Error(`路径包含非法片段：${normalized}`)
  return parts
}
