import { now, uid } from '../core/utils'
import { createDefaultChatBranching } from '../domain/branching'

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

  function activeTargetKind() {
    const s = getState()
    const k = String(s.draft?.activeTargetKind || s.data?.ui?.activeTargetKind || 'role').trim()
    return k === 'group' ? 'group' : 'role'
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
      return chats.find((c: any) => String(c?.id) === activeChatId) || chats[0] || null
    }

    const r = activeRole()
    if (!r) return null
    const box = s.data.chatsByRole?.[String(r.id)]
    if (!box) return null
    const activeChatId = String(box.activeChatId || '')
    const chats = Array.isArray(box.chats) ? box.chats : []
    return chats.find((c: any) => String(c?.id) === activeChatId) || chats[0] || null
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

  function ensureRoleDefaults(role: any) {
    const s = getState()
    if (!s.data) return
    const fallbackPid = String(s.data.settings.providers?.[0]?.id || '')
    if (!role.modelRef || typeof role.modelRef !== 'object') role.modelRef = { providerId: fallbackPid, modelId: '' }
    if (!role.modelRef.providerId) role.modelRef.providerId = fallbackPid
    if (typeof role.modelRef.modelId !== 'string') role.modelRef.modelId = ''
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
    if (!s.data.chatsByGroup[gid] || typeof s.data.chatsByGroup[gid] !== 'object') s.data.chatsByGroup[gid] = { activeChatId: '', chats: [] }
    const box = s.data.chatsByGroup[gid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (box.activeChatId && !box.chats.some((c: any) => String(c?.id || '') === box.activeChatId)) box.activeChatId = ''
    if (!box.activeChatId && box.chats.length) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function ensureGroupChatsBox(groupId: any) {
    const s = getState()
    if (!s.data) return null
    ensureGroupsList()
    const gid = String(groupId || '').trim()
    if (!gid) return null
    if (!s.data.chatsByGroup[gid] || typeof s.data.chatsByGroup[gid] !== 'object') s.data.chatsByGroup[gid] = { activeChatId: '', chats: [] }
    const box = s.data.chatsByGroup[gid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (!box.chats.length) {
      const cid = uid('gc')
      const t = now()
      box.chats = [{ id: cid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
      box.activeChatId = cid
    }
    if (!box.activeChatId || !box.chats.some((c: any) => String(c?.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function ensureChatsBox(roleId: any) {
    const s = getState()
    if (!s.data) return null
    const rid = String(roleId || '')
    if (!rid) return null
    if (!s.data.chatsByRole || typeof s.data.chatsByRole !== 'object') s.data.chatsByRole = {}
    if (!s.data.chatsByRole[rid] || typeof s.data.chatsByRole[rid] !== 'object') s.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = s.data.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (!box.chats.length) {
      const cid = uid('c')
      const t = now()
      box.chats = [{ id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
      box.activeChatId = cid
    }
    if (!box.activeChatId || !box.chats.some((c: any) => String(c?.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function ensureChatsBoxBare(roleId: any) {
    const s = getState()
    if (!s.data) return null
    const rid = String(roleId || '')
    if (!rid) return null
    if (!s.data.chatsByRole || typeof s.data.chatsByRole !== 'object') s.data.chatsByRole = {}
    if (!s.data.chatsByRole[rid] || typeof s.data.chatsByRole[rid] !== 'object') s.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = s.data.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (box.activeChatId && !box.chats.some((c: any) => String(c?.id) === box.activeChatId)) box.activeChatId = ''
    if (!box.activeChatId && box.chats.length) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function createChatForRole(roleId: any) {
    const rid = String(roleId || '')
    const box = ensureChatsBoxBare(rid)
    if (!box) return null
    const cid = uid('c')
    const t = now()
    const chat = { id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }
    box.chats.unshift(chat)
    box.activeChatId = cid
    return chat
  }

  function createChatForGroup(groupId: any) {
    const gid = String(groupId || '').trim()
    const box = ensureGroupChatsBox(gid)
    if (!box) return null
    const cid = uid('gc')
    const t = now()
    const chat = { id: cid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }
    box.chats.unshift(chat)
    box.activeChatId = cid
    return chat
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

  return {
    getProvider,
    getRoleById,
    getGroupById,
    activeTargetKind,
    activeRole,
    activeGroup,
    activeChatFromData,
    activeChat,
    clearPendingChat,
    clearPendingGroupChat,
    ensureRoleDefaults,
    ensureGroupsList,
    ensureGroupChatsBoxBare,
    ensureGroupChatsBox,
    ensureChatsBox,
    ensureChatsBoxBare,
    createChatForRole,
    createChatForGroup,
    findChatByIds,
    findGroupChatByIds,
  }
}
