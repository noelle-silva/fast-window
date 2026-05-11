import type { CategoryWorkspace, CategoryWorkspaceView, CollectionCategoryId, CollectionItem, CollectionItemFormState, CollectionsDoc, ContainerFormState, FwLaunchInfo, GroupFormState } from './types'
import { DEFAULT_DESKTOP_ICON_LAYOUT } from './folder-grid/iconLayout'
import { emptyIconAppearanceState, iconAppearanceStateForItem } from './iconAppearanceModel'
import { itemTargetValue } from './categoryRegistry'

export const DEFAULT_GROUP_ID = 'default'
export const DEFAULT_CATEGORY_ID: CollectionCategoryId = 'folder'
export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = { launched: false, standalone: true, mode: 'standalone' }

export const DEFAULT_DOC: CollectionsDoc = {
  schemaVersion: 1,
  dataVersion: 5,
  activeCategoryId: DEFAULT_CATEGORY_ID,
  categories: [createDefaultWorkspace('folder'), createDefaultWorkspace('url'), createDefaultWorkspace('file')],
  updatedAt: '',
}

export const DEFAULT_WORKSPACE_VIEW: CategoryWorkspaceView = {
  ...createDefaultWorkspace(DEFAULT_CATEGORY_ID),
  schemaVersion: DEFAULT_DOC.schemaVersion,
  dataVersion: DEFAULT_DOC.dataVersion,
}

export const EMPTY_ITEM_FORM: CollectionItemFormState = createEmptyItemForm()
export const EMPTY_GROUP_FORM: GroupFormState = { id: '', name: '' }
export const EMPTY_CONTAINER_FORM: ContainerFormState = { id: '', name: '' }

export function createDefaultWorkspace(id: CollectionCategoryId): CategoryWorkspace {
  return {
    id,
    groups: [{ id: DEFAULT_GROUP_ID, name: '默认' }],
    items: [],
    containers: [],
    desktop: { iconLayout: DEFAULT_DESKTOP_ICON_LAYOUT },
  }
}

export function createEmptyItemForm(groupId = DEFAULT_GROUP_ID): CollectionItemFormState {
  return { name: '', target: '', groupId, newGroupName: '', icon: emptyIconAppearanceState() }
}

export function itemFormFromItem(item: CollectionItem): CollectionItemFormState {
  return { name: item.name, target: itemTargetValue(item), groupId: item.groupId, newGroupName: '', icon: iconAppearanceStateForItem(item) }
}

export function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button,input,select,textarea,a,[role="button"],[role="combobox"],[role="listbox"],[role="option"],[data-window-control]'))
}

export function deriveNameFromTarget(target: string): string {
  const trimmed = target.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return url.hostname || trimmed
  } catch {
    const parts = trimmed.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts[parts.length - 1] || trimmed
  }
}

export function createID(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function groupIdFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 32)
}

export function itemTemplate(categoryId: CollectionCategoryId, groupId: string): CollectionItem {
  const target = categoryId === 'url' ? { kind: 'url' as const, url: '' } : { kind: categoryId, path: '' }
  return { id: '', name: '', target, groupId, pageOrder: 0, createdAt: '', updatedAt: '', createdAtMs: 0, updatedAtMs: 0 }
}

export function containerTemplate(): ContainerFormState {
  return EMPTY_CONTAINER_FORM
}
