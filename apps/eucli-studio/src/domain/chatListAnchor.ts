// 列表位置锚点：会话在列表里的位置只由「用户自己的动作时间」决定。
//
// 会推进锚点的事件只有两件：
//   created    会话诞生
//   user-sent  用户在这个会话里发出消息
//
// 一次用户回合里的所有过程都不得影响位置：流式输出、run 开始与结束、
// 工具往返产生的中间 run、预览更新、chat.updatedAt 的推进。
//
// 为什么连「回合结束」也不作为位置事件：一次回合里模型每调用一次工具就会起
// 一个新的 run，前一个 run 的终态与新 run 的启动之间存在一个瞬时终态窗口，
// 任何「以终态时间为位置键」的做法都会在这个窗口里把会话顶动一次。位置只认
// 用户动作，才能做到整轮零位移；回合是否完成由运行指示器与通知表达。
//
// 索引会话（只有 meta、没有正文）拿不到消息级事件，锚点取索引里最后
// 落盘的活动时间。它是静止快照，作用是在重启后恢复上一次的相对顺序。

import { normalizeTimeMs } from '../core/utils'

export type ChatListEventTimes = {
  createdAt: number
  userSentAt: number
}

export function chatListEventTimes(chat: any): ChatListEventTimes {
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  // 消息时间单调递增：最近一条用户消息就是这一类事件的最大值。
  // 输出刷新时这是常驻路径，不值得全表扫描。
  let userSentAt = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (String(message?.role || '').trim() !== 'user') continue
    userSentAt = normalizeTimeMs(message?.createdAt, 0)
    break
  }
  return {
    createdAt: normalizeTimeMs(chat?.createdAt, 0),
    userSentAt,
  }
}

// 会话正文投影出的锚点：用户动作时间取最大值。
// 正文里连 createdAt 都没有时才退到 updatedAt，那是唯一的静止时间。
export function chatListAnchorForChat(chat: any): number {
  const times = chatListEventTimes(chat)
  const anchor = Math.max(times.createdAt, times.userSentAt)
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
