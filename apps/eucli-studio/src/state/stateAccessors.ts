import { chatMetasFromBox } from '../domain/chatMeta'
import { normalizeChatModelOverride } from '../domain/modelRefUtils'
import { normalizeRoleToolPolicy } from '../domain/toolPolicy'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'

function ensureBoxShape(box: any, fallbackTitle: string) {
  if (!box || typeof box !== 'object') return { activeChatId: '', chatMetas: [], chats: [] }
  if (!Array.isArray(box.chats)) box.chats = []
  box.chatMetas = chatMetasFromBox(box, fallbackTitle)
  box.activeChatId = String(box.activeChatId || '')
  return box
}

function chatIdExistsInBox(box: any, chatId: any) {
  const cid = String(chatId || '').trim()
  if (!cid) return false
  const chats = Array.isArray(box?.chats) ? box.chats : []
  if (chats.some((c: any) => String(c?.id || '') === cid)) return true
  const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
  return metas.some((m: any) => String(m?.id || '') === cid)
}

function firstChatIdInBox(box: any) {
  const metas = Array.isArray(box?.chatMetas) ? box.chatMetas : []
  const firstMeta = metas.map((m: any) => String(m?.id || '')).find(Boolean)
  if (firstMeta) return firstMeta
  const chats = Array.isArray(box?.chats) ? box.chats : []
  return String(chats[0]?.id || '')
}

export function createStateAccessors(deps: {
  getState: () => any
}) {
  const { getState } = deps

  function getProvider(providerId: any) {
    const s = getState()
    const ps = s.data?.settings?.providers
    if (!Array.isArray(ps)) return null
    return ps.find((p: any) => String(p?.id) === String(providerId)) || null
  }

  function getRoleById(roleId: any) {
    const rid = String(roleId || '').trim()
    if (!rid) return null
    const s = getState()
    const roles = s.data?.roles
    if (!Array.isArray(roles)) return null
    return roles.find((r: any) => String(r?.id || '') === rid) || null
  }

  function getGroupById(groupId: any) {
    const gid = String(groupId || '').trim()
    if (!gid) return null
    const s = getState()
    const groups = s.data?.groups
    if (!Array.isArray(groups)) return null
    return groups.find((g: any) => String(g?.id || '') === gid) || null
  }

  function getWorkspaceById(workspaceId: any) {
    const wid = String(workspaceId || '').trim()
    if (!wid) return null
    const s = getState()
    const workspaces = (s.data as any)?.workspaces
    if (!Array.isArray(workspaces)) return null
    return workspaces.find((workspace: any) => String(workspace?.id || '') === wid) || null
  }

  function activeTargetKind() {
    const s = getState()
    const k = String(s.draft?.activeTargetKind || s.data?.ui?.activeTargetKind || 'role').trim()
    if (k === 'group') return 'group'
    if (k === 'workspace') return 'workspace'
    return 'role'
  }

  function activeRole() {
    const s = getState()
    const rid = String(s.draft.activeRoleId || s.data?.ui?.activeRoleId || '')
    return getRoleById(rid)
  }

  function activeGroup() {
    const s = getState()
    const gid = String(s.draft?.activeGroupId || s.data?.ui?.activeGroupId || '')
    return getGroupById(gid)
  }

  function activeWorkspace() {
    const s = getState()
    const wid = String((s.draft as any)?.activeWorkspaceId || (s.data?.ui as any)?.activeWorkspaceId || '')
    return getWorkspaceById(wid)
  }

  function activeWorkspaceRoleId() {
    const s = getState()
    return String(s.draft?.activeRoleId || s.data?.ui?.activeRoleId || '').trim()
  }

  function activeWorkspaceTargetId() {
    const workspace = activeWorkspace()
    return workspaceRoleTargetId((workspace as any)?.id, activeWorkspaceRoleId())
  }

  function activeChatFromData() {
    const s = getState()
    if (!s.data) return null
    const kind = activeTargetKind()
    if (kind === 'group') {
      const g = activeGroup()
      if (!g) return null
      const box = s.data.chatsByGroup?.[String(g.id)]
      if (!box) return null
      const activeChatId = String(box.activeChatId || '')
      const chats = Array.isArray(box.chats) ? box.chats : []
      return chats.find((c: any) => String(c?.id) === activeChatId) || null
    }

    if (kind === 'workspace') {
      const targetId = activeWorkspaceTargetId()
      if (!targetId) return null
      const box = (s.data as any).chatsByWorkspace?.[targetId]
      if (!box) return null
      const activeChatId = String(box.activeChatId || '')
      const chats = Array.isArray(box.chats) ? box.chats : []
      return chats.find((c: any) => String(c?.id) === activeChatId) || null
    }

    const r = activeRole()
    if (!r) return null
    const box = s.data.chatsByRole?.[String(r.id)]
    if (!box) return null
    const activeChatId = String(box.activeChatId || '')
    const chats = Array.isArray(box.chats) ? box.chats : []
    return chats.find((c: any) => String(c?.id) === activeChatId) || null
  }

  function activeChat() {
    const kind = activeTargetKind()
    const s = getState()
    if (kind === 'group') {
      const g = activeGroup()
      const gid = String(g?.id || '')
      const pending = s.pendingGroupChat
      if (pending && String(pending.groupId || '') === gid && pending.chat) return pending.chat
      return activeChatFromData()
    }

    if (kind === 'workspace') {
      const workspace = activeWorkspace()
      const wid = String((workspace as any)?.id || '')
      const rid = activeWorkspaceRoleId()
      const pending = (s as any).pendingWorkspaceChat
      if (pending && String(pending.workspaceId || '') === wid && String(pending.roleId || '') === rid && pending.chat) return pending.chat
      return activeChatFromData()
    }

    const role = activeRole()
    const rid = String(role?.id || '')
    const pending = s.pendingChat
    if (pending && String(pending.roleId || '') === rid && pending.chat) return pending.chat
    return activeChatFromData()
  }

  function clearPendingChat() {
    const s = getState()
    s.pendingChat = null
  }

  function clearPendingGroupChat() {
    const s = getState()
    s.pendingGroupChat = null
  }

  function clearPendingWorkspaceChat() {
    const s = getState()
    ;(s as any).pendingWorkspaceChat = null
  }

  function ensureRoleDefaults(role: any) {
    const s = getState()
    if (!s.data) return
    const fallbackPid = String(s.data.settings.providers?.[0]?.id || '')
    if (!role.modelRef || typeof role.modelRef !== 'object') role.modelRef = { providerId: fallbackPid, modelId: '' }
    if (typeof role.modelRef.kind !== 'string') role.modelRef.kind = String(role.modelRef.groupId || '').trim() ? 'model_group' : 'provider'
    if (typeof role.modelRef.groupId !== 'string') role.modelRef.groupId = ''
    if (String(role.modelRef.kind || '').trim() === 'model_group') role.modelRef.providerId = ''
    else if (!role.modelRef.providerId) role.modelRef.providerId = fallbackPid
    if (typeof role.modelRef.modelId !== 'string') role.modelRef.modelId = ''
    role.toolPolicy = normalizeRoleToolPolicy(role.toolPolicy)
  }

  function ensureGroupsList() {
    const s = getState()
    if (!s.data) return
    if (!Array.isArray(s.data.groups)) s.data.groups = []
    if (!s.data.chatsByGroup || typeof s.data.chatsByGroup !== 'object') s.data.chatsByGroup = {}
  }

  function ensureGroupChatsBoxBare(groupId: any) {
    const s = getState()
    if (!s.data) return null
    ensureGroupsList()
    const gid = String(groupId || '').trim()
    if (!gid) return null
    if (!s.data.chatsByGroup[gid] || typeof s.data.chatsByGroup[gid] !== 'object') s.data.chatsByGroup[gid] = { activeChatId: '', chatMetas: [], chats: [] }
    const box = ensureBoxShape(s.data.chatsByGroup[gid], '群聊')
    if (box.activeChatId && !chatIdExistsInBox(box, box.activeChatId)) box.activeChatId = ''
    if (!box.activeChatId) box.activeChatId = firstChatIdInBox(box)
    return box
  }

  function ensureWorkspaceChatsBoxBare(workspaceId: any, roleId?: any) {
    const s = getState()
    if (!s.data) return null
    const wid = String(workspaceId || '').trim()
    const rid = String(roleId || activeWorkspaceRoleId()).trim()
    const targetId = workspaceRoleTargetId(wid, rid)
    if (!wid || !rid || !targetId) return null
    if (!(s.data as any).chatsByWorkspace || typeof (s.data as any).chatsByWorkspace !== 'object') (s.data as any).chatsByWorkspace = {}
    if (!(s.data as any).chatsByWorkspace[targetId] || typeof (s.data as any).chatsByWorkspace[targetId] !== 'object') (s.data as any).chatsByWorkspace[targetId] = { activeChatId: '', chatMetas: [], chats: [] }
    const box = ensureBoxShape((s.data as any).chatsByWorkspace[targetId], '工作区会话')
    box.workspaceId = wid
    box.roleId = rid
    box.targetId = targetId
    if (box.activeChatId && !chatIdExistsInBox(box, box.activeChatId)) box.activeChatId = ''
    if (!box.activeChatId) box.activeChatId = firstChatIdInBox(box)
    return box
  }

  function ensureGroupChatsBox(groupId: any) {
    return ensureGroupChatsBoxBare(groupId)
  }

  function ensureChatsBox(roleId: any) {
    return ensureChatsBoxBare(roleId)
  }

  function ensureChatsBoxBare(roleId: any) {
    const s = getState()
    if (!s.data) return null
    const rid = String(roleId || '')
    if (!rid) return null
    if (!s.data.chatsByRole || typeof s.data.chatsByRole !== 'object') s.data.chatsByRole = {}
    if (!s.data.chatsByRole[rid] || typeof s.data.chatsByRole[rid] !== 'object') s.data.chatsByRole[rid] = { activeChatId: '', chatMetas: [], chats: [] }
    const box = ensureBoxShape(s.data.chatsByRole[rid], '新聊天')
    if (box.activeChatId && !chatIdExistsInBox(box, box.activeChatId)) box.activeChatId = ''
    if (!box.activeChatId) box.activeChatId = firstChatIdInBox(box)
    return box
  }

  function findChatByIds(roleId: any, chatId: any) {
    const s = getState()
    if (!s.data) return null
    const rid = String(roleId || '')
    const cid = String(chatId || '')
    if (!rid || !cid) return null
    const box = s.data.chatsByRole?.[rid]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    return chats.find((c: any) => String(c?.id || '') === cid) || null
  }

  function findGroupChatByIds(groupId: any, chatId: any) {
    const s = getState()
    if (!s.data) return null
    const gid = String(groupId || '')
    const cid = String(chatId || '')
    if (!gid || !cid) return null
    const box = s.data.chatsByGroup?.[gid]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    return chats.find((c: any) => String(c?.id || '') === cid) || null
  }

  function findWorkspaceChatByIds(workspaceId: any, chatId: any, roleId?: any) {
    const s = getState()
    if (!s.data) return null
    const wid = String(workspaceId || '')
    const rid = String(roleId || activeWorkspaceRoleId()).trim()
    const cid = String(chatId || '')
    const targetId = workspaceRoleTargetId(wid, rid)
    if (!targetId || !cid) return null
    const box = (s.data as any).chatsByWorkspace?.[targetId]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    return chats.find((c: any) => String(c?.id || '') === cid) || null
  }

  function pickChatModelRef(role: any, chat: any) {
    const override = normalizeChatModelOverride(chat)
    if (override) {
      if (override.kind === 'model_group') return { kind: 'model_group', groupId: override.groupId, providerId: '', modelId: override.modelId, overridden: true }
      const provider = getProvider(override.providerId)
      if (provider) return { kind: 'provider', groupId: '', providerId: override.providerId, modelId: override.modelId, overridden: true }
    }

    return {
      kind: String(role?.modelRef?.kind || '').trim() === 'model_group' || String(role?.modelRef?.groupId || '').trim() ? 'model_group' : 'provider',
      groupId: String(role?.modelRef?.groupId || '').trim(),
      providerId: String(role?.modelRef?.providerId || '').trim(),
      modelId: String(role?.modelRef?.modelId || '').trim(),
      overridden: false,
    }
  }

  return {
    getProvider,
    getRoleById,
    getGroupById,
    getWorkspaceById,
    activeTargetKind,
    activeRole,
    activeGroup,
    activeWorkspace,
    activeChatFromData,
    activeChat,
    clearPendingChat,
    clearPendingGroupChat,
    clearPendingWorkspaceChat,
    ensureRoleDefaults,
    ensureGroupsList,
    ensureGroupChatsBoxBare,
    ensureGroupChatsBox,
    ensureWorkspaceChatsBoxBare,
    ensureChatsBox,
    ensureChatsBoxBare,
    findChatByIds,
    findGroupChatByIds,
    findWorkspaceChatByIds,
    pickChatModelRef,
  }
}
