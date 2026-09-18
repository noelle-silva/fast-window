export type ChatNavigationState = {
  olderId: string
  newerId: string
  lockedReason: string
}

function normalizeId(value: unknown) {
  return String(value || '').trim()
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
