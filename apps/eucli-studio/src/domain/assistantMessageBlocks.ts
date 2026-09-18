import { isPendingToolConfirmationPart } from './toolConfirmation'

export type AssistantMessageBlockKind = 'text' | 'reasoning' | 'tool_confirmation' | 'tool_invocation' | 'tool_result'

export type AssistantMessageBlock =
  | { kind: 'text'; id: string; text: string; start: number; end: number }
  | { kind: 'reasoning'; id: string; part: any }
  | { kind: 'tool_confirmation'; id: string; part: any }
  | { kind: 'tool_invocation'; id: string; part: any; start?: number; end?: number }
  | { kind: 'tool_result'; id: string; part: any; start?: number; end?: number }

export function assistantToolParts(parts: any[]) {
  return (Array.isArray(parts) ? parts : []).filter((part: any) => String(part?.type || '') === 'tool')
}

export function assistantToolPartId(part: any, index = 0) {
  return String(part?.id || part?.callId || `tool:${index}`)
}

function toolPartDisplay(part: any) {
  return part?.display && typeof part.display === 'object' ? part.display : {}
}

export function isToolInvocationHidden(part: any) {
  return !!toolPartDisplay(part).hideInvocation
}

export function isToolResultHidden(part: any) {
  return !!toolPartDisplay(part).hideResult
}

function pushToolBlocks(blocks: AssistantMessageBlock[], part: any, opts?: { start?: number; end?: number; index?: number }) {
  const id = assistantToolPartId(part, opts?.index || blocks.length)
  const start = typeof opts?.start === 'number' ? opts.start : undefined
  const end = typeof opts?.end === 'number' ? opts.end : undefined
  if (isPendingToolConfirmationPart(part)) blocks.push({ kind: 'tool_confirmation', id: `tool-confirmation:${id}`, part })
  if (!isToolInvocationHidden(part)) blocks.push({ kind: 'tool_invocation', id: `tool-invocation:${id}`, part, start, end })
  if (part?.result && typeof part.result === 'object' && !isToolResultHidden(part)) blocks.push({ kind: 'tool_result', id: `tool-result:${id}`, part, start, end })
}

export function planAssistantMessageBlocks(contentRaw: unknown, partsRaw: any[]): AssistantMessageBlock[] {
  const content = String(contentRaw ?? '')
  const toolParts = assistantToolParts(partsRaw)
  const reasoningParts = (Array.isArray(partsRaw) ? partsRaw : []).filter((part: any) => String(part?.type || '').trim() === 'reasoning' && String(part?.text || '').trim())
  const blocks: AssistantMessageBlock[] = []

  reasoningParts.forEach((part: any, index: number) => {
    blocks.push({ kind: 'reasoning', id: String(part?.id || `reasoning:${index}`), part })
  })

  if (content.trim()) blocks.push({ kind: 'text', id: `text:0:${content.length}`, text: content, start: 0, end: content.length })

  toolParts.forEach((part: any, index: number) => {
    pushToolBlocks(blocks, part, { index })
  })

  return blocks
}
