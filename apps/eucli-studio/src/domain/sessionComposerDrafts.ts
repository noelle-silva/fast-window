import { workspaceRoleTargetId } from './workspaceRoleTarget'

export type ComposerDraftTargetKind = 'role' | 'group' | 'workspace'

export type ComposerDraftAddress = {
  kind: ComposerDraftTargetKind
  targetId: string
  mode: 'session' | 'pending' | 'new'
  chatId: string
}

export type SessionComposerDraft = {
  input: string
  images: any[]
  files: any[]
}

const NEW_CHAT_ID = '__new__'

function text(value: unknown) {
  return String(value || '').trim()
}

function activeTargetKind(state: any): ComposerDraftTargetKind {
  const kind = text(state?.draft?.activeTargetKind || state?.data?.ui?.activeTargetKind)
  if (kind === 'group') return 'group'
  if (kind === 'workspace') return 'workspace'
  return 'role'
}

function activeTargetId(state: any, kind: ComposerDraftTargetKind) {
  return kind === 'group'
    ? text(state?.draft?.activeGroupId || state?.data?.ui?.activeGroupId)
    : kind === 'workspace'
      ? workspaceRoleTargetId(state?.draft?.activeWorkspaceId || state?.data?.ui?.activeWorkspaceId, state?.draft?.activeRoleId || state?.data?.ui?.activeRoleId)
      : text(state?.draft?.activeRoleId || state?.data?.ui?.activeRoleId)
}

export function composerDraftAddressFor(kind: ComposerDraftTargetKind, targetIdRaw: unknown, mode: ComposerDraftAddress['mode'], chatIdRaw?: unknown): ComposerDraftAddress | null {
  const targetId = text(targetIdRaw)
  if (!targetId) return null
  const chatId = text(chatIdRaw) || NEW_CHAT_ID
  return { kind, targetId, mode, chatId }
}

export function activeComposerDraftAddress(state: any): ComposerDraftAddress | null {
  if (!state?.data) return null
  const kind = activeTargetKind(state)
  const targetId = activeTargetId(state, kind)
  if (!targetId) return null

  const pending = kind === 'group' ? state.pendingGroupChat : kind === 'workspace' ? state.pendingWorkspaceChat : state.pendingChat
  const pendingTargetId = kind === 'group' ? text(pending?.groupId) : kind === 'workspace' ? workspaceRoleTargetId(pending?.workspaceId, pending?.roleId) : text(pending?.roleId)
  const pendingChatId = text(pending?.chat?.id)
  if (pending && pendingTargetId === targetId && pendingChatId) return composerDraftAddressFor(kind, targetId, 'pending', pendingChatId)

  const box = kind === 'group' ? state.data?.chatsByGroup?.[targetId] : kind === 'workspace' ? state.data?.chatsByWorkspace?.[targetId] : state.data?.chatsByRole?.[targetId]
  const chatId = text(box?.activeChatId)
  return composerDraftAddressFor(kind, targetId, chatId ? 'session' : 'new', chatId || NEW_CHAT_ID)
}

export function composerDraftKey(address: ComposerDraftAddress | null | undefined) {
  if (!address) return ''
  return `${address.kind}:${address.targetId}:${address.mode}:${address.chatId}`
}

export function activeComposerDraftKey(state: any) {
  return composerDraftKey(activeComposerDraftAddress(state))
}

function emptyComposerDraft(): SessionComposerDraft {
  return { input: '', images: [], files: [] }
}

function normalizeComposerDraft(value: any): SessionComposerDraft {
  const draft = value && typeof value === 'object' ? value : emptyComposerDraft()
  draft.input = String(draft.input || '')
  if (!Array.isArray(draft.images)) draft.images = []
  if (!Array.isArray(draft.files)) draft.files = []
  return draft as SessionComposerDraft
}

function ensureComposerDraftStore(state: any): Record<string, SessionComposerDraft> {
  if (!state || typeof state !== 'object') return {}
  if (!state.sessionComposerDrafts || typeof state.sessionComposerDrafts !== 'object') state.sessionComposerDrafts = {}
  return state.sessionComposerDrafts as Record<string, SessionComposerDraft>
}

function mirrorDraftFromState(state: any): SessionComposerDraft {
  const draft = state?.draft && typeof state.draft === 'object' ? state.draft : {}
  return {
    input: String((draft as any).input || ''),
    images: Array.isArray((draft as any).images) ? (draft as any).images : [],
    files: Array.isArray((draft as any).files) ? (draft as any).files : [],
  }
}

function assignMirrorDraft(state: any, draftRaw: SessionComposerDraft) {
  if (!state || typeof state !== 'object') return
  if (!state.draft || typeof state.draft !== 'object') state.draft = {}
  const draft = normalizeComposerDraft(draftRaw)
  state.draft.input = draft.input
  state.draft.images = draft.images
  state.draft.files = draft.files
}

function hasComposerDraftContent(draft: SessionComposerDraft) {
  return !!String(draft.input || '').trim() || draft.images.length > 0 || draft.files.length > 0
}

function ensureDraftForKey(state: any, key: string) {
  const store = ensureComposerDraftStore(state)
  store[key] = normalizeComposerDraft(store[key])
  return store[key]
}

export function saveActiveComposerDraftMirror(state: any) {
  const key = text(state?.activeSessionComposerDraftKey)
  if (!key) return null
  const store = ensureComposerDraftStore(state)
  store[key] = normalizeComposerDraft(mirrorDraftFromState(state))
  return store[key]
}

export function activateComposerDraftForCurrentSession(state: any) {
  const nextKey = activeComposerDraftKey(state)
  const prevKey = text(state?.activeSessionComposerDraftKey)
  if (!nextKey) {
    if (prevKey) saveActiveComposerDraftMirror(state)
    if (state && typeof state === 'object') state.activeSessionComposerDraftKey = ''
    assignMirrorDraft(state, emptyComposerDraft())
    return emptyComposerDraft()
  }

  const store = ensureComposerDraftStore(state)
  if (prevKey && prevKey !== nextKey) saveActiveComposerDraftMirror(state)

  if (!prevKey && !store[nextKey]) {
    const legacyDraft = normalizeComposerDraft(mirrorDraftFromState(state))
    if (hasComposerDraftContent(legacyDraft)) store[nextKey] = legacyDraft
  }

  const draft = ensureDraftForKey(state, nextKey)
  state.activeSessionComposerDraftKey = nextKey
  assignMirrorDraft(state, draft)
  return draft
}

export function readActiveComposerDraft(state: any): SessionComposerDraft {
  const key = activeComposerDraftKey(state)
  if (!key) return emptyComposerDraft()
  const store = ensureComposerDraftStore(state)
  if (store[key]) return normalizeComposerDraft(store[key])
  if (text(state?.activeSessionComposerDraftKey) === key) return normalizeComposerDraft(mirrorDraftFromState(state))
  return emptyComposerDraft()
}

export function readComposerDraftByKey(state: any, keyRaw: unknown): SessionComposerDraft {
  const key = text(keyRaw)
  if (!key) return emptyComposerDraft()
  const store = ensureComposerDraftStore(state)
  return normalizeComposerDraft(store[key])
}

export function setComposerDraftFilesByKey(state: any, keyRaw: unknown, files: any[]) {
  const key = text(keyRaw)
  if (!key) return emptyComposerDraft()
  const store = ensureComposerDraftStore(state)
  const draft = normalizeComposerDraft(store[key])
  draft.files = Array.isArray(files) ? files : []
  store[key] = draft
  if (text(state?.activeSessionComposerDraftKey) === key) assignMirrorDraft(state, draft)
  return draft
}

export function setComposerDraftImagesByKey(state: any, keyRaw: unknown, images: any[]) {
  const key = text(keyRaw)
  if (!key) return emptyComposerDraft()
  const store = ensureComposerDraftStore(state)
  const draft = normalizeComposerDraft(store[key])
  draft.images = Array.isArray(images) ? images : []
  store[key] = draft
  if (text(state?.activeSessionComposerDraftKey) === key) assignMirrorDraft(state, draft)
  return draft
}

export function setActiveComposerInput(state: any, input: unknown) {
  const draft = activateComposerDraftForCurrentSession(state)
  draft.input = String(input ?? '')
  assignMirrorDraft(state, draft)
  return draft
}

export function setActiveComposerImages(state: any, images: any[]) {
  const draft = activateComposerDraftForCurrentSession(state)
  draft.images = Array.isArray(images) ? images : []
  assignMirrorDraft(state, draft)
  return draft
}

export function setActiveComposerFiles(state: any, files: any[]) {
  const draft = activateComposerDraftForCurrentSession(state)
  draft.files = Array.isArray(files) ? files : []
  assignMirrorDraft(state, draft)
  return draft
}

export function clearActiveComposerDraft(state: any) {
  const draft = activateComposerDraftForCurrentSession(state)
  draft.input = ''
  draft.images = []
  draft.files = []
  assignMirrorDraft(state, draft)
  return draft
}

export function clearComposerDraftByKey(state: any, keyRaw: unknown) {
  const key = text(keyRaw)
  if (!key) return
  const store = ensureComposerDraftStore(state)
  store[key] = emptyComposerDraft()
  if (text(state?.activeSessionComposerDraftKey) === key) assignMirrorDraft(state, store[key])
}
