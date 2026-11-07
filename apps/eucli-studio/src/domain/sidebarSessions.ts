import { sortChatListItemsOfBox } from './chatListOrdering'
import { workspaceRoleTargetId } from './workspaceRoleTarget'

function text(value: unknown) {
  return String(value || '').trim()
}

function boxSessions(box: any) {
  return {
    sessions: sortChatListItemsOfBox(box),
    activeChatId: text(box?.activeChatId),
  }
}

export function roleSidebarSessions(data: any, roleId: unknown) {
  const id = text(roleId)
  if (!id) return { sessions: [], activeChatId: '' }
  return boxSessions(data?.chatsByRole?.[id])
}

export function workspaceSidebarSessions(data: any, workspaceId: unknown, roleId: unknown) {
  const targetId = workspaceRoleTargetId(workspaceId, roleId)
  if (!targetId) return { sessions: [], activeChatId: '' }
  return boxSessions(data?.chatsByWorkspace?.[targetId])
}
