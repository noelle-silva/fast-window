// 「单条会话消息字段」的唯一写入口。
//
// 消息一旦进入 chat.messages，它的 content / parts / reasoning 状态 /
// assistantRun / pending / streaming / error / updatedAt 等字段只允许在这里写入。
// 调用方只负责计算「目标字段」，不再直接对消息对象赋值：
//   - 流式增量、运行状态推进、编辑与回滚、思维链清洗、工具片段 / 实时输出更新
//     全部构造字段补丁，交给本模块落地；
//   - 消息对象身份与 chat.messages 集合不在这里改变，集合事务见 chatMessageCollection。
//
// 因此 grep 任何单条消息字段的赋值（message.content = / message.parts = ...）
// 只会在本文件命中。

export type ChatMessageFields = Record<string, unknown>

// 书写显式的字段写入器，让「字段写入」在源码里可被 grep 定位。
// 其余已知结构字段同样经过本模块，但不改变消息对象身份。
const FIELD_WRITERS: Record<string, (message: any, value: unknown) => void> = {
  content: (message, value) => {
    message.content = value
  },
  parts: (message, value) => {
    message.parts = value
  },
  reasoning: (message, value) => {
    message.reasoning = value
  },
  assistantRun: (message, value) => {
    message.assistantRun = value
  },
  pending: (message, value) => {
    message.pending = value
  },
  streaming: (message, value) => {
    message.streaming = value
  },
  error: (message, value) => {
    message.error = value
  },
  updatedAt: (message, value) => {
    message.updatedAt = value
  },
  role: (message, value) => {
    message.role = value
  },
  type: (message, value) => {
    message.type = value
  },
  parentMid: (message, value) => {
    message.parentMid = value
  },
  branchId: (message, value) => {
    message.branchId = value
  },
  runtimeOnly: (message, value) => {
    message.runtimeOnly = value
  },
}

// writeChatMessageFields 是单条消息字段的唯一赋值点。
//   - 只应用补丁里出现的键；没出现的字段保持原值；
//   - 值相同则不重写，返回是否有实际变化；
//   - 不改消息 id，不做集合增删（那属于 chatMessageCollection）。
export function writeChatMessageFields(message: any, fields: ChatMessageFields): boolean {
  if (!message || typeof message !== 'object') return false
  if (!fields || typeof fields !== 'object') return false
  let changed = false
  for (const key of Object.keys(fields)) {
    const value = fields[key]
    if (Object.is(message[key], value)) continue
    const writer = FIELD_WRITERS[key]
    if (writer) writer(message, value)
    else message[key] = value
    changed = true
  }
  return changed
}
