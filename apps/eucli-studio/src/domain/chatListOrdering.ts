import { normalizeTimeMs } from '../core/utils'
import { chatListAnchorAt, chatListAnchorForChat } from './chatListAnchor'

// 会话列表的排序规则只有这一份：先看位置锚点，再看创建时间，最后用 id 定序。
//
// 位置锚点由 chatListAnchor 提供：它只随「创建 / 用户发消息」推进。
// chat.updatedAt 会随流式输出一路推进，run 的起落与工具往返又是一串过程，
// 它们都不能进入排序键，否则多个并发输出的会话会互相把对方顶来顶去。
//
// 第二、第三层键负责确定性：同一毫秒发生的事件、以及同一时刻创建的会话，
// 必须永远排出同一个顺序，这样列表在任何一次刷新里都是恒等序列，不会重排。

// 排序输入的两种形态：
//   chatMetas  索引投影，可能没有正文；
//   chats      已经进入内存的会话正文。
export function chatListItemsOfBox(box: any): any[] {
  if (Array.isArray(box?.chatMetas) && box.chatMetas.length) return box.chatMetas
  return Array.isArray(box?.chats) ? box.chats : []
}

// 正文事件锚点表：会话正文在内存时，它的位置事实是消息级事件，
// 比索引里最后落盘的活动时间更权威。索引刷新无论如何改写 meta，
// 都改不动这张表，因此运行中的会话不会被索引刷新顶动。
export function chatListEventAnchorsOfBox(box: any): Map<string, number> {
  const anchors = new Map<string, number>()
  for (const chat of Array.isArray(box?.chats) ? box.chats : []) {
    const chatId = String(chat?.id || '').trim()
    if (!chatId) continue
    anchors.set(chatId, chatListAnchorForChat(chat))
  }
  return anchors
}

// 排序的唯一实现。eventAnchors 里存在的会话只用事件锚点，
// 其余会话用 meta 上的锚点（索引初值）。
export function sortChatListItemsForDisplay<T = any>(
  itemsRaw: T[],
  eventAnchors?: Map<string, number>,
): T[] {
  const items = Array.isArray(itemsRaw) ? itemsRaw : []
  // 锚点先各算一次：比较函数里不重复扫描消息，避免 O(n log n × 消息数)。
  const rows = items.map((item: any) => {
    const chatId = String(item?.id || '')
    const eventAnchor = eventAnchors?.get(chatId)
    return {
      item,
      anchorAt: typeof eventAnchor === 'number' ? eventAnchor : chatListAnchorAt(item),
      createdAt: normalizeTimeMs(item?.createdAt, 0),
      id: chatId,
    }
  })
  rows.sort((a, b) => {
    if (a.anchorAt !== b.anchorAt) return b.anchorAt - a.anchorAt
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    return a.id.localeCompare(b.id)
  })
  return rows.map((row) => row.item)
}

// 盒子级排序入口：侧边栏与键盘导航都必须走这里，
// 保证「看到的顺序」与「上下切换走的顺序」是同一份。
export function sortChatListItemsOfBox(box: any): any[] {
  return sortChatListItemsForDisplay(chatListItemsOfBox(box), chatListEventAnchorsOfBox(box))
}
