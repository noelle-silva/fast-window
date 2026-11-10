import { normalizeTimeMs } from '../core/utils'
import { ensureChatBranch, normalizeBranchId, setChatBranchHeadMid } from '../domain/branching'
import { beginAssistantRun, checkpointAssistantRun, finishAssistantRun, hasSettledAssistantToolParts } from '../domain/assistantRunState'
import { chatMetaFromChat, chatMetaShapeKey } from '../domain/chatMeta'
import { writeChatListProjection } from '../domain/chatListProjection'
import { appendChatMessage, ensureChatMessages } from '../domain/chatMessageCollection'
import { writeChatMessageFields, type ChatMessageFields } from '../domain/chatMessageFields'
import { markRuntimeMessageInFlight } from '../domain/runtimeMessageMarker'
import { CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT, normalizeChatMessage, normalizeMessageParentMid, normalizeMessageParts } from '../domain/message'
import { CHAT_DEFAULT_BRANCH_ID } from '../domain/constants'
import { findEbRoleRunCard, isRunSettled, isTerminalEbRunStatus, registerEbRoleRunCard, updateEbRoleRunCard } from '../domain/activeRunCards'
import { writeChatRunStatus } from '../domain/chatSessionRunStatus'
import { assistantRunStatusFromRunStatus, settleRunInState } from '../domain/runTerminal'
import { isLifecycleRunEventType, readRunEventEnvelope, readRunLifecycleSnapshot } from '../protocol/runEventContract'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import { messageRefreshScope, refreshScopes } from '../domain/uiRefreshScope'

type DirectEventSubscription = (listener: (event: any) => void) => () => void
type RunEventTargetKind = 'role' | 'group' | 'workspace'

export function createEbRunEventConsumer(deps: {
  getState: () => any
  emitScope: (scope: string) => void
  subscribeDirectEvents?: DirectEventSubscription
  onRuntimeChatChanged?: (targetKind: RunEventTargetKind, targetId: string, chat: any, options?: { urgent?: boolean }) => Promise<void> | void
}) {
  let unsubscribe: (() => void) | null = null
  let scopeRaf = 0
  const pendingScopes = new Set<string>()
  const pendingBySession = new Map<string, Map<string, any>>()
  const changedTimers = new Map<string, number>()

  // 范围刷新同样按帧合并：一帧内的多次流式增量只通知一次，且只惊动对应范围。
  function scheduleScope(scope: string) {
    pendingScopes.add(scope)
    if (scopeRaf) return
    scopeRaf = window.requestAnimationFrame(() => {
      scopeRaf = 0
      const scopes = Array.from(pendingScopes)
      pendingScopes.clear()
      for (const item of scopes) deps.emitScope(item)
    })
  }

  // 新消息挂载 / 终态 / 异步工具返回都只改变这一格会话，按 session 地址通知。
  function scheduleSession(targetKind: RunEventTargetKind, targetId: string, sessionId: string) {
    const tid = String(targetId || '').trim()
    const sid = String(sessionId || '').trim()
    if (!tid || !sid) return
    scheduleScope(refreshScopes.session(targetKind, tid, sid))
  }

  // 列表事实（chatMetas）只惊动该 target 的列表订阅者。
  // targetId 缺失时构造器会退化成 global，必须在这里拦住，不能把列表更新放大成全局广播。
  // 只允许 publishChatListFacts 调用：任何一条路径自己补发列表通知，都会让
  // 「结构事件才广播」这条唯一规则失效。
  function scheduleChatListChanged(targetKind: RunEventTargetKind, targetId: string) {
    const id = String(targetId || '').trim()
    if (!id) return
    scheduleScope(refreshScopes.chatList(targetKind, id))
  }

  // 列表事实的唯一发布口。
  //
  // 调用方判断「这是不是结构事件」，这里判断「列表结构真的变了没有」：
  // 写投影是内存动作（合并与排序仍由 chatListProjection 裁决），广播才是渲染成本。
  // 流式正文推进不经过这里，所以侧边栏与 App 根不会跟着每一帧重算重渲染。
  function publishChatListFacts(box: any, chat: any, targetKind: RunEventTargetKind, targetId: string, fallbackTitle: string) {
    if (!box || !chat) return
    const chatId = String(chat.id || '').trim()
    if (!chatId) return
    const fallback = String(fallbackTitle || '').trim() || '新聊天'
    const metaOf = () => (Array.isArray(box.chatMetas) ? box.chatMetas : [])
      .find((item: any) => String(item?.id || '').trim() === chatId) || null
    const beforeMeta = metaOf()
    const meta = chatMetaFromChat(chat, fallback)
    if (!meta) return
    writeChatListProjection(box, { kind: 'upsertMeta', meta, fallbackTitle: fallback })
    // 以「落库后的这条事实」为准：合并规则可能拒绝本次写入（窗口切片不得覆盖索引事实），
    // 被拒绝时列表事实没变，广播只会白白重渲染一次侧边栏。
    if (chatMetaShapeKey(metaOf()) === chatMetaShapeKey(beforeMeta)) return
    scheduleChatListChanged(targetKind, targetId)
  }

  function scheduleRunCardsChanged() {
    scheduleScope(refreshScopes.runCards())
  }

  // 运行卡写入的唯一出口：执行一次写入，并按「卡片对象身份是否变化」决定是否广播。
  //
  // 领域层保证「结构不变时返回同一张卡」，因此对象身份就是唯一的结构版本：
  // 这里不再维护第二套字段比较，也不会为纯心跳写入惊动整棵 UI。
  // 写入内容以闭包给出，register（出生）与 update（更新）共用同一套判据。
  function writeRunCards(state: any, runIdRaw: unknown, write: () => void): void {
    const runId = String(runIdRaw || '').trim()
    const before = runId ? findEbRoleRunCard(state, runId) : null
    write()
    const after = runId ? findEbRoleRunCard(state, runId) : null
    if (after !== before) scheduleRunCardsChanged()
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

  // 缓冲项同时保存信封 runId 与载荷：flush 时必须还原同一份身份，
  // 不允许从载荷里重新猜运行身份。
  function bufferAssistantMessageUpdate(runId: string, payload: any, targetKind: RunEventTargetKind, targetId: string, sessionId: string, messageId: string) {
    const key = sessionKey(targetKind, targetId, sessionId)
    const messages = pendingBySession.get(key) || new Map<string, any>()
    messages.set(messageId, { runId, payload })
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
    const rootKey = targetKind === 'group' ? 'chatsByGroup' : targetKind === 'workspace' ? 'chatsByWorkspace' : 'chatsByRole'
    if (!state.data[rootKey] || typeof state.data[rootKey] !== 'object') state.data[rootKey] = {}
    if (!state.data[rootKey][targetId] || typeof state.data[rootKey][targetId] !== 'object') {
      state.data[rootKey][targetId] = { activeChatId: '', chatMetas: [], chats: [] }
    }
    const box = state.data[rootKey][targetId]
    writeChatListProjection(box, { kind: 'ensure' })
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
    return writeChatListProjection(box, { kind: 'upsert', chat: runtimeChat, updateMeta: false })?.chat || null
  }

function normalizeRuntimeVisibleMessage(raw: any, fallback: { parentMessageId?: string; branchId?: string; eventTime: number }) {
  const message = raw && typeof raw === 'object' ? raw : null
  if (!message) return null
  const id = String(message.id || '').trim()
  const type = String(message.type || message.role || '').trim()
  if (!id || (type !== 'assistant' && type !== CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT)) return null

  const out = normalizeChatMessage(message, { activeBranchId: fallback.branchId || CHAT_DEFAULT_BRANCH_ID, toolMessagesAsAssistant: true })
  writeChatMessageFields(out, {
    id,
    type,
    role: 'assistant',
    parentMid: normalizeMessageParentMid(message) || String(fallback.parentMessageId || '').trim(),
    branchId: String(message.branchId || '').trim() ? normalizeBranchId(message.branchId) : '',
    createdAt: normalizeTimeMs(message.createdAt, fallback.eventTime),
    updatedAt: normalizeTimeMs(message.updatedAt, out.createdAt),
  })
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

// restorePartLiveOutputs 返回「实时输出已经回填」的 parts 新数组。
// 纯计算：不改入参，最终由 chatMessageFields 的统一入口落地。
function restorePartLiveOutputs(partsRaw: unknown, liveOutputs: Map<string, any>): any[] {
  const parts = Array.isArray(partsRaw) ? partsRaw : []
  if (!liveOutputs.size) return parts
  return parts.map((part: any) => {
    const live = liveOutputs.get(String(part?.callId || '').trim())
    return live ? { ...part, runtimeOutput: live } : part
  })
}

  // applyRunStateEvent 只接受「生命周期事件」的载荷，且运行身份只来自信封。
  // 载荷必须自证是本次运行的状态快照（payload.id === runId），否则一律拒绝：
  // 消息 id / 工具计划 id 永远不可能再被写成运行身份。
  function applyRunStateEvent(runIdRaw: unknown, raw: unknown) {
    const runId = String(runIdRaw || '').trim()
    if (!runId) return false
    const state = deps.getState()
    if (!state?.data) return false
    const snapshot = readRunLifecycleSnapshot(runId, raw)
    if (!snapshot) return false
    const status = snapshot.status
    if (isTerminalEbRunStatus(status)) {
      // 终态是权威收口：无论卡片此前是否已被移除，都要收敛一次界面。
      // settleRunInState 同时登记终态闩锁，之后的迟到补丁不会再复活它。
      const card = findEbRoleRunCard(state, runId)
      writeRunCards(state, runId, () => {
        settleRunInState(state, {
          runId,
          status,
          roleId: snapshot.roleId,
          groupId: snapshot.groupId,
          workspaceId: snapshot.workspaceId,
          sessionId: snapshot.sessionId,
          messageIds: [snapshot.lastMessageId, snapshot.inputMessageId],
        }, card)
      })
      const target = runEventTarget(snapshot.roleId, snapshot.groupId, snapshot.workspaceId)
      scheduleSession(target.targetKind, target.targetId, snapshot.sessionId)
      return true
    }
    // 终态之后迟到的运行中状态一律丢弃：否则停止按钮与占位会被重新点亮。
    if (isRunSettled(state, runId)) return false
    const { roleId, sessionId } = snapshot
    if (!roleId || !sessionId) return false
    writeRunCards(state, runId, () => {
      registerEbRoleRunCard(state, {
        runId,
        roleId,
        groupId: snapshot.groupId,
        workspaceId: snapshot.workspaceId,
        sessionId,
        inputMessageId: snapshot.inputMessageId,
        lastMessageId: snapshot.lastMessageId || snapshot.inputMessageId,
        anchorMessageId: snapshot.inputMessageId,
        dependencyMessageIds: snapshot.dependencyMessageIds,
        status: status || 'running',
        stream: snapshot.stream,
        retry: snapshot.retry,
      })
    })
    const target = runEventTarget(snapshot.roleId, snapshot.groupId, snapshot.workspaceId)
    scheduleSession(target.targetKind, target.targetId, snapshot.sessionId)
    return true
  }

  // 内容事件只作用于已存在的运行：卡不存在就丢弃，绝不凭内容建卡。
  function applyAssistantMessageUpdate(runIdRaw: unknown, raw: unknown) {
    const payload = raw && typeof raw === 'object' ? (raw as any) : null
    const state = deps.getState()
    if (!payload || !state.data) return false

    const runId = String(runIdRaw || '').trim()
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
      bufferAssistantMessageUpdate(runId, payload, targetKind, targetId, sessionId, messageId)
      return false
    }
    clearBufferedAssistantMessageUpdate(targetKind, targetId, sessionId, messageId)
    ensureChatMessages(chat)

    const parentMid = String(incomingMessage.parentMid || '').trim()
    const parent = parentMid ? chat.messages.find((item: any) => String(item?.id || '').trim() === parentMid) || null : null
    const branchId = normalizeBranchId(incomingMessage.branchId || parent?.branchId || CHAT_DEFAULT_BRANCH_ID)

    let message = chat.messages.find((item: any) => String(item?.id || '').trim() === messageId) || null
    const isNewMessage = !message
    if (!message) {
      message = incomingMessage
      // 运行期独占标记：消息已进入前台生成，后台快照尚未确认。
      markRuntimeMessageInFlight(message)
      appendChatMessage(chat, message)
    } else {
      const liveOutputs = collectPartLiveOutputs(message)
      const nextFields: ChatMessageFields = { ...incomingMessage }
      nextFields.parts = restorePartLiveOutputs(incomingMessage.parts, liveOutputs)
      writeChatMessageFields(message, nextFields)
    }

    const messageType = String(incomingMessage.type || '').trim() === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT ? CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT : 'assistant'
    const structuralFields: ChatMessageFields = {
      role: 'assistant',
      type: messageType,
      branchId,
      updatedAt: Math.max(Number(message.updatedAt || 0), eventTime),
    }
    if (parentMid) structuralFields.parentMid = parentMid
    writeChatMessageFields(message, structuralFields)
    const terminalStatus = assistantRunStatusFromRunStatus(payload.status)
    if (messageType === 'assistant') {
      if (terminalStatus) {
        finishAssistantRun(message, message.content, terminalStatus, message.updatedAt)
      } else if (hasSettledAssistantToolParts(message)) {
        finishAssistantRun(message, message.content, 'succeeded', message.updatedAt)
      } else if (!isRunSettled(state, runId)) {
        beginAssistantRun(message, { generationId: runId, stream: !!payload.stream, resetContent: false, startedAt: Number(message.createdAt || eventTime) || eventTime })
        checkpointAssistantRun(message, message.content, message.updatedAt)
      }
    }

    if (terminalStatus) {
      // 消息级终态同样要收口 run 卡与同 run 的其它消息：
      // 这条 update 的 payload.status 就是权威终态，不允许只收敛当前这一条。
      writeRunCards(state, runId, () => {
        settleRunInState(state, {
          runId,
          status: String(payload.status || '').trim(),
          roleId,
          groupId,
          workspaceId,
          sessionId,
          messageIds: [messageId, parentMid],
        }, findEbRoleRunCard(state, runId))
      })
    } else if (!isRunSettled(state, runId)) {
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
      writeRunCards(state, runId, () => {
        updateEbRoleRunCard(state, patch)
      })
    }
    chat.updatedAt = Math.max(Number(chat.updatedAt || 0), eventTime)
    const branch = ensureChatBranch(chat, branchId)
    if (branch) {
      if (!String(branch.forkFromMid || '').trim() && parentMid) branch.forkFromMid = parentMid
      setChatBranchHeadMid(chat, branchId, messageId)
    }

    // 会话运行状态：终态路径已由 settleRunInState 统一收口，这里只处理运行中推进。
    // 状态怎么算、写到哪里，统一交给 chat.status 的唯一写入口。
    let runStatusChanged = false
    if (!terminalStatus) {
      runStatusChanged = writeChatRunStatus(state, chat, {
        fallbackStatus: payload.status,
        target: { targetKind, targetId },
      })
    }

    // 列表结构事实：新消息落地、终态、运行状态变化、异步工具返回。
    // 其余（正文/思考/工具片段的常规推进）只写内存，不写投影、不广播。
    const listStructureChanged =
      isNewMessage ||
      !!terminalStatus ||
      runStatusChanged ||
      messageType === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT
    if (listStructureChanged) {
      const fallbackTitle = targetKind === 'group' ? '群聊' : targetKind === 'workspace' ? '工作区会话' : '新聊天'
      publishChatListFacts(box, chat, targetKind, targetId, fallbackTitle)
    }

    scheduleRuntimeChatChanged(targetKind, targetId, chat, messageType === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT)

    // 范围分发：一次运行中，除了“新消息首次挂载”“终止态”“异步工具返回”这几个
    // 影响面更大的变化，其余（思考/正文推进、工具片段与实时输出）都只动这一条消息，
    // 走消息范围，不惊动整页。工具卡就在该消息内容区里，由消息范围驱动更新；
    // 异步工具返回消息不在该内容区渲染，必须让整个会话页重渲染。
    const needsSessionRescope =
      isNewMessage ||
      isTerminalEbRunStatus(payload.status) ||
      messageType === CHAT_MESSAGE_TYPE_ASYNC_TOOL_RESULT
    if (needsSessionRescope) {
      scheduleSession(targetKind, targetId, sessionId)
    } else {
      scheduleScope(messageRefreshScope(messageId))
    }
    return true
  }

  // applyAssistantMessageDelta 把“本次新增变化”叠加到本地消息：
  // 增量内容累加，重置标记则整体替换，工具片段按 id 合并。
  function applyAssistantMessageDelta(runIdRaw: unknown, raw: unknown) {
    const delta = raw && typeof raw === 'object' ? (raw as any) : null
    if (!delta) return false
    const state = deps.getState()
    if (!state?.data) return false

    const runId = String(runIdRaw || '').trim()
    const roleId = String(delta.roleId || '').trim()
    const groupId = String(delta.groupId || '').trim()
    const workspaceId = String(delta.workspaceId || '').trim()
    const sessionId = String(delta.sessionId || '').trim()
    const messageId = String(delta.messageId || '').trim()
    if (!runId || !roleId || !sessionId || !messageId) return false
    // 终态之后迟到的增量不再推进：它属于已收口的运行，落进来只会把消息
    // 重新点亮成「生成中」，并留下永不消失的占位。
    if (isRunSettled(state, runId)) return false

    const eventTime = normalizeTimeMs(delta.createdAt)
    const messageCreatedAt = normalizeTimeMs(delta.messageCreatedAt, eventTime)
    const { targetKind, targetId } = runEventTarget(roleId, groupId, workspaceId)
    const box = ensureTargetChatBox(state, targetKind, targetId)
    const chat = ensureRuntimeTargetChat(state, targetKind, targetId, sessionId, messageCreatedAt)
    if (!chat) return false
    ensureChatMessages(chat)

    const parentMid = String(delta.parentMessageId || '').trim()
    const branchId = normalizeBranchId(delta.branchId || CHAT_DEFAULT_BRANCH_ID)

    let message = chat.messages.find((item: any) => String(item?.id || '').trim() === messageId) || null
    const isNewMessage = !message
    if (!message) {
      message = normalizeChatMessage(
        {
          id: messageId,
          type: String(delta.messageType || 'assistant').trim() || 'assistant',
          role: 'assistant',
          speakerRoleId: String(delta.speakerRoleId || '').trim(),
          content: '',
          parentMid,
          branchId,
          createdAt: messageCreatedAt,
          updatedAt: eventTime,
        },
        { activeBranchId: branchId || CHAT_DEFAULT_BRANCH_ID, toolMessagesAsAssistant: true },
      )
      writeChatMessageFields(message, {
        id: messageId,
        type: 'assistant',
        role: 'assistant',
        parentMid,
        branchId,
        createdAt: messageCreatedAt,
        updatedAt: eventTime,
        assistantRun: { generationId: runId, status: 'running', mode: 'new', stream: !!delta.stream, startedAt: messageCreatedAt, updatedAt: eventTime },
        pending: true,
        streaming: !!delta.stream,
        content: '',
        parts: [],
      })
      markRuntimeMessageInFlight(message)
      appendChatMessage(chat, message)
    }

    if (delta.contentReset) {
      writeChatMessageFields(message, { content: String(delta.contentDelta || '') })
    } else if (delta.contentDelta) {
      writeChatMessageFields(message, { content: String(message.content || '') + String(delta.contentDelta) })
    }

    const reasoningDelta = String(delta.reasoningDelta || '')
    const reasoningSignature = String(delta.reasoningSignature || '')
    const reasoningData = String(delta.reasoningData || '')
    const reasoningSource = String(delta.reasoningSource || '')
    if (reasoningDelta || delta.reasoningReset || reasoningSignature || reasoningData) {
      const parts = Array.isArray(message.parts) ? message.parts : []
      const index = parts.findIndex((part: any) => String(part?.type || '') === 'reasoning')
      const base = index >= 0 ? parts[index] : { id: `${messageId}:reasoning`, type: 'reasoning', text: '', source: reasoningSource, signature: '', data: '' }
      const nextText = delta.reasoningReset ? reasoningDelta : String(base?.text || '') + reasoningDelta
      const nextPart = {
        ...base,
        type: 'reasoning',
        text: nextText,
        source: reasoningSource || String(base?.source || ''),
        signature: reasoningSignature || String(base?.signature || ''),
        data: reasoningData || String(base?.data || ''),
      }
      const nextParts = index >= 0
        ? parts.map((part: any, partIndex: number) => (partIndex === index ? nextPart : part))
        : parts.concat([nextPart])
      writeChatMessageFields(message, { parts: nextParts })
    }

    if (Array.isArray(delta.partsDelta) && delta.partsDelta.length) {
      let parts = Array.isArray(message.parts) ? message.parts : []
      for (const incoming of delta.partsDelta) {
        const normalized = normalizeMessageParts([incoming])
        if (!normalized.length) continue
        const part = normalized[0]
        const key = String(part.callId || part.id || '').trim()
        const index = parts.findIndex((item: any) => String(item?.callId || item?.id || '').trim() === key)
        parts = index >= 0
          ? parts.map((item: any, partIndex: number) => (partIndex === index ? { ...item, ...part } : item))
          : parts.concat([part])
      }
      writeChatMessageFields(message, { parts })
    }

    const structuralFields: ChatMessageFields = {
      role: 'assistant',
      type: 'assistant',
      branchId,
      updatedAt: Math.max(Number(message.updatedAt || 0), eventTime),
    }
    if (parentMid) structuralFields.parentMid = parentMid
    writeChatMessageFields(message, structuralFields)
    const deltaTerminalStatus = assistantRunStatusFromRunStatus(delta.status)
    if (deltaTerminalStatus) {
      finishAssistantRun(message, message.content, deltaTerminalStatus, message.updatedAt)
      writeRunCards(state, runId, () => {
        settleRunInState(state, {
          runId,
          status: String(delta.status || '').trim(),
          roleId,
          groupId,
          workspaceId,
          sessionId,
          messageIds: [messageId, parentMid],
        }, findEbRoleRunCard(state, runId))
      })
    } else {
      markRuntimeMessageInFlight(message)
      checkpointAssistantRun(message, message.content, message.updatedAt)
    }

    chat.updatedAt = Math.max(Number(chat.updatedAt || 0), eventTime)
    // 列表结构事实：新消息第一次落地、终态、工具片段变化（列表摘要会从正文变成
    // 「工具调用」）。纯正文/思考推进只走消息范围，等这一轮收口时再刷新列表摘要。
    const listStructureChanged =
      isNewMessage ||
      !!deltaTerminalStatus ||
      (Array.isArray(delta.partsDelta) && delta.partsDelta.length > 0)
    if (listStructureChanged) {
      publishChatListFacts(box, chat, targetKind, targetId, targetKind === 'group' ? '群聊' : '新聊天')
    }
    const branch = ensureChatBranch(chat, branchId)
    if (branch) {
      if (!String(branch.forkFromMid || '').trim() && parentMid) branch.forkFromMid = parentMid
      setChatBranchHeadMid(chat, branchId, messageId)
    }
    const patch: any = {
      runId,
      roleId,
      groupId,
      workspaceId,
      sessionId,
      inputMessageId: parentMid,
      lastMessageId: messageId,
      anchorMessageId: parentMid,
      status: 'running',
      stream: !!delta.stream,
    }
    if (!deltaTerminalStatus) {
      writeRunCards(state, runId, () => {
        updateEbRoleRunCard(state, patch)
      })
    }
    scheduleRuntimeChatChanged(targetKind, targetId, chat)

    if (isNewMessage) scheduleSession(targetKind, targetId, sessionId)
    else scheduleScope(messageRefreshScope(messageId))
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
    scheduleSession(targetKind, targetId, sessionId)
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
    const nextParts = message.parts.map((item: any, index: number) => (index === partIndex
      ? {
          ...item,
          runtimeOutput: {
            bytes: Math.max(0, Number(update.bytes || 0)),
            preview: String(update.preview || '').trim(),
            updatedAt: normalizeTimeMs(update.createdAt),
          },
        }
      : item))
    writeChatMessageFields(message, {
      parts: nextParts,
      updatedAt: Math.max(Number(message.updatedAt || 0), normalizeTimeMs(update.createdAt)),
    })
    chat.updatedAt = Math.max(Number(chat.updatedAt || 0), normalizeTimeMs(update.createdAt))
    // 工具实时输出只改消息片段：走消息范围。
    // 它不是列表结构事实（摘要、条数、位置都没变），写投影与广播都省掉。
    scheduleScope(messageRefreshScope(messageId))
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
    for (const item of items) {
      changed = applyAssistantMessageUpdate(item?.runId, item?.payload) || changed
    }
    return changed
  }

  // applyRunEvent 是事件分发的唯一入口：先由协议契约解析信封，
  // 运行身份只取信封 runId；载荷内任何 id 都不参与身份判定。
  function applyRunEvent(raw: unknown) {
    const envelope = readRunEventEnvelope(raw)
    if (!envelope) return false
    const { runId, type, payload } = envelope
    if (type === 'assistant_message_delta') return applyAssistantMessageDelta(runId, payload)
    if (type === 'assistant_message_update' || type === 'run_message_update') return applyAssistantMessageUpdate(runId, payload)
    if (type === 'async_tool_task_update') return applyAsyncToolTaskUpdate(payload)
    if (type === 'tool_output_update') return applyToolOutputUpdate(payload)
    if (isLifecycleRunEventType(type)) return applyRunStateEvent(runId, payload)
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
    if (scopeRaf) {
      window.cancelAnimationFrame(scopeRaf)
      scopeRaf = 0
    }
    pendingScopes.clear()
    for (const timer of changedTimers.values()) window.clearTimeout(timer)
    changedTimers.clear()
  }

  return { start, stop, applyRunEvent, flushSession }
}
