import type { CategoryWorkspace, CollectionContainer } from './types'

export type ItemCreationTarget = {
  groupId: string
  containerId?: string
}

export function desktopItemCreationTarget(workspace: CategoryWorkspace, preferredGroupId: string): ItemCreationTarget {
  const groupId = preferredGroupId.trim()
  if (!groupId || !workspace.groups.some(group => group.id === groupId)) throw new Error(`item creation group does not exist: ${preferredGroupId}`)
  return { groupId }
}

export function containerItemCreationTarget(workspace: CategoryWorkspace, container: CollectionContainer): ItemCreationTarget {
  if (!workspace.containers.some(current => current.id === container.id)) throw new Error(`item creation container does not exist: ${container.id}`)
  if (!workspace.groups.some(group => group.id === container.groupId)) throw new Error(`item creation container group does not exist: ${container.groupId}`)
  return { groupId: container.groupId, containerId: container.id }
}

export function assertItemCreationTarget(workspace: CategoryWorkspace, target: ItemCreationTarget): void {
  if (!workspace.groups.some(group => group.id === target.groupId)) throw new Error(`item creation target group does not exist: ${target.groupId}`)
  if (!target.containerId) return

  const container = workspace.containers.find(current => current.id === target.containerId)
  if (!container) throw new Error(`item creation target container does not exist: ${target.containerId}`)
  if (container.groupId !== target.groupId) throw new Error('item creation target container group mismatch')
}
