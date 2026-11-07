// 列表位置锚点：会话在列表里的位置由「事件时间」决定，而不是由活跃度决定。
//
// 会推进锚点的事件只有四件：
//   created      会话诞生
//   user-sent    用户在这个会话里发出消息
//   run-started  一次 run 开始
//   run-settled  一次 run 到达终态
//
// 流式输出、run 内部进度、预览更新、chat.updatedAt 的推进都不在事件之列。
// 一次输出过程中锚点恒定，所以多个会话并发输出时各自留在原位：
// 开始时上浮一次、结束时上浮一次，不会互相顶动。
//
// 索引会话（只有 meta、没有正文）拿不到消息级事件，锚点取索引里最后
// 落盘的活动时间。它是静止快照，作用是在重启后恢复上一次的相对顺序。

import { normalizeTimeMs } from '../core/utils'
import { normalizeAssistantRunState } from './assistantRunState'

export type ChatListEventTimes = {
  createdAt: number
  userSentAt: number
  runStartedAt: number
  runSettledAt: number
}

// 会话正文里的事件时间。只认消息级事实：
// 用户消息的创建时间，assistant 消息上 run 的开始时间与终态时间。
//
// 消息时间单调递增，每一类事件的最大值都在最近一条同类消息上，
// 因此从尾部找第一个命中即可，不必全表扫描：输出刷新时这是常驻路径。
export function chatListEventTimes(chat: any): ChatListEventTimes {
  let userSentAt = 0
  let runStartedAt = 0
  let runSettledAt = 0
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  let needUser = true
  let needRun = true
  for (let index = messages.length - 1; index >= 0 && (needUser || needRun); index -= 1) {
    const message = messages[index]
    const role = String(message?.role || '').trim()
    if (needUser && role === 'user') {
      userSentAt = Math.max(userSentAt, normalizeTimeMs(message?.createdAt, 0))
      needUser = false
      continue
    }
    if (!needRun || role !== 'assistant') continue
    const run = normalizeAssistantRunState(message?.assistantRun)
    if (!run) continue
    runStartedAt = Math.max(runStartedAt, run.startedAt)
    runSettledAt = Math.max(runSettledAt, run.finishedAt || 0)
    needRun = false
  }
  return {
    createdAt: normalizeTimeMs(chat?.createdAt, 0),
    userSentAt,
    runStartedAt,
    runSettledAt,
  }
}

// 会话正文投影出的锚点：四类事件时间取最大值。
// 正文里连 createdAt 都没有时才退到 updatedAt，那是唯一的静止时间。
export function chatListAnchorForChat(chat: any): number {
  const times = chatListEventTimes(chat)
  const anchor = Math.max(times.createdAt, times.userSentAt, times.runStartedAt, times.runSettledAt)
  if (anchor > 0) return anchor
  return normalizeTimeMs(chat?.updatedAt, 0)
}

// 索引投影出的锚点：上游已算过就直接用，否则取最后落盘的活动时间。
// 索引没有消息级事件，updatedAt 在这里是静止快照而不是活跃信号。
export function chatListAnchorForIndex(raw: any, createdAt: number, updatedAt: number): number {
  const stored = normalizeTimeMs((raw as any)?.listAnchorAt, 0)
  if (stored > 0) return stored
  return Math.max(normalizeTimeMs(createdAt, 0), normalizeTimeMs(updatedAt, 0))
}

// 排序时的统一读取：meta 已带锚点就用它，正文对象则现场推导。
export function chatListAnchorAt(item: any): number {
  const stored = normalizeTimeMs(item?.listAnchorAt, 0)
  if (stored > 0) return stored
  if (Array.isArray(item?.messages)) return chatListAnchorForChat(item)
  return chatListAnchorForIndex(item, normalizeTimeMs(item?.createdAt, 0), normalizeTimeMs(item?.updatedAt, 0))
}
