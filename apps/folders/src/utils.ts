import type { ContainerFormState, FolderFormState, FolderItem, FoldersDoc, FwLaunchInfo, GroupFormState } from './types'
import { DEFAULT_DESKTOP_ICON_LAYOUT } from './folder-grid/iconLayout'

export const DEFAULT_GROUP_ID = 'default'
export const ALL_GROUP_ID = '__all__'
export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = { launched: false, standalone: true, mode: 'standalone' }
export const DEFAULT_DOC: FoldersDoc = {
  schemaVersion: 1,
  dataVersion: 7,
  groups: [{ id: DEFAULT_GROUP_ID, name: '默认' }],
  items: [],
  containers: [],
  desktop: { iconLayout: DEFAULT_DESKTOP_ICON_LAYOUT },
  updatedAt: '',
}
export const EMPTY_FOLDER_FORM: FolderFormState = { name: '', path: '', groupId: DEFAULT_GROUP_ID, newGroupName: '' }
export const EMPTY_GROUP_FORM: GroupFormState = { id: '', name: '' }
export const EMPTY_CONTAINER_FORM: ContainerFormState = { id: '', name: '' }

export function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button,input,select,textarea,a,[role="button"],[role="combobox"],[role="listbox"],[role="option"],[data-window-control]'))
}

export function deriveNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

export function createID(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function groupName(doc: FoldersDoc, groupId: string): string {
  return doc.groups.find(group => group.id === groupId)?.name || '默认'
}

export function groupIdFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 32)
}

export function folderTemplate(groupId: string): FolderItem {
  return { id: '', name: '', path: '', groupId, createdAt: '', updatedAt: '', createdAtMs: 0, updatedAtMs: 0 }
}

export function containerTemplate(): ContainerFormState {
  return EMPTY_CONTAINER_FORM
}
