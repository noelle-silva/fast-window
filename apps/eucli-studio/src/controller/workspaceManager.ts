import { now, uid } from '../core/utils'
import { chatMetaFromChat, removeChatMeta, upsertChatMeta } from '../domain/chatMeta'
import { mergeChatFromStorage } from '../domain/chatStorageSync'
import { NEW_WORKSPACE_ID } from '../domain/constants'
import { activeEbRunCardsForTarget } from '../domain/activeRunCards'
import { clearPendingChatForTarget, createPendingChatEntry, pendingChatForTarget } from '../domain/pendingChat'
import { activateComposerDraftForCurrentSession, saveActiveComposerDraftMirror } from '../domain/sessionComposerDrafts'
import { parseWorkspaceRoleTargetId, workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import type { AiChatShowToast } from '../gateway/capabilities'
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

function workspaceBoxTargetId(state: any, activeRole: () => any, workspaceIdRaw: unknown, roleIdRaw?: unknown) {
  return workspaceRoleTargetId(workspaceIdRaw, text(roleIdRaw) || currentWorkspaceRoleId(state, activeRole))
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
  if (!Array.isArray(box.chatMetas)) box.chatMetas = []
  if (!Array.isArray(box.chats)) box.chats = []
  box.workspaceId = workspaceId
  box.roleId = roleId
  box.targetId = targetId
  box.activeChatId = text(box.activeChatId)
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
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
}

function workspaceDraft(state: any): UiWorkspace {
  const editWorkspaceId = text((state.draft as any)?.editWorkspaceId)
  const existing = (Array.isArray((state.data as any)?.workspaces) ? (state.data as any).workspaces : []).find((workspace: any) => text(workspace?.id) === editWorkspaceId) || null
  return {
    id: editWorkspaceId,
    name: text((state.draft as any)?.workspaceName) || '未命名工作区',
    directories: workspaceDraftDirectories((state.draft as any)?.workspaceDirectories).filter((directory) => directory.path || directory.alias || directory.description),
    prompt: String((state.draft as any)?.workspacePrompt ?? ''),
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
  closeModal: () => void
  saveMeta: () => Promise<void>
  scrollToBottomSoon: () => void
  showToast?: AiChatShowToast
  activeTargetKind: () => string
  activeRole: () => any
  activeWorkspace: () => any
  activeChatFromData: () => any
  clearPendingWorkspaceChat: () => void
  removeLoadedChat?: (kind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => void
}) {
  const { getState, netRequest, emit, render, closeModal, saveMeta, scrollToBottomSoon, showToast, activeTargetKind, activeRole, activeWorkspace, activeChatFromData, clearPendingWorkspaceChat, removeLoadedChat } = deps

  function requireNetRequest() {
    if (typeof netRequest !== 'function') throw new Error('工作区请求通道不可用')
    return netRequest
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
    render()
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
      render()
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
    const chatId = text(chatRaw?.id)
    if (!workspaceId || !chatId) return null
    const box = ensureWorkspaceBox(state, activeRole, workspaceId, chatRaw?.roleId)
    if (!box) return null
    const index = (Array.isArray(box.chats) ? box.chats : []).findIndex((chat: any) => text(chat?.id) === chatId)
    const nextChat = mergeChatFromStorage(chatRaw, index >= 0 ? box.chats[index] : null)
    if (index >= 0) box.chats[index] = nextChat
    else box.chats.unshift(nextChat)
    box.chatMetas = upsertChatMeta(box.chatMetas, chatMetaFromChat(nextChat, '工作区会话'), '工作区会话')
    if (!box.activeChatId) box.activeChatId = chatId
    return nextChat
  }

  async function refreshActiveWorkspaceChats(workspaceIdRaw?: unknown) {
    const state = getState()
    if (!state?.data) return null
    const workspaceId = text(workspaceIdRaw) || text(activeWorkspace()?.id || (state.draft as any)?.activeWorkspaceId || (state.data.ui as any)?.activeWorkspaceId)
    if (!workspaceId) return null
    const request = requireNetRequest()
    const roleId = currentWorkspaceRoleId(state, activeRole)
    const summaries = await listWorkspaceSessionSummaries(request, workspaceId, roleId)
    const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return null
    const metas = summaries.map(workspaceSessionSummaryToMeta).filter(Boolean)
    const metaIds = new Set(metas.map((meta: any) => text(meta?.id)).filter(Boolean))
    box.chatMetas = metas
    box.chats = (Array.isArray(box.chats) ? box.chats : []).filter((chat: any) => metaIds.has(text(chat?.id)))
    if (box.activeChatId && !metaIds.has(text(box.activeChatId))) box.activeChatId = ''
    if (!box.activeChatId) box.activeChatId = text(metas[0]?.id || box.chats[0]?.id)
    return box
  }

  async function refreshWorkspaces(preferredWorkspaceId?: string) {
    const state = getState()
    if (!state?.data) return []
    const request = requireNetRequest()
    const workspaces = await listWorkspacesDetailed(request)
    const next = syncWorkspaceListToState(workspaces, preferredWorkspaceId)
    const activeWorkspaceId = text((state.draft as any)?.activeWorkspaceId)
    if (activeWorkspaceId) await refreshActiveWorkspaceChats(activeWorkspaceId).catch(() => null)
    return next
  }

  async function ensureWorkspaceChatLoaded(workspaceIdRaw: unknown, chatIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return null
    const workspaceId = text(workspaceIdRaw)
    const chatId = text(chatIdRaw)
    if (!workspaceId || !chatId) return null
    const roleId = currentWorkspaceRoleId(state, activeRole)
    const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return null
    const existing = (Array.isArray(box.chats) ? box.chats : []).find((chat: any) => text(chat?.id) === chatId && !chat?.runtimePartial) || null
    if (existing) {
      if (text(existing.roleId)) state.draft.activeRoleId = text(existing.roleId)
      return existing
    }
    const request = requireNetRequest()
    const chat = await loadWorkspaceSession(request, workspaceId, roleId, chatId)
    if (!chat) return null
    upsertWorkspaceChat(workspaceId, chat)
    if (text(chat.roleId)) state.draft.activeRoleId = text(chat.roleId)
    return chat
  }

  async function ensureActiveWorkspaceChatLoaded() {
    const state = getState()
    if (!state?.data || activeTargetKind() !== 'workspace') return null
    const workspaceId = text(activeWorkspace()?.id || (state.draft as any)?.activeWorkspaceId || (state.data.ui as any)?.activeWorkspaceId)
    if (!workspaceId) return null
    const pendingChat = pendingChatForTarget(state, 'workspace', workspaceRoleTargetId(workspaceId, currentWorkspaceRoleId(state, activeRole)))
    if (pendingChat) return pendingChat
    const box = ensureWorkspaceBox(state, activeRole, workspaceId)
    if (!box) return null
    if (!Array.isArray(box.chatMetas) || !box.chatMetas.length) await refreshActiveWorkspaceChats(workspaceId).catch(() => null)
    const ids = [text(box.activeChatId), ...(Array.isArray(box.chatMetas) ? box.chatMetas.map((meta: any) => text(meta?.id)) : [])]
      .filter((id, index, list) => !!id && list.indexOf(id) === index)
    for (const chatId of ids) {
      box.activeChatId = chatId
      const chat = await ensureWorkspaceChatLoaded(workspaceId, chatId)
      if (chat) return chat
    }
    box.activeChatId = ''
    return null
  }

  function setActiveWorkspace(workspaceIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return
    const workspaceId = text(workspaceIdRaw)
    if (!workspaceId) return
    saveActiveComposerDraftMirror(state)
    state.branchDraft = null
    ;(state.draft as any).activeTargetKind = 'workspace'
    ;(state.draft as any).activeWorkspaceId = workspaceId
    if (!text(state.draft.activeRoleId)) state.draft.activeRoleId = firstRoleId(state)
    ensureWorkspaceBox(state, activeRole, workspaceId)
    activateComposerDraftForCurrentSession(state)
    refreshActiveWorkspaceChats(workspaceId).catch(() => null).finally(() => {
      ensureActiveWorkspaceChatLoaded().catch(() => null).finally(() => emit())
    })
    saveMeta().catch(() => {})
    emit()
  }

  function setWorkspaceRole(roleIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return
    const roleId = text(roleIdRaw)
    if (!roleId) return
    saveActiveComposerDraftMirror(state)
    state.branchDraft = null
    state.draft.activeRoleId = roleId
    const workspaceId = text(activeWorkspace()?.id || (state.draft as any)?.activeWorkspaceId || (state.data.ui as any)?.activeWorkspaceId)
    const currentChat = workspaceId ? pendingChatForTarget(state, 'workspace', workspaceRoleTargetId(workspaceId, roleId)) || activeChatFromData() : null
    const currentRoleId = text((currentChat as any)?.roleId)
    if (workspaceId && currentChat && currentRoleId && currentRoleId !== roleId) {
      const pending = createPendingChatEntry('workspace', workspaceId, '工作区会话', roleId)
      if (pending) {
        state.pendingChat = null
        state.pendingGroupChat = null
        ;(state as any).pendingWorkspaceChat = pending
        state.sideTab = 'chats'
      }
    }
    activateComposerDraftForCurrentSession(state)
    saveMeta().catch(() => {})
    emit()
  }

  function openNewWorkspaceEditor() {
    const state = getState()
    if (!state?.data) return
    ;(state.draft as any).editWorkspaceId = NEW_WORKSPACE_ID
    ;(state.draft as any).workspaceName = '新工作区'
    ;(state.draft as any).workspacePrompt = ''
    ;(state.draft as any).workspaceDirectories = [{ path: '', alias: '', description: '' }]
    ;(state.draft as any).workspaceActualPrompt = ''
    ;(state.draft as any).workspaceActualPromptLoading = false
    ;(state.draft as any).workspaceActualPromptStale = true
    ;(state.draft as any).workspaceActualPromptError = ''
    state.modal = 'workspace'
    render()
    refreshWorkspacePromptPreview().catch(() => null)
  }

  function openWorkspaceEditor(workspaceIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return
    const workspaceId = text(workspaceIdRaw)
    const workspace = (Array.isArray((state.data as any).workspaces) ? (state.data as any).workspaces : []).find((item: any) => text(item?.id) === workspaceId) || null
    if (!workspace) return
    ;(state.draft as any).editWorkspaceId = workspaceId
    ;(state.draft as any).workspaceName = text(workspace.name)
    ;(state.draft as any).workspacePrompt = String(workspace.prompt ?? '')
    ;(state.draft as any).workspaceDirectories = workspace.directories?.length
      ? workspace.directories.map((directory: any) => ({ path: text(directory?.path), alias: text(directory?.alias), description: text(directory?.description) }))
      : [{ path: '', alias: '', description: '' }]
    ;(state.draft as any).workspaceActualPrompt = String(workspace.actualPrompt ?? '')
    ;(state.draft as any).workspaceActualPromptLoading = false
    ;(state.draft as any).workspaceActualPromptStale = false
    ;(state.draft as any).workspaceActualPromptError = ''
    state.modal = 'workspace'
    render()
  }

  function addWorkspaceDirectory() {
    const state = getState()
    const current = workspaceDraftDirectories((state.draft as any)?.workspaceDirectories)
    ;(state.draft as any).workspaceDirectories = current.concat({ path: '', alias: '', description: '' })
    markWorkspacePromptPreviewStale()
    emit()
  }

  function removeWorkspaceDirectory(indexRaw: unknown) {
    const state = getState()
    const index = Math.max(0, Math.floor(Number(indexRaw || 0)))
    const current = workspaceDraftDirectories((state.draft as any)?.workspaceDirectories)
    const next = current.filter((_, currentIndex) => currentIndex !== index)
    ;(state.draft as any).workspaceDirectories = next.length ? next : [{ path: '', alias: '', description: '' }]
    markWorkspacePromptPreviewStale()
    emit()
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
    emit()
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
      actualPrompt: '',
      directories,
      createdAt: Number(existing?.createdAt || now()),
      updatedAt: now(),
    }
    try {
      await saveWorkspace(requireNetRequest(), nextWorkspace)
      await refreshWorkspaces(workspaceId)
      ;(state.draft as any).activeTargetKind = 'workspace'
      ;(state.draft as any).activeWorkspaceId = workspaceId
      if (!text(state.draft.activeRoleId)) state.draft.activeRoleId = firstRoleId(state)
      saveMeta().catch(() => {})
      showToast?.(isNew ? '工作区已创建' : '工作区已保存', { kind: 'success' })
      closeModal()
      emit()
    } catch (e: any) {
      showToast?.(String(e?.message || e || '工作区保存失败'), { kind: 'error' })
      render()
    }
  }

  async function deleteWorkspaceEditor(workspaceIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return false
    const workspaceId = text(workspaceIdRaw)
    if (!workspaceId) return false
    try {
      await deleteWorkspace(requireNetRequest(), workspaceId)
      await refreshWorkspaces()
      if (text((state.draft as any)?.activeWorkspaceId) === workspaceId) {
        ;(state.draft as any).activeWorkspaceId = text((state.data as any)?.workspaces?.[0]?.id)
      }
      showToast?.('工作区已删除', { kind: 'success' })
      render()
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '工作区删除失败'), { kind: 'error' })
      render()
      return false
    }
  }

  function createChatForActiveWorkspace() {
    const state = getState()
    const workspace = activeWorkspace()
    const role = activeRole()
    if (!workspace) return showToast?.('请先选择工作区', { kind: 'error' })
    if (!role) return showToast?.('请先选择角色', { kind: 'error' })
    const pending = createPendingChatEntry('workspace', text((workspace as any).id), '工作区会话', text((role as any).id))
    if (!pending) return
    saveActiveComposerDraftMirror(state)
    state.pendingChat = null
    state.pendingGroupChat = null
    ;(state as any).pendingWorkspaceChat = pending
    state.branchDraft = null
    state.sideTab = 'chats'
    activateComposerDraftForCurrentSession(state)
    render()
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
    saveActiveComposerDraftMirror(state)
    clearPendingChatForTarget(state, 'workspace', workspaceId)
    clearPendingChatForTarget(state, 'workspace', workspaceRoleTargetId(workspaceId, roleId))
    let box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return
    if (!boxHasChatRef(box, chatId)) {
      await refreshActiveWorkspaceChats(workspaceId).catch(() => null)
      box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
      if (!box || !boxHasChatRef(box, chatId)) return
    }
    box.activeChatId = chatId
    const chat = await ensureWorkspaceChatLoaded(workspaceId, chatId).catch(() => null)
    if (text(chat?.roleId)) state.draft.activeRoleId = text(chat?.roleId)
    activateComposerDraftForCurrentSession(state)
    saveMeta().catch(() => {})
    render()
    scrollToBottomSoon()
  }

  async function renameWorkspaceChatTitle(workspaceIdRaw: unknown, chatIdRaw: unknown, title: unknown) {
    const state = getState()
    if (!state?.data) return false
    const workspaceId = text(workspaceIdRaw)
    const chatId = text(chatIdRaw)
    if (!workspaceId || !chatId) return false
    let nextTitle = text(title).replace(/\s+/g, ' ').trim()
    if (nextTitle.length > 80) nextTitle = nextTitle.slice(0, 80).trim()
    nextTitle = nextTitle || '工作区会话'
    try {
      await updateWorkspaceSessionTitle(requireNetRequest(), { workspaceId, roleId: currentWorkspaceRoleId(state, activeRole), sessionId: chatId, title: nextTitle })
      const roleId = currentWorkspaceRoleId(state, activeRole)
      const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
      if (!box) return false
      const chat = (Array.isArray(box.chats) ? box.chats : []).find((item: any) => text(item?.id) === chatId) || null
      if (chat) {
        chat.title = nextTitle
        chat.updatedAt = now()
        box.chatMetas = upsertChatMeta(box.chatMetas, chatMetaFromChat(chat, '工作区会话'), '工作区会话')
      } else {
        box.chatMetas = upsertChatMeta(box.chatMetas, { id: chatId, title: nextTitle, createdAt: now(), updatedAt: now(), lastMessagePreview: '', messageCount: 0, hasPending: false }, '工作区会话')
      }
      render()
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '工作区会话标题保存失败'), { kind: 'error' })
      render()
      return false
    }
  }

  async function deleteChatForWorkspace(workspaceIdRaw: unknown, chatIdRaw: unknown) {
    const state = getState()
    if (!state?.data) return false
    const workspaceId = text(workspaceIdRaw)
    const chatId = text(chatIdRaw)
    if (!workspaceId || !chatId) return false
    const roleId = currentWorkspaceRoleId(state, activeRole)
    const targetId = workspaceBoxTargetId(state, activeRole, workspaceId, roleId)
    if (activeEbRunCardsForTarget(state, 'workspace', targetId, chatId).length > 0) {
      showToast?.('该工作区会话有真实运行中的任务，不能删除', { kind: 'error' })
      return false
    }
    const box = ensureWorkspaceBox(state, activeRole, workspaceId, roleId)
    if (!box) return false
    box.chats = (Array.isArray(box.chats) ? box.chats : []).filter((chat: any) => text(chat?.id) !== chatId)
    box.chatMetas = removeChatMeta(box.chatMetas, chatId, '工作区会话')
    if (text(box.activeChatId) === chatId) box.activeChatId = text(box.chatMetas[0]?.id || box.chats[0]?.id)
    removeLoadedChat?.('workspace', targetId, chatId)
    try {
      await deleteWorkspaceSession(requireNetRequest(), workspaceId, roleId, chatId)
      saveMeta().catch(() => {})
      render()
      return true
    } catch (e: any) {
      showToast?.(String(e?.message || e || '删除工作区会话失败'), { kind: 'error' })
      render()
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
    openNewWorkspaceEditor,
    openWorkspaceEditor,
    addWorkspaceDirectory,
    removeWorkspaceDirectory,
    setWorkspaceDirectoryField,
    refreshWorkspacePromptPreview,
    saveWorkspaceEditor,
    deleteWorkspaceEditor,
    createChatForActiveWorkspace,
    pickChatForActiveWorkspace,
    renameWorkspaceChatTitle,
    deleteChatForWorkspace,
  }
}
