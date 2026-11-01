// 「聊天列表 / 会话索引投影」的唯一写入口。
//
// box.chats 与 box.chatMetas 共同表达同一份列表事实：
//   - chatMetas：索引投影，是侧边栏列表的事实源；
//   - chats：已经进入内存的会话正文，是列表的工作集。
// 两者必须由同一处写入，否则会出现「meta 有、chats 没有」「删除后又回魂」
// 这类无法解释的分叉。
//
// 本模块只负责列表事实：不碰 activeChatId、chat.status、正文与分支头。
// 索引快照、正文加载、运行事件、重命名、删除、归一化都可以提供输入，
// 但最终落到 box 的写入必须经过 writeChatListProjection。
//
// 列表顺序策略也只有这里一份：
//   - 已有会话在原位置合并，不因更新而挪到列表头；
//   - 新会话进入列表头；
//   - 整体替换（索引快照 / 批量刷新）保留调用方给出的顺序。
//
// 注意：列表顺序不是「谁覆盖谁」的事实冲突。来源优先级只作用在
// 「同一条会话的列表字段」上，统一由 chatMeta.resolveChatMetaFact 裁决；
// 这里只表达排序策略，不存在隐式的最后写入者获胜。

import {
  chatMetaFromChat,
  chatMetasFromBox,
  resolveChatMetaFact,
  normalizeChatMeta,
  normalizeChatMetas,
  type ChatMeta,
} from './chatMeta'
import { mergeChatFromStorage } from './chatStorageSync'

export type ChatListProjection = {
  chats: any[]
  chatMetas: ChatMeta[]
  // 本次 upsert 合并后的会话；其余写入为 null。
  chat: any | null
}

export type ChatListProjectionWrite =
  // 只补齐 box 形状：不重算投影（事件路径只要求 box 可写）。
  | { kind: 'ensure' }
  // 从当前 box 重新推导投影（归一化 / 确保盒子健康）。
  | { kind: 'derive'; fallbackTitle?: string }
  // 用给定事实整体替换（索引快照 / 批量刷新）。
  | { kind: 'replace'; chats: any[]; chatMetas: any[] }
  // 单条会话进入内存：合并正文 + 更新列表投影。
  | { kind: 'upsert'; chat: any; fallbackTitle?: string; updateMeta?: boolean }
  // 只更新索引投影（重命名 / 运行事件推进 meta）。
  | { kind: 'upsertMeta'; meta: any; fallbackTitle?: string }
  // 会话离开列表（删除 / 存储缺失）。
  | { kind: 'remove'; chatId: unknown; fallbackTitle?: string }

const DEFAULT_TITLE = '新聊天'

function titleOf(value: string | undefined, fallback = DEFAULT_TITLE) {
  return value || fallback
}

function chatsOf(box: any): any[] {
  return Array.isArray(box?.chats) ? box.chats : []
}

function chatIdOf(chat: any): string {
  return String(chat?.id || '').trim()
}

// 列表投影的合并规则只有这一份：
//   - 已有会话原位合并（窗口切片不覆盖索引事实）；
//   - 新会话进入列表头。
function upsertMeta(listRaw: any, metaRaw: any, fallbackTitle: string): ChatMeta[] {
  const meta = normalizeChatMeta(metaRaw, '', fallbackTitle)
  if (!meta) return normalizeChatMetas(listRaw, [], {}, fallbackTitle)
  const out = normalizeChatMetas(listRaw, [], {}, fallbackTitle)
  const index = out.findIndex((item) => item.id === meta.id)
  if (index >= 0) {
    const merged = resolveChatMetaFact(out[index], meta)
    if (merged) out[index] = merged
  } else {
    out.unshift(meta)
  }
  return out
}

function removeMeta(listRaw: any, chatId: string, fallbackTitle: string): ChatMeta[] {
  return normalizeChatMetas(listRaw, [], {}, fallbackTitle).filter((item) => item.id !== chatId)
}

export function writeChatListProjection(box: any, write: ChatListProjectionWrite): ChatListProjection | null {
  if (!box || typeof box !== 'object') return null

  if (write.kind === 'ensure') {
    box.chats = chatsOf(box)
    box.chatMetas = Array.isArray(box.chatMetas) ? box.chatMetas : []
    return { chats: box.chats, chatMetas: box.chatMetas, chat: null }
  }

  if (write.kind === 'derive') {
    const fallbackTitle = titleOf(write.fallbackTitle)
    box.chats = chatsOf(box)
    box.chatMetas = chatMetasFromBox(box, fallbackTitle)
    return { chats: box.chats, chatMetas: box.chatMetas, chat: null }
  }

  if (write.kind === 'replace') {
    box.chats = Array.isArray(write.chats) ? write.chats : []
    box.chatMetas = Array.isArray(write.chatMetas) ? write.chatMetas : []
    return { chats: box.chats, chatMetas: box.chatMetas, chat: null }
  }

  if (write.kind === 'upsert') {
    const chatId = chatIdOf(write.chat)
    if (!chatId) return null
    const fallbackTitle = titleOf(write.fallbackTitle)
    const chats = chatsOf(box)
    const index = chats.findIndex((item: any) => chatIdOf(item) === chatId)
    const nextChat = mergeChatFromStorage(write.chat, index >= 0 ? chats[index] : null) || write.chat
    if (index >= 0) chats[index] = nextChat
    else chats.unshift(nextChat)
    box.chats = chats
    box.chatMetas = write.updateMeta === false
      ? (Array.isArray(box.chatMetas) ? box.chatMetas : [])
      : upsertMeta(box.chatMetas, chatMetaFromChat(nextChat, fallbackTitle), fallbackTitle)
    return { chats: box.chats, chatMetas: box.chatMetas, chat: nextChat }
  }

  if (write.kind === 'upsertMeta') {
    const fallbackTitle = titleOf(write.fallbackTitle)
    box.chats = chatsOf(box)
    box.chatMetas = upsertMeta(box.chatMetas, write.meta, fallbackTitle)
    return { chats: box.chats, chatMetas: box.chatMetas, chat: null }
  }

  const chatId = String(write.chatId ?? '').trim()
  const fallbackTitle = titleOf(write.fallbackTitle)
  box.chats = chatsOf(box).filter((item: any) => chatIdOf(item) !== chatId)
  box.chatMetas = removeMeta(box.chatMetas, chatId, fallbackTitle)
  return { chats: box.chats, chatMetas: box.chatMetas, chat: null }
}
