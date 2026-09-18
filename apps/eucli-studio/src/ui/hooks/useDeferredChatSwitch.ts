import * as React from 'react'

function chatIdOf(chat: any) {
  return String(chat?.id || '').trim()
}

export function useDeferredChatSwitch(controller: any, activeChat: any, selectedChatId: unknown, selectedChatKey: unknown) {
  const deferredChat = React.useDeferredValue(activeChat)
  const activeChatId = chatIdOf(activeChat)
  const selectedId = String(selectedChatId || activeChatId || '').trim()
  const selectedKey = String(selectedChatKey || '').trim()
  const loadedKey = selectedId && activeChatId === selectedId ? selectedKey : ''
  const deferredLoadedKey = React.useDeferredValue(loadedKey)
  const deferredChatId = chatIdOf(deferredChat)
  const deferredMatchesSelection = !!selectedId && deferredChatId === selectedId && (!selectedKey || deferredLoadedKey === selectedKey)
  const switching = !!selectedId && !deferredMatchesSelection

  const requestSwitch = React.useCallback(
    (chatId: any, options?: { force?: boolean }) => {
      const nextChatId = String(chatId || '').trim()
      if (!nextChatId) return
      if (!options?.force && nextChatId === selectedId) return

      React.startTransition(() => {
        controller?.actions?.setActiveChat?.(nextChatId)
      })
    },
    [controller, selectedId],
  )

  // 会话身份先响应，重消息区后承载；切换间隙不渲染旧会话，避免旧内容按钮误操作到新会话。
  const renderChat = deferredMatchesSelection ? deferredChat : null
  const renderChatId = chatIdOf(renderChat)

  return { activeChatId: selectedId, loadedChatId: activeChatId, selectedChatId: selectedId, deferredChatId, renderChat, renderChatId, switching, requestSwitch }
}
