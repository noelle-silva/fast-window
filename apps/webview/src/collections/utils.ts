import type { CollectionItem, CollectionItemFormState, ContainerFormState, FwLaunchInfo, GroupFormState, WorkspaceView } from './types'
import { DEFAULT_DESKTOP_ICON_LAYOUT } from './folder-grid/iconLayout'
import { emptyIconAppearanceState, iconAppearanceStateForItem } from './iconAppearanceModel'
import { itemTargetValue } from './categoryRegistry'

export { deriveNameFromTarget } from './targetNaming'

export const DEFAULT_GROUP_ID = 'default'
export const DEFAULT_LAUNCH_INFO: FwLaunchInfo = { launched: false, standalone: true, mode: 'standalone' }

export const DEFAULT_WORKSPACE_VIEW: WorkspaceView = {
  schemaVersion: 1,
  dataVersion: 1,
  groups: [{ id: DEFAULT_GROUP_ID, name: '默认' }],
  items: [],
  containers: [],
  desktop: { iconLayout: DEFAULT_DESKTOP_ICON_LAYOUT },
  uiState: { groupId: DEFAULT_GROUP_ID },
}

export const EMPTY_ITEM_FORM: CollectionItemFormState = createEmptyItemForm()
export const EMPTY_GROUP_FORM: GroupFormState = { id: '', name: '' }
export const EMPTY_CONTAINER_FORM: ContainerFormState = { id: '', name: '' }

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

export function itemTemplate(groupId: string, containerId?: string): CollectionItem {
  return { id: '', name: '', target: { kind: 'url', url: '' }, groupId, containerId, pageOrder: 0, createdAt: '', updatedAt: '', createdAtMs: 0, updatedAtMs: 0 }
}

export function containerTemplate(): ContainerFormState {
  return EMPTY_CONTAINER_FORM
}
