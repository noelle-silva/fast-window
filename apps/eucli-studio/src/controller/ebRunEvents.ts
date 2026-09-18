import { normalizeTimeMs } from '../core/utils'
import { ensureChatBranch, normalizeBranchId } from '../domain/branching'
import { beginAssistantRun, checkpointAssistantRun, finishAssistantRun, hasSettledAssistantToolParts, type AssistantRunStatus } from '../domain/assistantRunState'
import { chatMetaFromChat, upsertChatMeta } from '../domain/chatMeta'
import { CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT, normalizeChatMessage, normalizeMessageParentMid } from '../domain/message'
import { CHAT_DEFAULT_BRANCH_ID } from '../domain/constants'
import { activeEbRunCardsForTarget, isTerminalEbRunStatus, removeEbRoleRunCard, upsertEbRoleRunCard } from '../domain/activeRunCards'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'

type DirectEventSubscription = (listener: (event: any) => void) => () => void
type RunEventTargetKind = 'role' | 'group' | 'workspace'

export function createEbRunEventConsumer(deps: {
  getState: () => any
  emit: () => void
  subscribeDirectEvents?: DirectEventSubscription
  onRuntimeChatChanged?: (targetKind: RunEventTargetKind, targetId: string, chat: any, options?: { urgent?: boolean }) => Promise<void> | void
}) {
  let unsubscribe: (() => void) | null = null
  let renderRaf = 0
  const pendingBySession = new Map<string, Map<string, any>>()
  const changedTimers = new Map<string, number>()

  function scheduleRender() {
    if (renderRaf) return
    renderRaf = window.requestAnimationFrame(() => {
      renderRaf = 0
      deps.emit()
    })
  }

  function sessionKey(targetKind: RunEventTargetKind, targetId: string, sessionId: string) {
    return `${targetKind}\n${targetId}\n${sessionId}`
  }

  function scheduleRuntimeChatChanged(targetKind: RunEventTargetKind, targetId: string, chat: any, urgent = false) {
    if (typeof deps.onRuntimeChatChanged !== 'function') return
    const chatId = String(chat?.id || '').trim()
    if (!targetId || !chatId || !chat || typeof chat !== 'object') return
    if ((chat as any).runtimePartial) return
    const key = sessionKey(targetKind, targetId, chatId)
    const previous = changedTimers.get(key)
    if (previous) window.clearTimeout(previous)
    changedTimers.delete(key)
    const run = () => {
      changedTimers.delete(key)
      Promise.resolve(deps.onRuntimeChatChanged?.(targetKind, targetId, chat, { urgent })).catch(() => {})
    }
    if (urgent) {
      run()
      return
    }
    const timer = window.setTimeout(run, 650)
    changedTimers.set(key, timer)
  }

  function runEventTarget(roleId: string, groupId: string, workspaceId: string) {
    if (workspaceId) return { targetKind: 'workspace' as const, targetId: workspaceRoleTargetId(workspaceId, roleId) || workspaceId }
    if (groupId) return { targetKind: 'group' as const, targetId: groupId }
    return { targetKind: 'role' as const, targetId: roleId }
  }

  function bufferAssistantMessageUpdate(payload: any, targetKind: RunEventTargetKind, targetId: string, sessionId: string, messageId: string) {
    const key = sessionKey(targetKind, targetId, sessionId)
    const messages = pendingBySession.get(key) || new Map<string, any>()
    messages.set(messageId, payload)
    pendingBySession.set(key, messages)
  }

  function clearBufferedAssistantMessageUpdate(targetKind: RunEventTargetKind, targetId: string, sessionId: string, messageId: string) {
    const key = sessionKey(targetKind, targetId, sessionId)
    const messages = pendingBySession.get(key)
    if (!messages) return
    messages.delete(messageId)
    if (!messages.size) pendingBySession.delete(key)
  }

  function ensureTargetChatBox(state: any, targetKind: RunEventTargetKind, targetId: string) {
    if (!state?.data || !targetId) return null
    if (targetKind === 'group') {
      if (!state.data.chatsByGroup || typeof state.data.chatsByGroup !== 'object') state.data.chatsByGroup = {}
      if (!state.data.chatsByGroup[targetId] || typeof state.data.chatsByGroup[targetId] !== 'object') state.data.chatsByGroup[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
      const box = state.data.chatsByGroup[targetId]
      if (!Array.isArray(box.chats)) box.chats = []
      if (!Array.isArray(box.chatMetas)) box.chatMetas = []
      return box
    }
    if (targetKind === 'workspace') {
      if (!state.data.chatsByWorkspace || typeof state.data.chatsByWorkspace !== 'object') state.data.chatsByWorkspace = {}
      if (!state.data.chatsByWorkspace[targetId] || typeof state.data.chatsByWorkspace[targetId] !== 'object') state.data.chatsByWorkspace[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
      const box = state.data.chatsByWorkspace[targetId]
      if (!Array.isArray(box.chats)) box.chats = []
      if (!Array.isArray(box.chatMetas)) box.chatMetas = []
      return box
    }
    if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
    if (!state.data.chatsByRole[targetId] || typeof state.data.chatsByRole[targetId] !== 'object') state.data.chatsByRole[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
    const box = state.data.chatsByRole[targetId]
    if (!Array.isArray(box.chats)) box.chats = []
    if (!Array.isArray(box.chatMetas)) box.chatMetas = []
    return box
  }

  function ensureRuntimeTargetChat(state: any, targetKind: RunEventTargetKind, targetId: string, sessionId: string, eventTime: number) {
    const box = ensureTargetChatBox(state, targetKind, targetId)
    if (!box || !sessionId) return null
    const chat = box.chats.find((item: any) => String(item?.id || '').trim() === sessionId) || null
    if (chat) return chat

    const meta = box.chatMetas.find((item: any) => String(item?.id || '').trim() === sessionId) || null
    const t = Number(eventTime || 0) || Date.now()
    const runtimeChat = {
      id: sessionId,
      title: String(meta?.title || '').trim() || (targetKind === 'group' ? '群聊' : '新聊天'),
      messages: [],
      createdAt: Number(meta?.createdAt || 0) || t,
      updatedAt: Math.max(Number(meta?.updatedAt || 0), t),
      runtimePartial: true,
    }
    box.chats.unshift(runtimeChat)
    return runtimeChat
  }

function normalizeRuntimeVisibleMessage(raw: any, fallback: { parentMessageId?: string; branchId?: string; eventTime: number }) {
  const message = raw && typeof raw === 'object' ? raw : null
  if (!message) return null
  const id = String(message.id || '').trim()
  const type = String(message.type || message.role || '').trim()
  if (!id || (type !== 'assistant' && type !== CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT)) return null

  const out = normalizeChatMessage(message, { activeBranchId: fallback.branchId || CHAT_DEFAULT_BRANCH_ID, toolMessagesAsAssistant: true })
  out.id = id
  out.type = type
  out.role = 'assistant'
  out.parentMid = normalizeMessageParentMid(message) || String(fallback.parentMessageId || '').trim()
  out.branchId = String(message.branchId || '').trim() ? normalizeBranchId(message.branchId) : ''
  out.createdAt = normalizeTimeMs(message.createdAt, fallback.eventTime)
  out.updatedAt = normalizeTimeMs(message.updatedAt, out.createdAt)
  return out
}

// collectPartLiveOutputs 摘取消息中 tool part 的实时输出，用于在消息刷新时保留。
function collectPartLiveOutputs(message: any): Map<string, any> {
  const output = new Map<string, any>()
  if (!message || !Array.isArray(message.parts)) return output
  for (const part of message.parts) {
    if (part?.runtimeOutput) output.set(String(part.callId || '').trim(), part.runtimeOutput)
  }
  return output
}

// restorePartLiveOutputs 将实时输出回填到刷新后的 tool part。
function restorePartLiveOutputs(message: any, liveOutputs: Map<string, any>) {
  if (!message || !Array.isArray(message.parts) || liveOutputs.size === 0) return
  for (const part of message.parts) {
    const live = liveOutputs.get(String(part?.callId || '').trim())
    if (live) part.runtimeOutput = live
  }
}

  function assistantStatusFromRunStatus(value: unknown): AssistantRunStatus | null {
    const status = String(value || '').trim()
    if (status === 'completed') return 'succeeded'
    if (status === 'failed') return 'failed'
    if (status === 'cancelled' || status === 'canceled') return 'canceled'
    return null
  }

  function applyRunStateEvent(raw: unknown, fallbackRunIdRaw?: unknown) {
    const payload = raw && typeof raw === 'object' ? (raw as any) : null
    const runId = String(payload?.id || payload?.runId || fallbackRunIdRaw || '').trim()
    if (!runId) return false
    const state = deps.getState()
    if (!state?.data) return false
    const status = String(payload?.status || '').trim()
    if (isTerminalEbRunStatus(status)) {
      const removed = removeEbRoleRunCard(state, runId)
      if (!removed) return false
      scheduleRender()
      return true
    }
    const roleId = String(payload?.roleId || '').trim()
    const sessionId = String(payload?.sessionId || '').trim()
    if (!roleId || !sessionId) return false
    const groupId = String(payload?.groupId || '').trim()
    const workspaceId = String(payload?.workspaceId || '').trim()
    const patch: any = {
      runId,
      roleId,
      groupId,
      workspaceId,
      sessionId,
      inputMessageId: String(payload?.inputMessageId || '').trim(),
      lastMessageId: String(payload?.lastMessageId || payload?.inputMessageId || '').trim(),
      anchorMessageId: String(payload?.inputMessageId || '').trim(),
      dependencyMessageIds: Array.isArray(payload?.dependencyMessageIds) ? payload.dependencyMessageIds : [],
      status: status || 'running',
      stream: !!payload?.stream,
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'retry')) patch.retry = payload.retry
    upsertEbRoleRunCard(state, patch)
    scheduleRender()
    return true
  }

  function applyAssistantMessageUpdate(raw: unknown) {
    const payload = raw && typeof raw === 'object' ? (raw as any) : null
    const state = deps.getState()
    if (!payload || !state.data) return false

    const runId = String(payload.runId || '').trim()
    const roleId = String(payload.roleId || '').trim()
    const groupId = String(payload.groupId || '').trim()
    const workspaceId = String(payload.workspaceId || '').trim()
    const sessionId = String(payload.sessionId || '').trim()
    const eventTime = normalizeTimeMs(payload.createdAt)
    const incomingMessage = normalizeRuntimeVisibleMessage(payload.message, { eventTime })
    const messageId = String(incomingMessage?.id || '').trim()
    if (!runId || !roleId || !sessionId || !messageId) return false
    const { targetKind, targetId } = runEventTarget(roleId, groupId, workspaceId)

    const box = ensureTargetChatBox(state, targetKind, targetId)
    const chat = ensureRuntimeTargetChat(state, targetKind, targetId, sessionId, eventTime)
    if (!chat) {
      bufferAssistantMessageUpdate(payload, targetKind, targetId, sessionId, messageId)
      return false
    }
    clearBufferedAssistantMessageUpdate(targetKind, targetId, sessionId, messageId)
    if (!Array.isArray(chat.messages)) chat.messages = []

    const parentMid = String(incomingMessage.parentMid || '').trim()
    const parent = parentMid ? chat.messages.find((item: any) => String(item?.id || '').trim() === parentMid) || null : null
    const branchId = normalizeBranchId(incomingMessage.branchId || parent?.branchId || CHAT_DEFAULT_BRANCH_ID)

    let message = chat.messages.find((item: any) => String(item?.id || '').trim() === messageId) || null
    if (!message) {
      message = incomingMessage
      chat.messages.push(message)
    } else {
      const liveOutputs = collectPartLiveOutputs(message)
      Object.assign(message, incomingMessage)
      restorePartLiveOutputs(message, liveOutputs)
    }

    const messageType = String(incomingMessage.type || '').trim() === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT ? CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT : 'assistant'
    message.role = 'assistant'
    message.type = messageType
    if (parentMid) message.parentMid = parentMid
    message.branchId = branchId
    message.updatedAt = Math.max(Number(message.updatedAt || 0), eventTime)
    if (messageType === 'assistant') {
      const terminalStatus = assistantStatusFromRunStatus(payload.status)
      if (terminalStatus) {
        finishAssistantRun(message, message.content, terminalStatus, message.updatedAt)
      } else if (hasSettledAssistantToolParts(message)) {
        finishAssistantRun(message, message.content, 'succeeded', message.updatedAt)
      } else {
        beginAssistantRun(message, { generationId: runId, stream: !!payload.stream, resetContent: false, startedAt: Number(message.createdAt || eventTime) || eventTime })
        checkpointAssistantRun(message, message.content, message.updatedAt)
      }
    }

    if (isTerminalEbRunStatus(payload.status)) {
      removeEbRoleRunCard(state, runId)
    } else {
      const patch: any = {
        runId,
        roleId,
        groupId,
        workspaceId,
        sessionId,
        inputMessageId: parentMid,
        lastMessageId: messageId,
        anchorMessageId: parentMid,
        dependencyMessageIds: Array.isArray(payload?.dependencyMessageIds) ? payload.dependencyMessageIds : [],
        status: String(payload.status || 'running').trim() || 'running',
        stream: !!payload.stream,
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'retry')) patch.retry = payload.retry
      upsertEbRoleRunCard(state, patch)
    }
    chat.updatedAt = Math.max(Number(chat.updatedAt || 0), eventTime)
    const branch = ensureChatBranch(chat, branchId)
    if (branch) {
      branch.headMid = messageId
      branch.updatedAt = chat.updatedAt
      if (!String(branch.forkFromMid || '').trim() && parentMid) branch.forkFromMid = parentMid
    }

    const runStatus = String(payload.status || '').trim()
    const activeCards = activeEbRunCardsForTarget(state, targetKind, targetId, sessionId)
    const chatStatus = activeCards.length ? String(activeCards[activeCards.length - 1]?.status || 'running').trim() || 'running' : runStatus
    if (chatStatus) chat.status = chatStatus

    const fallbackTitle = targetKind === 'group' ? '群聊' : targetKind === 'workspace' ? '工作区会话' : '新聊天'
    if (box) box.chatMetas = upsertChatMeta(box.chatMetas, chatMetaFromChat(chat, fallbackTitle), fallbackTitle)

    scheduleRuntimeChatChanged(targetKind, targetId, chat, messageType === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT)
    scheduleRender()
    return true
  }

  function applyAsyncToolTaskUpdate(raw: unknown) {
    const task = raw && typeof raw === 'object' ? (raw as any) : null
    if (!task) return false
    const state = deps.getState()
    if (!state?.data) return false
    const roleId = String(task.roleId || '').trim()
    const groupId = String(task.groupId || '').trim()
    const workspaceId = String(task.workspaceId || '').trim()
    const sessionId = String(task.sessionId || '').trim()
    const taskId = String(task.id || '').trim()
    if (!sessionId || !taskId) return false
    const { targetKind, targetId } = runEventTarget(roleId, groupId, workspaceId)
    const chat = ensureRuntimeTargetChat(state, targetKind, targetId, sessionId, normalizeTimeMs(task.finishedAt || task.startedAt || task.submittedAt))
    if (!chat) return false
    const tasks = Array.isArray((chat as any).asyncToolTasks) ? (chat as any).asyncToolTasks : []
    const index = tasks.findIndex((item: any) => String(item?.id || '').trim() === taskId)
    if (index >= 0) tasks[index] = task
    else tasks.push(task)
    ;(chat as any).asyncToolTasks = tasks
    scheduleRuntimeChatChanged(targetKind, targetId, chat, true)
    scheduleRender()
    return true
  }

  function applyToolOutputUpdate(raw: unknown) {
    const update = raw && typeof raw === 'object' ? (raw as any) : null
    if (!update) return false
    const state = deps.getState()
    if (!state?.data) return false
    const roleId = String(update.roleId || '').trim()
    const groupId = String(update.groupId || '').trim()
    const workspaceId = String(update.workspaceId || '').trim()
    const sessionId = String(update.sessionId || '').trim()
    const messageId = String(update.messageId || '').trim()
    const callId = String(update.callId || '').trim()
    if (!sessionId || !callId) return false
    const { targetKind, targetId } = runEventTarget(roleId, groupId, workspaceId)
    const chat = ensureRuntimeTargetChat(state, targetKind, targetId, sessionId, normalizeTimeMs(update.createdAt))
    if (!chat) return false
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    const messageIndex = messages.findIndex((item: any) => String(item?.id || '').trim() === messageId)
    if (messageIndex < 0) return false
    const message = messages[messageIndex]
    if (!Array.isArray(message.parts)) return false
    const partIndex = message.parts.findIndex((part: any) => String(part?.callId || '').trim() === callId)
    if (partIndex < 0) return false
    const nextParts = message.parts.slice()
    const part = nextParts[partIndex]
    nextParts[partIndex] = {
      ...part,
      runtimeOutput: {
        bytes: Math.max(0, Number(update.bytes || 0)),
        preview: String(update.preview || '').trim(),
        updatedAt: normalizeTimeMs(update.createdAt),
      },
    }
    chat.messages[messageIndex] = { ...message, parts: nextParts, updatedAt: Math.max(Number(message.updatedAt || 0), normalizeTimeMs(update.createdAt)) }
    chat.updatedAt = Math.max(Number(chat.updatedAt || 0), normalizeTimeMs(update.createdAt))
    scheduleRender()
    return true
  }

  function flushSession(targetKindOrRoleIdRaw: unknown, targetIdOrSessionIdRaw: unknown, sessionIdRaw?: unknown) {
    const hasKind = typeof sessionIdRaw !== 'undefined'
    const kindText = String(targetKindOrRoleIdRaw || '').trim()
    const targetKind: RunEventTargetKind = !hasKind ? 'role' : kindText === 'group' ? 'group' : kindText === 'workspace' ? 'workspace' : 'role'
    const targetId = String(hasKind ? targetIdOrSessionIdRaw : targetKindOrRoleIdRaw || '').trim()
    const sessionId = String(hasKind ? sessionIdRaw : targetIdOrSessionIdRaw || '').trim()
    if (!targetId || !sessionId) return false
    const key = sessionKey(targetKind, targetId, sessionId)
    const pending = pendingBySession.get(key)
    if (!pending || !pending.size) return false
    const items = Array.from(pending.values())
    pendingBySession.delete(key)
    let changed = false
    for (const payload of items) {
      changed = applyAssistantMessageUpdate(payload) || changed
    }
    return changed
  }

  function applyRunEvent(raw: unknown) {
    const event = raw && typeof raw === 'object' ? (raw as any) : null
    if (!event) return false
    const type = String(event.type || '').trim()
    if (type === 'assistant_message_update' || type === 'run_message_update') return applyAssistantMessageUpdate(event.payload)
    if (type === 'async_tool_task_update') return applyAsyncToolTaskUpdate(event.payload)
    if (type === 'tool_output_update') return applyToolOutputUpdate(event.payload)
    if (type === 'run_started' || type === 'run_retrying' || type === 'run_completed' || type === 'run_cancelled' || type === 'run_failed') return applyRunStateEvent(event.payload, event.runId)
    return false
  }

  function start() {
    if (unsubscribe) return
    if (typeof deps.subscribeDirectEvents !== 'function') return
    unsubscribe = deps.subscribeDirectEvents((event: any) => {
      if (String(event?.name || '').trim() !== 'eucliBox.run.event') return
      applyRunEvent(event?.payload)
    })
  }

  function stop() {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    pendingBySession.clear()
    if (renderRaf) {
      window.cancelAnimationFrame(renderRaf)
      renderRaf = 0
    }
    for (const timer of changedTimers.values()) window.clearTimeout(timer)
    changedTimers.clear()
  }

  return { start, stop, applyRunEvent, flushSession }
}
