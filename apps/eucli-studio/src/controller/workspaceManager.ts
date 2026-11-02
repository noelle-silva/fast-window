import { now, uid } from '../core/utils'
import { chatMetaFromChat } from '../domain/chatMeta'
import { writeChatListProjection } from '../domain/chatListProjection'
import { NEW_WORKSPACE_ID } from '../domain/constants'
import { activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { moveListItemById, type ListMovePosition } from '../domain/listOrdering'
import { clearPendingChatForTarget, createPendingChatEntry, pendingChatForTarget } from '../domain/pendingChat'
import { activateComposerDraftForCurrentSession, saveActiveComposerDraftMirror } from '../domain/sessionComposerDrafts'
import { workspaceRegisteredRoleIds, workspaceRolesInScope } from '../domain/workspaceRoleScope'
import { parseWorkspaceRoleTargetId, workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import {
  firstChatIdInBox,
  readActiveChatSelection,
  reconcileActiveChatSelection,
  writeActiveChatSelection,
} from '../domain/activeChatSelection'
import type { AiChatShowToast } from '../gateway/capabilities'
import type { SessionWriteGuard } from '../storage/sessionWriteGuard'
import { GLOBAL_REFRESH_SCOPE, refreshScopes } from '../domain/uiRefreshScope'
import { saveEntityOrder } from './entityOrderBridge'
import {
  createWorkspaceSession,
  deleteWorkspace,
  deleteWorkspaceSession,
  listWorkspaceSessionSummaries,
  listWorkspacesDetailed,
  loadWorkspaceSession,
  previewWorkspacePrompt,
  saveWorkspace,
  updateWorkspaceSessionTitle,
  workspaceSessionSummaryToMeta,
  type UiWorkspace,
} from './workspaceBridge'

function text(value: unknown) {
  return String(value || '').trim()
}

function normalizeWorkspaceRoleIds(raw: unknown) {
  return (Array.isArray(raw) ? raw : []).map((roleId) => text(roleId)).filter(Boolean)
}

function workspaceDraftDirectories(raw: unknown) {
  const list = Array.isArray(raw) ? raw : []
  return list.map((item) => {
    const box = item && typeof item === 'object' ? (item as any) : {}
    return {
      path: text(box.path),
      alias: text(box.alias),
      description: text(box.description),
    }
  })
}

function ensureWorkspaceRoots(state: any) {
  if (!state?.data) return null
  if (!Array.isArray((state.data as any).workspaces)) (state.data as any).workspaces = []
  if (!(state.data as any).chatsByWorkspace || typeof (state.data as any).chatsByWorkspace !== 'object') (state.data as any).chatsByWorkspace = {}
  if (!state.data.ui || typeof state.data.ui !== 'object') state.data.ui = {}
  return state.data
}

function firstRoleId(state: any) {
  const roles = Array.isArray(state?.data?.roles) ? state.data.roles : []
  return text(roles[0]?.id)
}

function currentWorkspaceRoleId(state: any, activeRole: () => any) {
  return text(activeRole()?.id || state?.draft?.activeRoleId || state?.data?.ui?.activeRoleId)
}

function isActiveWorkspaceRole(state: any, activeRole: () => any, workspaceId: string, roleId: string): boolean {
  if (!state?.data) return false
  if (String(state.draft?.activeTargetKind || state.data.ui?.activeTargetKind || '').trim() !== 'workspace') return false
  const currentWorkspaceId = text(state.draft?.activeWorkspaceId || state.data.ui?.activeWorkspaceId)
  return currentWorkspaceId === workspaceId && currentWorkspaceRoleId(state, activeRole) === roleId
}

function ensureWorkspaceBox(state: any, activeRole: () => any, workspaceIdRaw: unknown, roleIdRaw?: unknown) {
  const data = ensureWorkspaceRoots(state)
  if (!data) return null
  const workspaceId = text(workspaceIdRaw)
  const roleId = text(roleIdRaw) || currentWorkspaceRoleId(state, activeRole)
  const targetId = workspaceRoleTargetId(workspaceId, roleId)
  if (!workspaceId || !roleId || !targetId) return null
  if (!(data as any).chatsByWorkspace[targetId] || typeof (data as any).chatsByWorkspace[targetId] !== 'object') {
    ;(data as any).chatsByWorkspace[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
  }
  const box = (data as any).chatsByWorkspace[targetId]
  writeChatListProjection(box, { kind: 'ensure' })
  box.workspaceId = workspaceId
  box.roleId = roleId
  box.targetId = targetId
  writeActiveChatSelection(box, readActiveChatSelection(box))
  return box
}

function boxHasChatRef(box: any, chatIdRaw: unknown) {
  const chatId = text(chatIdRaw)
  if (!chatId) return false
  if (Array.isArray(box?.chatMetas) && box.chatMetas.some((item: any) => text(item?.id) === chatId)) return true
  return Array.isArray(box?.chats) && box.chats.some((item: any) => text(item?.id) === chatId)
}

function normalizeWorkspaceList(workspacesRaw: UiWorkspace[]) {
  return (Array.isArray(workspacesRaw) ? workspacesRaw : [])
    .filter((workspace) => workspace && typeof workspace === 'object' && text(workspace.id))
}

function workspaceDraft(state: any): UiWorkspace {
  const editWorkspaceId = text((state.draft as any)?.editWorkspaceId)
  const existing = (Array.isArray((state.data as any)?.workspaces) ? (state.data as any).workspaces : []).find((workspace: any) => text(workspace?.id) === editWorkspaceId) || null
  return {
    id: editWorkspaceId,
    name: text((state.draft as any)?.workspaceName) || '未命名工作区',
    directories: workspaceDraftDirectories((state.draft as any)?.workspaceDirectories).filter((directory) => directory.path || directory.alias || directory.description),
    prompt: String((state.draft as any)?.workspacePrompt ?? ''),
    registeredRoleIds: normalizeWorkspaceRoleIds((state.draft as any)?.workspaceRegisteredRoleIds),
    actualPrompt: '',
    createdAt: Number(existing?.createdAt || now()),
    updatedAt: now(),
  }
}

export function createWorkspaceManager(deps: {
  getState: () => any
  netRequest?: (req: any) => Promise<any>
  emit: () => void
  render: () => void
  emitScope?: (scope: string) => void
  closeModal: () => void
  saveMeta: () => Promise<void>
  scrollToBottomSoon: () => void
  showToast?: AiChatShowToast
  activeTargetKind: () => string
  activeRole: () => any
  activeWorkspace: () => any
  clearPendingWorkspaceChat: () => void
  removeLoadedChat?: (kind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => void
  // 删除工作区 / 工作区会话时推进代数：在途列表与会话体不得回填。
  sessionWrites?: SessionWriteGuard
  onChatDeleted?: (kind: 'workspace', targetId: string, chatId: string) => void
  onWorkspaceDeleted?: (workspaceId: string) => void
  cleanupFavoriteRefsForChat?: (targetKind: string, targetId: string, roleId: string, chatId: string) => void
  cleanupFavoriteRefsForTarget?: (targetKind: string, targetId: string) => void
}) {
  const { getState, netRequest, emit, render, emitScope, closeModal, saveMeta, scrollToBottomSoon, showToast, activeTargetKind, activeRole, activeWorkspace, clearPendingWorkspaceChat, removeLoadedChat, sessionWrites, onChatDeleted, onWorkspaceDeleted, cleanupFavoriteRefsForChat, cleanupFavoriteRefsForTarget } = deps
  let workspaceMoveSeq = 0
  // 列表刷新是「最后发起的请求获胜」：旧响应落地时序号已变，直接丢弃。
  // 工作区列表与每个角色组合的会话列表各自一条序列。
  let workspaceListSeq = 0
  const workspaceChatListSeq = new Map<string, number>()

  function beginLatest(map: Map<string, number>, key: string): number {
    const next = (map.get(key) || 0) + 1
    map.set(key, next)
    return next
  }

  function isLatest(map: Map<string, number>, key: string, seq: number): boolean {
    return map.get(key) === seq
  }

  function supersedeWorkspaceChatList(workspaceId: string, roleId: string) {
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    beginLatest(workspaceChatListSeq, targetId)
  }

  function requireNetRequest() {
    if (typeof netRequest !== 'function') throw new Error('工作区请求通道不可用')
    return netRequest
  }

  function notifyScopes(scopes: readonly string[]) {
    const addresses = scopes.filter((scope) => scope && scope !== GLOBAL_REFRESH_SCOPE)
    if (emitScope && addresses.length) {
      for (const address of addresses) emitScope(address)
      return
    }
    render()
  }

  function notifyWorkspaceChatSelected(targetId: string, chatId: string) {
    if (!targetId || !chatId) return
    notifyScopes([
      refreshScopes.navigation(),
      refreshScopes.composer(),
      refreshScopes.chatList('workspace', targetId),
    ])
  }

  function notifyWorkspaceChatLoaded(targetId: string, chatId: string) {
    if (!targetId || !chatId) return
    notifyScopes([
      refreshScopes.session('workspace', targetId, chatId),
      refreshScopes.chatList('workspace', targetId),
    ])
  }

  function notifyWorkspaceTarget(targetId: string) {
    if (!targetId) return
    notifyScopes([refreshScopes.chatList('workspace', targetId)])
    const box = (getState().data as any)?.chatsByWorkspace?.[targetId]
    const chatId = text(box?.activeChatId)
    if (chatId) notifyScopes([refreshScopes.session('workspace', targetId, chatId)])
  }

  // 进入工作区 / 切换工作区角色：目标身份、草稿与列表是三个独立地址。
  function notifyWorkspaceActivated(workspaceId: string) {
    const state = getState()
    const roleId = currentWorkspaceRoleId(state, activeRole)
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    notifyScopes([
      refreshScopes.navigation(),
      refreshScopes.composer(),
      ...(targetId ? [refreshScopes.chatList('workspace', targetId)] : []),
    ])
    if (targetId) notifyWorkspaceTarget(targetId)
  }

  function notifyWorkspaceCombination(workspaceId: string) {
    const targetId = workspaceRoleTargetId(workspaceId, currentWorkspaceRoleId(getState(), activeRole))
    notifyWorkspaceTarget(targetId)
  }

  function notifyWorkspaceChatCreated(workspaceId: string) {
    const targetId = workspaceRoleTargetId(workspaceId, currentWorkspaceRoleId(getState(), activeRole))
    notifyScopes([
      refreshScopes.navigation(),
      refreshScopes.composer(),
      ...(targetId ? [refreshScopes.chatList('workspace', targetId)] : []),
    ])
  }

  function markWorkspacePromptPreviewStale() {
    const state = getState()
    if (!state?.draft) return
    ;(state.draft as any).workspaceActualPromptStale = true
    ;(state.draft as any).workspaceActualPromptError = ''
  }

  async function refreshWorkspacePromptPreview() {
    const state = getState()
    if (!state?.data) return ''
    ;(state.draft as any).workspaceActualPromptLoading = true
    ;(state.draft as any).workspaceActualPromptError = ''
    notifyScopes([refreshScopes.uiShell()])
    try {
      const actualPrompt = await previewWorkspacePrompt(requireNetRequest(), workspaceDraft(state))
      ;(state.draft as any).workspaceActualPrompt = actualPrompt
      ;(state.draft as any).workspaceActualPromptStale = false
      return actualPrompt
    } catch (e: any) {
      const message = String(e?.message || e || '实际提示词生成失败')
      ;(state.draft as any).workspaceActualPromptError = message
      showToast?.(message, { kind: 'error' })
      return ''
    } finally {
      ;(state.draft as any).workspaceActualPromptLoading = false
    notifyScopes([refreshScopes.uiShell()])
    }
  }

  function syncWorkspaceListToState(workspacesRaw: UiWorkspace[], preferredWorkspaceId?: string) {
    const state = getState()
    const data = ensureWorkspaceRoots(state)
    if (!data) return []
    const workspaces = normalizeWorkspaceList(workspacesRaw)
    ;(data as any).workspaces = workspaces

    const knownIds = new Set(workspaces.map((workspace) => text(workspace.id)).filter(Boolean))
    const chatsByWorkspace = (data as any).chatsByWorkspace
    const activeWorkspaceRoleId = currentWorkspaceRoleId(state, activeRole)
    for (const workspace of workspaces) ensureWorkspaceBox(state, activeRole, workspace.id, activeWorkspaceRoleId)
    for (const workspaceId of Object.keys(chatsByWorkspace || {})) {
      const parsed = parseWorkspaceRoleTargetId(workspaceId)
      const rootWorkspaceId = parsed.workspaceId || text(workspaceId)
      if (!knownIds.has(rootWorkspaceId)) delete chatsByWorkspace[workspaceId]
    }

    let nextActiveWorkspaceId = text(preferredWorkspaceId) || text((state.draft as any)?.activeWorkspaceId || (data.ui as any)?.activeWorkspaceId)
    if (nextActiveWorkspaceId && !knownIds.has(nextActiveWorkspaceId)) nextActiveWorkspaceId = ''
    if (!nextActiveWorkspaceId) nextActiveWorkspaceId = text(workspaces[0]?.id)
    ;(state.draft as any).activeWorkspaceId = nextActiveWorkspaceId
    ;(data.ui as any).activeWorkspaceId = nextActiveWorkspaceId

    if (activeTargetKind() === 'workspace' && !nextActiveWorkspaceId) {
      ;(state.draft as any).activeTargetKind = Array.isArray((data as any).groups) && (data as any).groups.length ? 'group' : 'role'
    }
    if (!text(state.draft?.activeRoleId || data.ui?.activeRoleId)) {
      state.draft.activeRoleId = firstRoleId(state)
      data.ui.activeRoleId = text(state.draft.activeRoleId)
    }
    return workspaces
  }

  // 业务端会话是事实源；这里仅更新客户端视窗缓存，并保留运行事件已展示的本地增量。
  function upsertWorkspaceChat(workspaceIdRaw: unknown, chatRaw: any) {
    const state = getState()
    if (!state?.data || !chatRaw || typeof chatRaw !== 'object') return null
    const workspaceId = text(workspaceIdRaw)
    const roleId = text(chatRaw?.roleId)
    const chatId = text(chatRaw?.id)
    if (!workspaceId || !roleId || !chatId) return null
    const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return null
    const nextChat = writeChatListProjection(box, { kind: 'upsert', chat: chatRaw, fallbackTitle: '工作区会话' })?.chat || null
    if (!nextChat) return null
    if (!readActiveChatSelection(box)) writeActiveChatSelection(box, chatId)
    return nextChat
  }

  async function refreshActiveWorkspaceChats(workspaceIdRaw?: unknown) {
    const state = getState()
    if (!state?.data) return null
    const workspaceId = text(workspaceIdRaw) || text(activeWorkspace()?.id || (state.draft as any)?.activeWorkspaceId || (state.data.ui as any)?.activeWorkspaceId)
    if (!workspaceId) return null
    const request = requireNetRequest()
    const roleId = currentWorkspaceRoleId(state, activeRole)
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    const seq = beginLatest(workspaceChatListSeq, targetId)
    const targetToken = sessionWrites?.capture('workspace', targetId, '') || null
    const summaries = await listWorkspaceSessionSummaries(request, workspaceId, roleId)
    // 更新的列表请求已经发出 / 工作区已被删除：旧响应不得覆盖新事实。
    if (!isLatest(workspaceChatListSeq, targetId, seq)) return null
    if (sessionWrites && !sessionWrites.isCurrent(targetToken)) return null
    const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return null
    const metas = summaries.map(workspaceSessionSummaryToMeta).filter(Boolean)
    const metaIds = new Set(metas.map((meta: any) => text(meta?.id)).filter(Boolean))
    const chats = (Array.isArray(box.chats) ? box.chats : []).filter((chat: any) => metaIds.has(text(chat?.id)))
    writeChatListProjection(box, { kind: 'replace', chats, chatMetas: metas })
    reconcileActiveChatSelection(box)
    return box
  }

  async function refreshWorkspaces(preferredWorkspaceId?: string) {
    const state = getState()
    if (!state?.data) return []
    const request = requireNetRequest()
    const seq = ++workspaceListSeq
    const workspaces = await listWorkspacesDetailed(request)
    // 删除工作区 / 更新的刷新已经发生：旧列表属于上一代。
    if (seq !== workspaceListSeq) return []
    const next = syncWorkspaceListToState(workspaces, preferredWorkspaceId)
    const activeWorkspaceId = text((state.draft as any)?.activeWorkspaceId)
    if (activeWorkspaceId) await refreshActiveWorkspaceChats(activeWorkspaceId).catch(() => null)
    return next
  }

  async function ensureWorkspaceChatLoaded(workspaceIdRaw: unknown, roleIdRaw: unknown, chatIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return null
    const workspaceId = text(workspaceIdRaw)
    const roleId = text(roleIdRaw)
    const chatId = text(chatIdRaw)
    if (!workspaceId || !roleId || !chatId) return null
    const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return null
    const existing = (Array.isArray(box.chats) ? box.chats : []).find((chat: any) => text(chat?.id) === chatId && !chat?.runtimePartial) || null
    if (existing) return existing
    const request = requireNetRequest()
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    const writeToken = sessionWrites?.capture('workspace', targetId, chatId) || null
    const chat = await loadWorkspaceSession(request, workspaceId, roleId, chatId)
    if (!chat) return null
    // 读取期间会话 / 工作区被删除：旧会话不得写回。
    if (sessionWrites && !sessionWrites.isCurrent(writeToken)) return null
    upsertWorkspaceChat(workspaceId, chat)
    return chat
  }

  async function ensureActiveWorkspaceChatLoaded() {
    const state = getState()
    if (!state?.data || activeTargetKind() !== 'workspace') return null
    const workspaceId = text(activeWorkspace()?.id || (state.draft as any)?.activeWorkspaceId || (state.data.ui as any)?.activeWorkspaceId)
    if (!workspaceId) return null
    const roleId = currentWorkspaceRoleId(state, activeRole)
    const pendingChat = pendingChatForTarget(state, 'workspace', workspaceRoleTargetId(workspaceId, roleId))
    if (pendingChat) return pendingChat
    const box = ensureWorkspaceBox(state, activeRole, workspaceId)
    if (!box) return null
    if (!Array.isArray(box.chatMetas) || !box.chatMetas.length) await refreshActiveWorkspaceChats(workspaceId).catch(() => null)
    const ids = [readActiveChatSelection(box), ...(Array.isArray(box.chatMetas) ? box.chatMetas.map((meta: any) => text(meta?.id)) : [])]
      .filter((id, index, list) => !!id && list.indexOf(id) === index)
    for (const chatId of ids) {
      // ids 是循环开始时的快照：期间可能已经删除。删除之后不得再写偏好，
      // 也不得用「删除之后才发起」的加载把会话重新写回。
      if (!boxHasChatRef(box, chatId)) continue
      writeActiveChatSelection(box, chatId)
      const chat = await ensureWorkspaceChatLoaded(workspaceId, roleId, chatId)
      if (chat) return chat
    }
    writeActiveChatSelection(box, '')
    return null
  }

  // 「工作区+角色」组合会话的唯一加载路径：先拉会话列表，再拉会话体，
  // 数据到达后经刷新中枢 emit 自动呈现。进入工作区与切换角色都用这一条路径与节奏。
  function loadWorkspaceRoleCombination(workspaceIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return
    const workspaceId = text(workspaceIdRaw)
    if (!workspaceId) return
    ensureWorkspaceBox(state, activeRole, workspaceId)
    refreshActiveWorkspaceChats(workspaceId).catch(() => null).finally(() => {
      ensureActiveWorkspaceChatLoaded().catch(() => null).finally(() => notifyWorkspaceCombination(workspaceId))
    })
  }

  // 工作区目标激活的唯一写入点：目标身份三要素（模式、工作区、角色）始终一起落状态。
  function activateWorkspaceTarget(state: any, workspaceIdRaw: unknown, roleIdRaw?: unknown) {
    const workspaceId = text(workspaceIdRaw)
    state.draft.activeRoleId = text(roleIdRaw) || text(state.draft.activeRoleId) || firstRoleId(state)
    if (!workspaceId) return
    ;(state.draft as any).activeTargetKind = 'workspace'
    ;(state.draft as any).activeWorkspaceId = workspaceId
  }

  function setActiveWorkspace(workspaceIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return
    const workspaceId = text(workspaceIdRaw)
    if (!workspaceId) return
    saveActiveComposerDraftMirror(state)
    state.branchDraft = null
    activateWorkspaceTarget(state, workspaceId)
    activateComposerDraftForCurrentSession(state)
    loadWorkspaceRoleCombination(workspaceId)
    saveMeta().catch(() => {})
    notifyWorkspaceActivated(workspaceId)
  }

  function setWorkspaceRole(roleIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return
    const roleId = text(roleIdRaw)
    if (!roleId) return
    saveActiveComposerDraftMirror(state)
    state.branchDraft = null
    const workspaceId = text(activeWorkspace()?.id || (state.draft as any)?.activeWorkspaceId || (state.data.ui as any)?.activeWorkspaceId)
    activateWorkspaceTarget(state, workspaceId, roleId)
    activateComposerDraftForCurrentSession(state)
    if (workspaceId) loadWorkspaceRoleCombination(workspaceId)
    saveMeta().catch(() => {})
    notifyWorkspaceActivated(workspaceId)
  }

  async function moveWorkspace(workspaceIdRaw: unknown, targetWorkspaceIdRaw: unknown, positionRaw: unknown) {
    const state = getState()
    if (!state?.data) return
    const workspaces = Array.isArray((state.data as any).workspaces) ? ((state.data as any).workspaces as any[]) : []
    const workspaceId = text(workspaceIdRaw)
    const targetWorkspaceId = text(targetWorkspaceIdRaw)
    if (!workspaceId || !targetWorkspaceId || workspaceId === targetWorkspaceId) return
    const position: ListMovePosition = text(positionRaw) === 'after' ? 'after' : 'before'
    const next = moveListItemById(workspaces, (workspace) => text(workspace?.id), workspaceId, targetWorkspaceId, position)
    if (next === workspaces) return

    const seq = ++workspaceMoveSeq
    ;(state.data as any).workspaces = next
    notifyScopes([refreshScopes.entities('workspaces')])
    try {
      await saveEntityOrder(requireNetRequest(), 'workspaces', next.map((workspace) => text(workspace?.id)))
    } catch (e: any) {
      // 快速连续拖拽时，旧请求失败不能覆盖更新的本地顺序。
      if (seq !== workspaceMoveSeq) return
      ;(state.data as any).workspaces = workspaces
      notifyScopes([refreshScopes.entities('workspaces')])
      showToast?.(String(e?.message || e || '工作区排序保存失败'), { kind: 'error' })
    }
  }

  function populateNewWorkspaceDraft() {
    const state = getState()
    if (!state?.data) return false
    ;(state.draft as any).editWorkspaceId = NEW_WORKSPACE_ID
    ;(state.draft as any).workspaceName = '新工作区'
    ;(state.draft as any).workspacePrompt = ''
    ;(state.draft as any).workspaceDirectories = [{ path: '', alias: '', description: '' }]
    ;(state.draft as any).workspaceRegisteredRoleIds = []
    ;(state.draft as any).workspaceActualPrompt = ''
    ;(state.draft as any).workspaceActualPromptLoading = false
    ;(state.draft as any).workspaceActualPromptStale = true
    ;(state.draft as any).workspaceActualPromptError = ''
    return true
  }

  function openNewWorkspaceEditor() {
    if (!populateNewWorkspaceDraft()) return
    ;(getState().draft as any).workspaceEditorInPlace = false
    getState().modal = 'workspace'
    notifyScopes([refreshScopes.uiShell()])
    refreshWorkspacePromptPreview().catch(() => null)
  }

  function openNewWorkspaceEditorInPlace() {
    if (!populateNewWorkspaceDraft()) return
    ;(getState().draft as any).workspaceEditorInPlace = true
    notifyScopes([refreshScopes.uiShell()])
    refreshWorkspacePromptPreview().catch(() => null)
  }

  function openWorkspaceEditor(workspaceIdRaw: unknown) {
    if (!populateWorkspaceDraft(workspaceIdRaw)) return
    ;(getState().draft as any).workspaceEditorInPlace = false
    getState().modal = 'workspace'
    notifyScopes([refreshScopes.uiShell()])
  }

  function openWorkspaceEditorInPlace(workspaceIdRaw: unknown) {
    if (!populateWorkspaceDraft(workspaceIdRaw)) return
    ;(getState().draft as any).workspaceEditorInPlace = true
    notifyScopes([refreshScopes.uiShell()])
  }

  function populateWorkspaceDraft(workspaceIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return false
    const workspaceId = text(workspaceIdRaw)
    const workspace = (Array.isArray((state.data as any).workspaces) ? (state.data as any).workspaces : []).find((item: any) => text(item?.id) === workspaceId) || null
    if (!workspace) return false
    ;(state.draft as any).editWorkspaceId = workspaceId
    ;(state.draft as any).workspaceName = text(workspace.name)
    ;(state.draft as any).workspacePrompt = String(workspace.prompt ?? '')
    ;(state.draft as any).workspaceDirectories = workspace.directories?.length
      ? workspace.directories.map((directory: any) => ({ path: text(directory?.path), alias: text(directory?.alias), description: text(directory?.description) }))
      : [{ path: '', alias: '', description: '' }]
    ;(state.draft as any).workspaceRegisteredRoleIds = workspaceRegisteredRoleIds(workspace)
    ;(state.draft as any).workspaceActualPrompt = String(workspace.actualPrompt ?? '')
    ;(state.draft as any).workspaceActualPromptLoading = false
    ;(state.draft as any).workspaceActualPromptStale = false
    ;(state.draft as any).workspaceActualPromptError = ''
    return true
  }

  function addWorkspaceDirectory() {
    const state = getState()
    const current = workspaceDraftDirectories((state.draft as any)?.workspaceDirectories)
    ;(state.draft as any).workspaceDirectories = current.concat({ path: '', alias: '', description: '' })
    markWorkspacePromptPreviewStale()
    notifyScopes([refreshScopes.uiShell()])
  }

  function removeWorkspaceDirectory(indexRaw: unknown) {
    const state = getState()
    const index = Math.max(0, Math.floor(Number(indexRaw || 0)))
    const current = workspaceDraftDirectories((state.draft as any)?.workspaceDirectories)
    const next = current.filter((_, currentIndex) => currentIndex !== index)
    ;(state.draft as any).workspaceDirectories = next.length ? next : [{ path: '', alias: '', description: '' }]
    markWorkspacePromptPreviewStale()
    notifyScopes([refreshScopes.uiShell()])
  }

  function setWorkspaceDirectoryField(indexRaw: unknown, fieldRaw: unknown, value: unknown) {
    const state = getState()
    const index = Math.max(0, Math.floor(Number(indexRaw || 0)))
    const field = text(fieldRaw)
    if (field !== 'path' && field !== 'alias' && field !== 'description') return
    const current = workspaceDraftDirectories((state.draft as any)?.workspaceDirectories)
    while (current.length <= index) current.push({ path: '', alias: '', description: '' })
    current[index] = { ...current[index], [field]: String(value ?? '') }
    ;(state.draft as any).workspaceDirectories = current
    markWorkspacePromptPreviewStale()
    notifyScopes([refreshScopes.uiShell()])
  }

  function setWorkspaceRoleRegistered(roleIdRaw: unknown, registeredRaw: unknown) {
    const state = getState()
    if (!state?.draft) return
    const roleId = text(roleIdRaw)
    if (!roleId) return
    const current = normalizeWorkspaceRoleIds((state.draft as any)?.workspaceRegisteredRoleIds)
    const registered = Boolean(registeredRaw)
    const next = registered
      ? (current.includes(roleId) ? current : current.concat(roleId))
      : current.filter((currentRoleId) => currentRoleId !== roleId)
    ;(state.draft as any).workspaceRegisteredRoleIds = next
    notifyScopes([refreshScopes.uiShell()])
  }

  async function saveWorkspaceEditor() {
    const state = getState()
    if (!state?.data) return
    const editWorkspaceId = text((state.draft as any)?.editWorkspaceId)
    const isNew = editWorkspaceId === NEW_WORKSPACE_ID
    const workspaceId = isNew ? uid('w') : editWorkspaceId
    const name = text((state.draft as any)?.workspaceName) || '未命名工作区'
    const prompt = String((state.draft as any)?.workspacePrompt ?? '')
    const directories = workspaceDraftDirectories((state.draft as any)?.workspaceDirectories)
      .filter((directory) => directory.path || directory.alias || directory.description)
    for (const directory of directories) {
      if (!directory.path) return showToast?.('工作区目录路径不能为空', { kind: 'error' })
    }
    const existing = (Array.isArray((state.data as any).workspaces) ? (state.data as any).workspaces : []).find((workspace: any) => text(workspace?.id) === workspaceId) || null
    const nextWorkspace: UiWorkspace = {
      id: workspaceId,
      name,
      prompt,
      registeredRoleIds: normalizeWorkspaceRoleIds((state.draft as any)?.workspaceRegisteredRoleIds),
      actualPrompt: '',
      directories,
      createdAt: Number(existing?.createdAt || now()),
      updatedAt: now(),
    }
    try {
      await saveWorkspace(requireNetRequest(), nextWorkspace)
      await refreshWorkspaces(workspaceId)
      activateWorkspaceTarget(state, workspaceId)
      saveMeta().catch(() => {})
      showToast?.(isNew ? '工作区已创建' : '工作区已保存', { kind: 'success' })
      closeModal()
      activateComposerDraftForCurrentSession(state)
      notifyScopes([refreshScopes.entities('workspaces'), refreshScopes.uiShell()])
      notifyWorkspaceActivated(workspaceId)
    } catch (e: any) {
      showToast?.(String(e?.message || e || '工作区保存失败'), { kind: 'error' })
      notifyScopes([refreshScopes.uiShell()])
    }
  }

  async function deleteWorkspaceEditor(workspaceIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return false
    const workspaceId = text(workspaceIdRaw)
    if (!workspaceId) return false
    // 删除动作一开始就换代：在途工作区列表 / 会话加载不得把旧事实写回。
    onWorkspaceDeleted?.(workspaceId)
    workspaceListSeq += 1
    try {
      await deleteWorkspace(requireNetRequest(), workspaceId)
      cleanupFavoriteRefsForTarget?.('workspace', workspaceId)
      await refreshWorkspaces()
      if (text((state.draft as any)?.activeWorkspaceId) === workspaceId) {
        ;(state.draft as any).activeWorkspaceId = text((state.data as any)?.workspaces?.[0]?.id)
      }
      showToast?.('工作区已删除', { kind: 'success' })
      activateComposerDraftForCurrentSession(state)
      notifyScopes([refreshScopes.entities('workspaces'), refreshScopes.navigation(), refreshScopes.uiShell()])
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '工作区删除失败'), { kind: 'error' })
      notifyScopes([refreshScopes.entities('workspaces'), refreshScopes.navigation(), refreshScopes.uiShell()])
      return false
    }
  }

  function createChatForActiveWorkspace() {
    const state = getState()
    const workspace = activeWorkspace()
    const role = activeRole()
    if (!workspace) return showToast?.('请先选择工作区', { kind: 'error' })
    if (!role) {
      const hasRegisteredRoles = workspaceRolesInScope(workspace, state?.data?.roles).length > 0
      return showToast?.(hasRegisteredRoles ? '请先选择角色' : '当前工作区还没有注册角色，请先注册角色', { kind: 'error' })
    }
    const pending = createPendingChatEntry('workspace', text((workspace as any).id), '工作区会话', text((role as any).id))
    if (!pending) return
    saveActiveComposerDraftMirror(state)
    state.pendingChat = null
    state.pendingGroupChat = null
    ;(state as any).pendingWorkspaceChat = pending
    state.branchDraft = null
    state.sideTab = 'chats'
    activateComposerDraftForCurrentSession(state)
    notifyWorkspaceChatCreated(text((workspace as any).id))
    scrollToBottomSoon()
  }

  async function pickChatForActiveWorkspace(chatIdRaw: unknown) {
    const state = getState()
    const workspace = activeWorkspace()
    const role = activeRole()
    if (!workspace || !state?.data) return
    const workspaceId = text((workspace as any).id)
    const roleId = text(role?.id || '')
    const chatId = text(chatIdRaw)
    if (!workspaceId || !chatId) return
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    saveActiveComposerDraftMirror(state)
    clearPendingChatForTarget(state, 'workspace', workspaceId)
    clearPendingChatForTarget(state, 'workspace', targetId)
    let box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return
    if (!boxHasChatRef(box, chatId)) {
      await refreshActiveWorkspaceChats(workspaceId).catch(() => null)
      box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
      if (!box || !boxHasChatRef(box, chatId)) return
    }
    writeActiveChatSelection(box, chatId)
    notifyWorkspaceChatSelected(targetId, chatId)
    const requestToken = sessionWrites?.capture('workspace', targetId, chatId) || null
    const chat = await ensureWorkspaceChatLoaded(workspaceId, roleId, chatId).catch(() => null)
    // 会话被删除：旧加载结果不得继续驱动选中 / 草稿 / 渲染。
    if (sessionWrites && !sessionWrites.isCurrent(requestToken)) return
    // 用户在等待期间切到了别的工作区 / 角色：这次选择的落点已经失效。
    if (!isActiveWorkspaceRole(state, activeRole, workspaceId, roleId)) return
    if (text(chat?.roleId)) state.draft.activeRoleId = text(chat?.roleId)
    activateComposerDraftForCurrentSession(state)
    saveMeta().catch(() => {})
    notifyWorkspaceChatLoaded(targetId, chatId)
    scrollToBottomSoon()
  }

  async function renameWorkspaceChatTitle(workspaceIdRaw: unknown, roleIdRaw: unknown, chatIdRaw: unknown, title: unknown) {
    const state = getState()
    if (!state?.data) return false
    const workspaceId = text(workspaceIdRaw)
    const roleId = text(roleIdRaw)
    const chatId = text(chatIdRaw)
    if (!workspaceId || !roleId || !chatId) return false
    let nextTitle = text(title).replace(/\s+/g, ' ').trim()
    if (nextTitle.length > 80) nextTitle = nextTitle.slice(0, 80).trim()
    nextTitle = nextTitle || '工作区会话'
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    const writeToken = sessionWrites?.capture('workspace', targetId, chatId) || null
    try {
      await updateWorkspaceSessionTitle(requireNetRequest(), { workspaceId, roleId, sessionId: chatId, title: nextTitle })
      if (sessionWrites && !sessionWrites.isCurrent(writeToken)) return false
      const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
      if (!box) return false
      const chat = (Array.isArray(box.chats) ? box.chats : []).find((item: any) => text(item?.id) === chatId) || null
      if (chat) {
        chat.title = nextTitle
        chat.updatedAt = now()
        writeChatListProjection(box, { kind: 'upsertMeta', meta: chatMetaFromChat(chat, '工作区会话'), fallbackTitle: '工作区会话' })
      } else {
        const old = (Array.isArray(box.chatMetas) ? box.chatMetas : []).find((item: any) => text(item?.id) === chatId) || null
        writeChatListProjection(box, {
          kind: 'upsertMeta',
          fallbackTitle: '工作区会话',
          meta: { id: chatId, title: nextTitle, createdAt: Number(old?.createdAt || now()), updatedAt: now(), lastMessagePreview: String(old?.lastMessagePreview || ''), messageCount: Number(old?.messageCount || 0), hasPending: !!old?.hasPending },
        })
      }
      notifyScopes([refreshScopes.chatList('workspace', targetId)])
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '工作区会话标题保存失败'), { kind: 'error' })
      notifyScopes([refreshScopes.chatList('workspace', targetId)])
      return false
    }
  }

  async function deleteChatForWorkspace(workspaceIdRaw: unknown, roleIdRaw: unknown, chatIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return false
    const workspaceId = text(workspaceIdRaw)
    const roleId = text(roleIdRaw)
    const chatId = text(chatIdRaw)
    if (!workspaceId || !roleId || !chatId) return false
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    if (activeEbRunCardsForTarget(state, 'workspace', targetId, chatId).length > 0) {
      showToast?.('该工作区会话有真实运行中的任务，不能删除', { kind: 'error' })
      return false
    }
    // 先换代再删本地：在途会话体与列表刷新落地时都会被判成旧代。
    onChatDeleted?.('workspace', targetId, chatId)
    supersedeWorkspaceChatList(workspaceId, roleId)
    const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return false
    writeChatListProjection(box, { kind: 'remove', chatId, fallbackTitle: '工作区会话' })
    if (readActiveChatSelection(box) === chatId) writeActiveChatSelection(box, firstChatIdInBox(box))
    removeLoadedChat?.('workspace', targetId, chatId)
    try {
      await deleteWorkspaceSession(requireNetRequest(), workspaceId, roleId, chatId)
      cleanupFavoriteRefsForChat?.('workspace', workspaceId, roleId, chatId)
      saveMeta().catch(() => {})
      notifyScopes([refreshScopes.navigation(), refreshScopes.chatList('workspace', targetId)])
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '删除工作区会话失败'), { kind: 'error' })
      notifyScopes([refreshScopes.navigation(), refreshScopes.chatList('workspace', targetId)])
      return false
    }
  }

  return {
    refreshWorkspaces,
    refreshActiveWorkspaceChats,
    ensureWorkspaceChatLoaded,
    ensureActiveWorkspaceChatLoaded,
    upsertWorkspaceChat,
    setActiveWorkspace,
    setWorkspaceRole,
    moveWorkspace,
    openNewWorkspaceEditor,
    openNewWorkspaceEditorInPlace,
    openWorkspaceEditor,
    openWorkspaceEditorInPlace,
    addWorkspaceDirectory,
    removeWorkspaceDirectory,
    setWorkspaceDirectoryField,
    setWorkspaceRoleRegistered,
    refreshWorkspacePromptPreview,
    saveWorkspaceEditor,
    deleteWorkspaceEditor,
    createChatForActiveWorkspace,
    pickChatForActiveWorkspace,
    renameWorkspaceChatTitle,
    deleteChatForWorkspace,
  }
}