import { sortChatListItemsForDisplay } from './chatListOrdering'
import { workspaceRoleTargetId } from './workspaceRoleTarget'

function text(value: unknown) {
  return String(value || '').trim()
}

function boxSessions(box: any) {
  const raw = Array.isArray(box?.chatMetas) && box.chatMetas.length
    ? box.chatMetas
    : Array.isArray(box?.chats)
      ? box.chats
      : []
  return {
    sessions: sortChatListItemsForDisplay(raw),
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
