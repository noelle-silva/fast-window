export type ToolConfirmationInfo = {
  decisionId: string
  partId: string
  toolName: string
  state: string
  decisionStatus: string
  reason: string
  inputText: string
  rawText: string
  pending: boolean
}

function text(value: unknown) {
  return String(value || '').trim()
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value && typeof value === 'object' ? value : {}, null, 2)
  } catch (_) {
    return String(value ?? '')
  }
}

export function readToolConfirmationInfo(part: any): ToolConfirmationInfo | null {
  if (!part || typeof part !== 'object' || text(part.type) !== 'tool') return null
  const decision = part.decision && typeof part.decision === 'object' ? part.decision : null
  const decisionId = text(decision?.id)
  if (!decisionId) return null
  const state = text(part.state)
  const decisionStatus = text(decision?.status)
  const toolName = text(part.toolName || decision?.toolName) || 'tool'
  return {
    decisionId,
    partId: text(part.id || part.callId),
    toolName,
    state,
    decisionStatus,
    reason: text(decision?.reason),
    inputText: prettyJson(part.input),
    rawText: String(part.raw || ''),
    pending: state === 'needs_confirmation' && decisionStatus === 'needs_confirmation',
  }
}

export function isPendingToolConfirmationPart(part: any) {
  return !!readToolConfirmationInfo(part)?.pending
}
