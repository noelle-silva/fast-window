import { assistantRunGenerationId } from './assistantRunState'
import { chatMessageMaterialKind, isAsyncToolResultMessage } from './message'

// 找出消息里每一段「工具调用过程」：从第一条带工具部件的助手消息，
// 到这段过程最后一条消息（无工具的助手消息、或用户/系统消息之前）。
// 工具返回消息属于过程内部，不打断区间。
//
// 运行中与收尾后的两种口径：
//   - 运行中：这次运行还没收尾的过渡消息（先在思考、工具部件还没落进 parts）
//     也暂时算在过程里，工作过程于是全程保持展开，不会每轮都先跑到外面再跳回来；
//   - 收尾后：最后那条无工具的最终回复自然落回过程外，过程只在真正收尾时收缩一次。
// 判据由 isLive 注入：消息是否仍属于一次进行中的运行。

export type ToolProcessRange = {
  start: number
  end: number
  rounds: number
  toolCalls: number
  // 区间内仍在等待用户确认的工具调用数。
  pendingConfirmations: number
}

export type ToolProcessOptions = {
  // isLive 返回 true 表示这条消息所属的运行还没收尾。
  isLive?: (message: any) => boolean
}

const TOOL_RESPONSE_PREFIX = '<<<[TOOL_RESPONSE]>>>'

function hasToolParts(message: any) {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  return chatMessageMaterialKind(message) === 'assistant'
    && parts.some((part: any) => String(part?.type || '').trim() === 'tool')
}

function isToolResponse(message: any) {
  return isAsyncToolResultMessage(message) || String(message?.content || '').startsWith(TOOL_RESPONSE_PREFIX)
}

// 待确认判定与工具确认卡同源：调用状态与决策状态都必须是 needs_confirmation。
function isPendingConfirmationPart(part: any) {
  const decision = part?.decision && typeof part.decision === 'object' ? part.decision : null
  return (
    String(part?.state || '').trim() === 'needs_confirmation' &&
    String(decision?.status || '').trim() === 'needs_confirmation'
  )
}

// 轮 = 一次模型请求，对应区间内一条带工具的助手消息；调用次数按工具部件计。
function summarizeRange(messages: any[], start: number, end: number) {
  let rounds = 0
  let toolCalls = 0
  let pendingConfirmations = 0
  for (let index = start; index <= end; index++) {
    const message = messages[index]
    if (chatMessageMaterialKind(message) !== 'assistant') continue
    const parts = Array.isArray(message?.parts) ? message.parts : []
    const tools = parts.filter((part: any) => String(part?.type || '').trim() === 'tool')
    if (!tools.length) continue
    rounds++
    for (const part of tools) {
      toolCalls++
      if (isPendingConfirmationPart(part)) pendingConfirmations++
    }
  }
  return { rounds, toolCalls, pendingConfirmations }
}

// 同一次运行：工具部件落进来时，前面那几条同代的思考 / 正文就是这轮过程的开头。
function sameRun(previous: any, current: any) {
  const generationId = assistantRunGenerationId(previous)
  return !!generationId && generationId === assistantRunGenerationId(current)
}

export function findToolProcessRanges(messagesRaw: unknown, options?: ToolProcessOptions): ToolProcessRange[] {
  const messages = Array.isArray(messagesRaw) ? messagesRaw : []
  const isLive = typeof options?.isLive === 'function' ? options.isLive : null
  const ranges: ToolProcessRange[] = []
  // start 是过程起点；end 是「已确认属于过程」的最后一条：
  // 工具调用、工具结果，或这次运行里还没收尾的过渡消息。
  // 中间那些已收尾的纯文本仍然留在区间内——过程不该被它切断。
  let start = -1
  let end = -1

  const close = () => {
    if (start >= 0 && end >= start) ranges.push({ start, end, ...summarizeRange(messages, start, end) })
    start = -1
    end = -1
  }

  messages.forEach((message: any, index: number) => {
    if (start < 0) {
      if (!hasToolParts(message)) return
      start = index
      end = index
      // 同一次运行里已经先落下的思考 / 正文属于这轮过程的开头，一并收进来。
      let back = index - 1
      while (back >= 0 && chatMessageMaterialKind(messages[back]) === 'assistant' && sameRun(messages[back], message)) {
        start = back
        back--
      }
      return
    }
    if (hasToolParts(message) || isToolResponse(message)) {
      end = index
      return
    }
    if (chatMessageMaterialKind(message) === 'assistant') {
      // 运行中的过渡消息暂时留在过程内；收尾后它自然落回过程外。
      if (isLive?.(message)) end = index
      return
    }
    close()
  })

  close()
  return ranges
}
