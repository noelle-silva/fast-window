// 「会话正文消息集合」的唯一写入口。
//
// chat.messages 是所有会话正文事实的容器。插入新消息、把存储快照合并进集合、
// 整体替换、删除一条 / 一批消息，最终都必须经过本模块落盘到会话对象。
// 调用点只负责决定「目标集合长什么样」，不再各自 push / filter / findIndex。
//
// 本模块只负责集合本身：
//   - 不改单条消息的内部字段（content / parts / assistantRun 统一走 chatMessageFields）；
//   - 不碰 activeChatId、chat.status、chatMetas、分支头与列表投影；
//   - 不解释运行期独占、材料冲突、窗口分页等策略，这些仍由调用方计算。
//
// 集合规则只有这一份：
//   - 同一个 id 只允许存在一条，追加时已存在则保持原样；
//   - 追加永远落在末尾，不改变已有消息的顺序；
//   - 整体替换保留调用方给出的顺序；
//   - 删除只移除指定 id，其余消息原样保留。

function messageIdOf(message: any): string {
  return String(message?.id || '').trim()
}

// commitChatMessages 是 chat.messages 的唯一赋值点。
// 本文件内其它操作只能构造目标数组，然后交给它落盘。
function commitChatMessages(chat: any, messages: any[]): any[] {
  chat.messages = messages
  return messages
}

function messagesOf(chat: any): any[] {
  return Array.isArray(chat?.messages) ? chat.messages : []
}

export function ensureChatMessages(chat: any): any[] {
  if (!chat || typeof chat !== 'object') return []
  const messages = messagesOf(chat)
  if (chat.messages === messages) return messages
  return commitChatMessages(chat, messages)
}

// replaceChatMessages 用于整体替换（存储快照合并、窗口重取、归一化结果落地）。
// 顺序完全由调用方决定：本模块不做排序，也不做隐式去重。
export function replaceChatMessages(chat: any, messages: any[]): any[] {
  if (!chat || typeof chat !== 'object') return []
  return commitChatMessages(chat, Array.isArray(messages) ? messages : [])
}

// appendChatMessage 用于「运行期新建消息」：只追加，不重排。
// 同 id 已存在时保持原消息（返回 false），避免重复项与意外覆盖。
export function appendChatMessage(chat: any, message: any): boolean {
  if (!chat || typeof chat !== 'object' || !message || typeof message !== 'object') return false
  const messages = ensureChatMessages(chat)
  const id = messageIdOf(message)
  if (id && messages.some((item: any) => messageIdOf(item) === id)) return false
  commitChatMessages(chat, messages.concat([message]))
  return true
}

// replaceChatMessageById 用于「原位更新一条已存在的消息」：
// 位置顺序不变，找不到目标时返回 false，绝不隐式追加。
export function replaceChatMessageById(chat: any, messageId: unknown, message: any): boolean {
  if (!chat || typeof chat !== 'object' || !message || typeof message !== 'object') return false
  const id = String(messageId ?? '').trim()
  if (!id) return false
  const messages = ensureChatMessages(chat)
  const index = messages.findIndex((item: any) => messageIdOf(item) === id)
  if (index < 0) return false
  const next = messages.slice()
  next[index] = message
  commitChatMessages(chat, next)
  return true
}

// removeChatMessages 用于删除一条或一批消息，返回实际移除的条数。
// 删除只按 id 命中；不做子树推导（那是分支删除策略的职责）。
export function removeChatMessages(chat: any, messageIds: unknown | readonly unknown[]): number {
  if (!chat || typeof chat !== 'object') return 0
  const messages = ensureChatMessages(chat)
  const rawIds = Array.isArray(messageIds) ? messageIds : [messageIds]
  const ids = new Set(rawIds.map((value) => String(value ?? '').trim()).filter(Boolean))
  if (!ids.size) return 0
  const next = messages.filter((item: any) => !ids.has(messageIdOf(item)))
  const removed = messages.length - next.length
  if (removed > 0) commitChatMessages(chat, next)
  return removed
}
