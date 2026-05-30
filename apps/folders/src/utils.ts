import type { CategoryWorkspace, CategoryWorkspaceView, CollectionCategoryId, CollectionItem, CollectionItemFormState, CollectionsDoc, ContainerFormState, FoldersUiState, FwLaunchInfo, GroupFormState, CollectionViewCategoryId } from './types'
import { DEFAULT_DESKTOP_ICON_LAYOUT } from './folder-grid/iconLayout'
import { emptyIconAppearanceState, iconAppearanceStateForItem } from './iconAppearanceModel'
import { ALL_VIEW_CATEGORY_ID, DEFAULT_VIEW_CATEGORY_ORDER, itemTargetValue } from './categoryRegistry'

export { deriveNameFromTarget } from './targetNaming'

export const DEFAULT_GROUP_ID = 'default'
export const DEFAULT_DATA_CATEGORY_ID: CollectionCategoryId = 'folder'
export const DEFAULT_VIEW_CATEGORY_ID: CollectionViewCategoryId = ALL_VIEW_CATEGORY_ID
export const DEFAULT_UI_STATE: FoldersUiState = {
  activeCategoryId: DEFAULT_VIEW_CATEGORY_ID,
  groupIdByCategory: { all: DEFAULT_GROUP_ID, folder: DEFAULT_GROUP_ID, url: DEFAULT_GROUP_ID, file: DEFAULT_GROUP_ID },
}
export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = { launched: false, standalone: true, mode: 'standalone' }

export const DEFAULT_DOC: CollectionsDoc = {
  schemaVersion: 1,
  dataVersion: 9,
  activeCategoryId: DEFAULT_DATA_CATEGORY_ID,
  categoryOrder: DEFAULT_VIEW_CATEGORY_ORDER,
  categories: [createDefaultWorkspace('folder'), createDefaultWorkspace('url'), createDefaultWorkspace('file')],
  uiState: DEFAULT_UI_STATE,
  updatedAt: '',
}

export const DEFAULT_WORKSPACE_VIEW: CategoryWorkspaceView = {
  ...createDefaultWorkspace(DEFAULT_VIEW_CATEGORY_ID, '全部'),
  schemaVersion: DEFAULT_DOC.schemaVersion,
  dataVersion: DEFAULT_DOC.dataVersion,
  categoryOrder: DEFAULT_DOC.categoryOrder,
  uiState: DEFAULT_UI_STATE,
}

export const EMPTY_ITEM_FORM: CollectionItemFormState = createEmptyItemForm()
export const EMPTY_GROUP_FORM: GroupFormState = { id: '', name: '' }
export const EMPTY_CONTAINER_FORM: ContainerFormState = { id: '', name: '' }

export function createDefaultWorkspace(id: CollectionViewCategoryId, groupName = '默认'): CategoryWorkspace {
  return {
    id,
    groups: [{ id: DEFAULT_GROUP_ID, name: groupName }],
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

export function createID(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createGroupID(): string {
  const timePart = Date.now().toString(36)
  const randomPart = Math.random().toString(36).slice(2, 12)
  return `group-${timePart}-${randomPart}`
}

export function itemTemplate(categoryId: CollectionCategoryId, groupId: string, containerId?: string): CollectionItem {
  const target = categoryId === 'url' ? { kind: 'url' as const, url: '' } : { kind: categoryId, path: '' }
  return { id: '', name: '', target, groupId, containerId, pageOrder: 0, createdAt: '', updatedAt: '', createdAtMs: 0, updatedAtMs: 0 }
}

export function containerTemplate(): ContainerFormState {
  return EMPTY_CONTAINER_FORM
}
