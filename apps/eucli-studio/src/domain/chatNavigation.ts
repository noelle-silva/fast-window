import { sortChatListItemsForDisplay } from './chatListOrdering'
import { pendingChatForTarget } from './pendingChat'
import { workspaceRoleTargetId } from './workspaceRoleTarget'

export type ChatNavigationState = {
  olderId: string
  newerId: string
  lockedReason: string
}

export type ChatNavigationTargetKind = 'role' | 'group' | 'workspace'

function normalizeId(value: unknown) {
  return String(value || '').trim()
}

// 活动会话箱的规范键：工作区会话按「工作区::角色」复合键存放，直接拿工作区 id 查会取空，
// 历史切换按钮就会恒灰。角色与群组没有复合键，各自用自己的 id。
export function activeChatTargetKey(
  kind: ChatNavigationTargetKind,
  ids: { groupId?: unknown; workspaceId?: unknown; roleId?: unknown },
): string {
  if (kind === 'group') return normalizeId(ids.groupId)
  if (kind === 'workspace') return workspaceRoleTargetId(ids.workspaceId, ids.roleId)
  return normalizeId(ids.roleId)
}

export function chatNavigationFromOrderedChats(input: { orderedChats: any[]; activeChatId: unknown; pendingChat?: any }): ChatNavigationState {
  const ids = (Array.isArray(input.orderedChats) ? input.orderedChats : [])
    .map((chat: any) => normalizeId(chat?.id))
    .filter((id: string) => !!id)

  if (!ids.length) return { olderId: '', newerId: '', lockedReason: input.pendingChat ? '暂无已保存会话' : '暂无会话' }

  const activeChatId = normalizeId(input.activeChatId)
  const pendingChatId = normalizeId(input.pendingChat?.id)
  if (pendingChatId && activeChatId === pendingChatId) return { olderId: ids[0] || '', newerId: '', lockedReason: '' }

  const idx = ids.findIndex((id) => id === activeChatId)
  const index = idx >= 0 ? idx : 0
  const olderId = index + 1 < ids.length ? ids[index + 1] : ''
  const newerId = index - 1 >= 0 ? ids[index - 1] : ''
  return { olderId, newerId, lockedReason: '' }
}

// 活动目标的会话导航：先做「是否已选择目标」的守卫，再按规范键取会话箱，
// 排序后交给 chatNavigationFromOrderedChats 计算可切换的较旧/较新会话。
export function resolveActiveChatNav(input: {
  loading: boolean
  kind: ChatNavigationTargetKind
  groupId?: unknown
  workspaceId?: unknown
  roleId?: unknown
  data: any
  state: any
  activeChat: any
}): ChatNavigationState {
  if (input.loading) return { olderId: '', newerId: '', lockedReason: '正在加载中' }

  const kind = input.kind
  const groupId = normalizeId(input.groupId)
  const workspaceId = normalizeId(input.workspaceId)
  const roleId = normalizeId(input.roleId)
  let lockedReason = ''
  if (kind === 'group') {
    if (!groupId) lockedReason = '请先选择群组'
  } else if (kind === 'workspace') {
    if (!workspaceId) lockedReason = '请先选择工作区'
  } else if (!roleId) {
    lockedReason = '请先选择角色'
  }
  if (lockedReason) return { olderId: '', newerId: '', lockedReason }
  if (!input.data) return { olderId: '', newerId: '', lockedReason: '数据未就绪' }

  const targetId = activeChatTargetKey(kind, { groupId, workspaceId, roleId })
  const box = kind === 'group'
    ? input.data?.chatsByGroup?.[targetId]
    : kind === 'workspace'
      ? input.data?.chatsByWorkspace?.[targetId]
      : input.data?.chatsByRole?.[targetId]
  const chats = sortChatListItemsForDisplay(Array.isArray(box?.chatMetas) && box.chatMetas.length ? box.chatMetas : Array.isArray(box?.chats) ? box.chats : [])
  const pendingChat = pendingChatForTarget(input.state, kind, targetId)
  const currentChatId = String(input.activeChat?.id || box?.activeChatId || String(chats[0]?.id || '') || '')
  return chatNavigationFromOrderedChats({ orderedChats: chats, activeChatId: currentChatId, pendingChat })
}
