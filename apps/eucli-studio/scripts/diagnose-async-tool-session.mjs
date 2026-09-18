import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_SESSION_PATH = 'data/sessions/roles/r_mpu8m4nk_99tl0ak/session-1781896103284049500-2738/data.json'
const ASYNC_TOOL_RESULT = 'async_tool_result'
const DEFAULT_BRANCH_ID = 'main'

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function text(value) {
  return String(value || '').trim()
}

function normalizeMessageType(value) {
  const type = text(value)
  return ['assistant', 'tool', 'tool_request', 'tool_confirmation', 'failure', 'system_control', ASYNC_TOOL_RESULT].includes(type) ? type : 'user'
}

function normalizeMessage(message, activeBranchId) {
  const type = normalizeMessageType(message?.type || message?.role)
  return {
    ...message,
    id: text(message?.id),
    type,
    role: type === ASYNC_TOOL_RESULT || type === 'assistant' ? 'assistant' : type === 'system_control' ? 'system' : 'user',
    parentMid: text(message?.parentMid || message?.parentMessageId),
    branchId: text(message?.branchId) || activeBranchId || DEFAULT_BRANCH_ID,
    content: String(message?.content || ''),
  }
}

function projectedMessageType(message) {
  const type = text(message?.type || message?.role)
  return ['assistant', 'tool', 'tool_request', 'tool_confirmation', 'failure', 'system_control', ASYNC_TOOL_RESULT].includes(type) ? type : 'user'
}

function projectedMessageRole(message) {
  const type = projectedMessageType(message)
  if (type === 'system_control') return 'system'
  if (['assistant', 'tool', 'tool_request', 'tool_confirmation', ASYNC_TOOL_RESULT].includes(type)) return 'assistant'
  return 'user'
}

function projectBackendSessionToClientChat(raw) {
  const messages = (Array.isArray(raw.messages) ? raw.messages : []).map((message) => ({
    id: text(message?.id),
    type: projectedMessageType(message),
    role: projectedMessageRole(message),
    content: String(message?.content || ''),
    parentMid: text(message?.parentMessageId),
    branchId: text(message?.branchId) || DEFAULT_BRANCH_ID,
  })).filter((message) => !!message.id)
  return messages.map((message) => normalizeMessage(message, DEFAULT_BRANCH_ID))
}

function hasExplicitMessageParentLinks(messages) {
  return messages.some((message) => !!text(message?.parentMid || message?.parentMessageId))
}

function rebuildLinearParents(messages, branchId) {
  let prev = ''
  for (const message of messages) {
    message.branchId = branchId
    message.parentMid = prev
    prev = text(message.id)
  }
  return prev
}

function fillMissingBranchIdsOnly(messages, branchId) {
  for (const message of messages) {
    if (!text(message.branchId)) message.branchId = branchId
  }
}

function normalizedHead(messages, storedBranching) {
  const fallbackHeadMid = text(messages[messages.length - 1]?.id)
  const hasTree = hasExplicitMessageParentLinks(messages)
  const hasStoredBranching = Number(storedBranching?.schemaVersion || 0) > 0
  const activeBranchId = text(storedBranching?.activeBranchId) || DEFAULT_BRANCH_ID
  const branchHead = text((Array.isArray(storedBranching?.branches) ? storedBranching.branches : []).find((branch) => text(branch?.id) === activeBranchId)?.headMid)

  if (!hasTree && !hasStoredBranching) {
    return rebuildLinearParents(messages, activeBranchId)
  }

  fillMissingBranchIdsOnly(messages, activeBranchId)
  const ids = new Set(messages.map((message) => text(message.id)).filter(Boolean))
  if (hasStoredBranching && branchHead && ids.has(branchHead)) return branchHead

  const parentIds = new Set(messages.map((message) => text(message.parentMid)).filter(Boolean))
  for (let index = messages.length - 1; index >= 0; index--) {
    const id = text(messages[index]?.id)
    if (id && !parentIds.has(id)) return id
  }
  return fallbackHeadMid
}

function visiblePath(messages, headMid) {
  const byId = new Map(messages.map((message) => [text(message.id), message]).filter(([id]) => !!id))
  const out = []
  const seen = new Set()
  let current = text(headMid)
  while (current && !seen.has(current)) {
    seen.add(current)
    const message = byId.get(current)
    if (!message) break
    out.push(message)
    current = text(message.parentMid)
  }
  return out.reverse()
}

function diagnose(filePath) {
  const raw = readJson(filePath)
  const rawMessages = Array.isArray(raw.messages) ? raw.messages : []
  const messages = rawMessages.map((message) => normalizeMessage(message, DEFAULT_BRANCH_ID)).filter((message) => !!message.id)
  const headMid = normalizedHead(messages, raw.branching)
  const path = visiblePath(messages, headMid)
  const asyncMessages = messages.filter((message) => message.type === ASYNC_TOOL_RESULT)
  const asyncInPath = path.filter((message) => message.type === ASYNC_TOOL_RESULT)
  const completedTasks = (Array.isArray(raw.asyncToolTasks) ? raw.asyncToolTasks : []).filter((task) => text(task.status) === 'completed')
  const projectedMessages = projectBackendSessionToClientChat(raw)
  const projectedAsyncMessages = projectedMessages.filter((message) => message.type === ASYNC_TOOL_RESULT)
  const asyncIds = new Set(asyncMessages.map((message) => message.id))
  const projectedById = new Map(projectedMessages.map((message) => [message.id, message]))
  const identityLost = asyncMessages
    .map((message) => {
      const projected = projectedById.get(message.id)
      if (!projected || projected.type === ASYNC_TOOL_RESULT) return null
      return { id: message.id, storedType: message.type, projectedType: projected.type, projectedRole: projected.role }
    })
    .filter(Boolean)
  const projectedHeadMid = normalizedHead(projectedMessages, raw.branching)
  const projectedPath = visiblePath(projectedMessages, projectedHeadMid)
  const projectedLostInPath = projectedPath.filter((message) => asyncIds.has(message.id) && message.type !== ASYNC_TOOL_RESULT)

  return {
    filePath,
    sessionId: text(raw.id),
    status: text(raw.status),
    hasStoredBranching: Number(raw.branching?.schemaVersion || 0) > 0,
    messageCount: messages.length,
    headMid,
    visiblePathIds: path.map((message) => message.id),
    asyncResultCount: asyncMessages.length,
    asyncResultIds: asyncMessages.map((message) => message.id),
    asyncResultInVisiblePathCount: asyncInPath.length,
    asyncResultInVisiblePathIds: asyncInPath.map((message) => message.id),
    completedAsyncTaskCount: completedTasks.length,
    projectedAsyncResultCount: projectedAsyncMessages.length,
    projectedIdentityLost: identityLost,
    projectedVisiblePathIds: projectedPath.map((message) => message.id),
    projectedLostInVisiblePathIds: projectedLostInPath.map((message) => message.id),
    verdict:
      identityLost.length > 0
        ? 'projection-drops-async-tool-result-type'
        : asyncMessages.length > 0 && asyncInPath.length === asyncMessages.length
          ? 'backend-session-ok'
          : 'backend-session-needs-attention',
  }
}

const input = process.argv[2] || DEFAULT_SESSION_PATH
const result = diagnose(resolve(process.cwd(), input))
console.log(JSON.stringify(result, null, 2))
