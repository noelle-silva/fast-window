import { now, uid } from '../core/utils'
import { VERSION, SPLIT_SCHEMA_VERSION, SPLIT_META_KEY, STICKERS_KEY } from '../domain/constants'
import { chatMetaFromChat, chatMetaIds, chatMetaUpdatedAtMap, chatMetasFromBox, upsertChatMeta } from '../domain/chatMeta'
import { normalizeData, defaultData } from '../domain/dataNormalizers'
import { normalizeFavorites } from '../domain/favorites'
import {
  splitRoleKey,
  splitChatKey,
  splitGroupKey,
  splitGroupChatKey,
  splitChatsIndexKey,
  splitRoleChatIndexKey,
  splitGroupsIndexKey,
  splitGroupChatIndexKey,
  splitProvidersIndexKey,
  splitProviderKey,
  roleFolderName,
  groupFolderName,
  providerFolderName,
} from '../domain/storageKeys'
import { loadProvidersFromStorage, loadSplitMetaSnapshot } from './splitIndexes'

type ChatIndexKind = 'role' | 'group'

let splitMetaCache: any = null
let splitMetaWriteChain: Promise<void> = Promise.resolve()

function mergeChatForConcurrentWrite(localChat: any, storedChat: any) {
  const local = localChat && typeof localChat === 'object' ? localChat : null
  const stored = storedChat && typeof storedChat === 'object' ? storedChat : null
  if (!local || !stored) return localChat

  const out: any = { ...(local as any) }
  const localMsgs: any[] = Array.isArray(local.messages) ? local.messages.slice() : []
  const storedMsgs: any[] = Array.isArray((stored as any).messages) ? (stored as any).messages : []

  const indexById = new Map<string, number>()
  const rebuildIndex = () => {
    indexById.clear()
    for (let i = 0; i < localMsgs.length; i++) {
      const id = String((localMsgs[i] as any)?.id || '').trim()
      if (!id || indexById.has(id)) continue
      indexById.set(id, i)
    }
  }
  rebuildIndex()

  for (const sm of storedMsgs) {
    const sid = String((sm as any)?.id || '').trim()
    if (!sid || indexById.has(sid)) continue
    const pm = String((sm as any)?.parentMid || '').trim()
    if (pm && indexById.has(pm)) {
      localMsgs.splice((indexById.get(pm) as number) + 1, 0, sm)
    } else {
      localMsgs.push(sm)
    }
    rebuildIndex()
  }

  for (const sm of storedMsgs) {
    const sid = String((sm as any)?.id || '').trim()
    if (!sid) continue
    const i = indexById.get(sid)
    if (typeof i !== 'number') continue
    const lm = localMsgs[i]
    if (!lm || typeof lm !== 'object') continue
    const sp = (sm as any)?.pending === true
    const lp = (lm as any)?.pending === true
    if (lp && !sp) localMsgs[i] = sm
  }

  try {
    const lb = out.branching && typeof out.branching === 'object' ? out.branching : null
    const sb = (stored as any).branching && typeof (stored as any).branching === 'object' ? (stored as any).branching : null
    if (lb && sb) {
      const lList: any[] = Array.isArray((lb as any).branches) ? (lb as any).branches.slice() : []
      const sList: any[] = Array.isArray((sb as any).branches) ? (sb as any).branches : []
      const byId = new Map<string, any>()
      for (const b of lList) {
        const id = String(b?.id || '').trim()
        if (id && !byId.has(id)) byId.set(id, b)
      }
      for (const b of sList) {
        const id = String(b?.id || '').trim()
        if (!id) continue
        const cur = byId.get(id) || null
        if (!cur) {
          lList.push(b)
          byId.set(id, b)
          continue
        }
        const lu = Number(cur?.updatedAt || 0)
        const su = Number(b?.updatedAt || 0)
        if (su > lu) {
          cur.headMid = String(b?.headMid || cur.headMid || '')
          cur.updatedAt = su
        } else if (!String(cur?.headMid || '').trim() && String(b?.headMid || '').trim()) {
          cur.headMid = String(b?.headMid || '')
        }
        if (!String(cur?.forkFromMid || '').trim() && String(b?.forkFromMid || '').trim()) cur.forkFromMid = String(b?.forkFromMid || '')
      }
      out.branching = { ...(lb as any), ...(sb as any), branches: lList, activeBranchId: String((lb as any).activeBranchId || (sb as any).activeBranchId || '') }
    } else if (!out.branching && sb) {
      out.branching = sb
    }
  } catch (_) {}

  out.messages = localMsgs
  return out
}

const noop = async () => {}

export function createSplitStorage(deps: {
  storage: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void>; remove: (k: string) => Promise<void> }
  rtStorage?: { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void>; remove: (k: string) => Promise<void> }
  withChatWriteLock?: (kind: any, targetId: any, chatId: any, fn: () => Promise<any>) => Promise<any>
  writeChatUpdatedNotice?: (targetKind: any, targetId: any, chatId: any, updatedAt: any) => Promise<void>
  syncRoleAvatarFile?: (folder: any, role: any) => Promise<void>
  syncGroupAvatarFile?: (folder: any, group: any) => Promise<void>
  getState?: () => any
  setState?: (data: any) => void
  onError?: (msg: string) => void
}) {
  const {
    storage,
    withChatWriteLock: _withChatWriteLock,
    writeChatUpdatedNotice: _writeChatUpdatedNotice,
    syncRoleAvatarFile: _syncRoleAvatarFile = noop,
    syncGroupAvatarFile: _syncGroupAvatarFile = noop,
    getState,
    setState,
    onError,
  } = deps

  const withChatWriteLock = _withChatWriteLock || ((_k, _tid, _cid, fn) => fn())
  const writeChatUpdatedNotice = _writeChatUpdatedNotice || noop

  async function loadSplitMeta() {
    const meta = await loadSplitMetaSnapshot(storage)
    splitMetaCache = meta
    return meta
  }

  function withSplitMetaWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => Promise.resolve().then(fn)
    const p = splitMetaWriteChain.then(run, run) as Promise<T>
    splitMetaWriteChain = p.then(
      () => undefined,
      () => undefined,
    )
    return p
  }

  async function updateChatIndexEntry(kind: ChatIndexKind, targetId: any, chatId: any, patch: { chat?: any; updatedAt?: any; title?: any; remove?: boolean }) {
    const tid = String(targetId || '').trim()
    const cid = String(chatId || '').trim()
    if (!tid || !cid) return
    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) return
      const folder = kind === 'group' ? String((meta as any).groupFolders?.[tid] || '').trim() : String(meta.roleFolders?.[tid] || '').trim()
      if (!folder) return
      const key = kind === 'group' ? splitGroupChatIndexKey(folder) : splitRoleChatIndexKey(folder)
      const idx = await storage.get(key).catch(() => null)
      if (!idx || typeof idx !== 'object') return
      const fallbackTitle = kind === 'group' ? '群聊' : '新聊天'
      let metas = chatMetasFromBox(idx, fallbackTitle)
      if (patch.remove) {
        metas = metas.filter((m: any) => String(m?.id || '') !== cid)
      } else {
        const current = metas.find((m: any) => String(m?.id || '') === cid) || null
        const updatedAt = Number(patch.updatedAt || patch.chat?.updatedAt || current?.updatedAt || now())
        let chatForMeta = patch.chat
        if (!chatForMeta && patch.title == null) {
          const chatKey = kind === 'group' ? splitGroupChatKey(folder, cid) : splitChatKey(folder, cid)
          const rawChat = await storage.get(chatKey).catch(() => null)
          chatForMeta = rawChat && typeof rawChat === 'object' ? rawChat : null
        }
        const metaItem = chatForMeta
          ? chatMetaFromChat(chatForMeta, fallbackTitle)
          : {
              id: cid,
              title: String(patch.title ?? current?.title ?? fallbackTitle).replace(/\s+/g, ' ').trim() || fallbackTitle,
              createdAt: Number(current?.createdAt || updatedAt || now()),
              updatedAt,
              lastMessagePreview: String(current?.lastMessagePreview || ''),
              messageCount: Number(current?.messageCount || 0),
              hasPending: !!current?.hasPending,
            }
        metas = upsertChatMeta(metas, metaItem, fallbackTitle)
      }
      ;(idx as any).chatMetas = metas
      ;(idx as any).chatIds = metas.map((m: any) => String(m?.id || '')).filter(Boolean)
      ;(idx as any).chatUpdatedAt = chatMetaUpdatedAtMap(metas)
      if (patch.remove && String((idx as any).activeChatId || '') === cid) (idx as any).activeChatId = String(metas[0]?.id || '')
      if (!patch.remove && cid && !(idx as any).activeChatId) (idx as any).activeChatId = cid
      ;(idx as any).updatedAt = now()
      await storage.set(key, idx)
      splitMetaCache = meta
    })
  }

  async function touchChatUpdatedAt(roleId: any, chatId: any, updatedAt: any) {
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!rid || !cid) return

    await updateChatIndexEntry('role', rid, cid, { updatedAt: ua0 > 0 ? ua0 : now() })
  }

  async function touchGroupChatUpdatedAt(groupId: any, chatId: any, updatedAt: any) {
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!gid || !cid) return
    await updateChatIndexEntry('group', gid, cid, { updatedAt: ua0 > 0 ? ua0 : now() })
  }

  async function saveChatEntry(kind: ChatIndexKind, targetId: any, chat: any) {
    const tid = String(targetId || '').trim()
    const cid = String(chat?.id || '').trim()
    if (!tid || !cid || !chat || typeof chat !== 'object') return
    const meta = (await loadSplitMeta()) || splitMetaCache
    const folder = kind === 'group' ? String((meta as any)?.groupFolders?.[tid] || '').trim() : String(meta?.roleFolders?.[tid] || '').trim()
    if (!folder) throw new Error(kind === 'group' ? '群组不存在' : '角色不存在')
    const key = kind === 'group' ? splitGroupChatKey(folder, cid) : splitChatKey(folder, cid)
    await withChatWriteLock(kind, tid, cid, async () => {
      const raw0 = await storage.get(key)
      const stored = raw0 && typeof raw0 === 'object' ? raw0 : null
      const merged = mergeChatForConcurrentWrite(chat, stored)
      await storage.set(key, merged)
    })
    await updateChatIndexEntry(kind, tid, cid, { chat })
    await writeChatUpdatedNotice(kind, tid, cid, Number(chat.updatedAt || now()))
  }

  async function saveRoleChat(roleId: any, chat: any) {
    await saveChatEntry('role', roleId, chat)
  }

  async function saveGroupChat(groupId: any, chat: any) {
    await saveChatEntry('group', groupId, chat)
  }

  async function renameChatEntry(kind: ChatIndexKind, targetId: any, chatId: any, title: any) {
    const tid = String(targetId || '').trim()
    const cid = String(chatId || '').trim()
    if (!tid || !cid) return
    const fallbackTitle = kind === 'group' ? '群聊' : '新聊天'
    let nextTitle = String(title ?? '').replace(/\s+/g, ' ').trim()
    if (nextTitle.length > 80) nextTitle = nextTitle.slice(0, 80).trim()
    nextTitle = nextTitle || fallbackTitle
    await updateChatIndexEntry(kind, tid, cid, { title: nextTitle, updatedAt: now() })

    const meta = (await loadSplitMeta()) || splitMetaCache
    const folder = kind === 'group' ? String((meta as any)?.groupFolders?.[tid] || '').trim() : String(meta?.roleFolders?.[tid] || '').trim()
    if (!folder) return
    const key = kind === 'group' ? splitGroupChatKey(folder, cid) : splitChatKey(folder, cid)
    await withChatWriteLock(kind, tid, cid, async () => {
      const raw = await storage.get(key)
      const chat = raw && typeof raw === 'object' ? raw : null
      if (!chat) return
      ;(chat as any).title = nextTitle
      ;(chat as any).updatedAt = now()
      await storage.set(key, chat)
    })
  }

  async function renameRoleChat(roleId: any, chatId: any, title: any) {
    await renameChatEntry('role', roleId, chatId, title)
  }

  async function renameGroupChat(groupId: any, chatId: any, title: any) {
    await renameChatEntry('group', groupId, chatId, title)
  }

  async function loadSplitData() {
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (!meta) return null

    let stickers = null
    try {
      stickers = await storage.get(STICKERS_KEY)
    } catch (_) {
      stickers = null
    }

    const providers = await loadProvidersFromStorage(storage, meta)

    const d = {
      version: VERSION,
      settings: meta.settings && typeof meta.settings === 'object' ? meta.settings : {},
      favorites: normalizeFavorites((meta as any).favorites),
      roles: [] as any[],
      chatsByRole: {} as Record<string, any>,
      groups: [] as any[],
      chatsByGroup: {} as Record<string, any>,
      ui: meta.ui && typeof meta.ui === 'object' ? meta.ui : {},
    }

    ;(d.settings as any).stickers = stickers && typeof stickers === 'object' ? stickers : {}
    ;(d.settings as any).providers = providers

    for (const rid of meta.roleOrder) {
      const folder = String(meta.roleFolders?.[rid] || '')
      if (!folder) throw new Error('存储索引损坏：roleFolders 缺失')

      const r = await storage.get(splitRoleKey(folder))
      const role = r && typeof r === 'object' ? r : null
      if (!role) throw new Error('存储损坏：角色文件缺失或无效')

      d.roles.push(role)

      const idx = meta.chatIndexByRole?.[rid]
      const box = idx && typeof idx === 'object' ? idx : {}
      const activeChatId = String(box.activeChatId || '')
      const chatIds = Array.isArray(box.chatIds) ? box.chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []

      const chats = []
      for (const cid of chatIds) {
        const c0 = await storage.get(splitChatKey(folder, cid))
        const c = c0 && typeof c0 === 'object' ? c0 : null
        if (!c) throw new Error('存储损坏：会话文件缺失或无效')
        chats.push(c)
      }

      d.chatsByRole[String(role.id || rid)] = {
        activeChatId,
        chats,
      }
    }

    for (const gid of (meta as any).groupOrder || []) {
      const folder = String((meta as any).groupFolders?.[gid] || '')
      if (!folder) throw new Error('存储索引损坏：groupFolders 缺失')

      const g0 = await storage.get(splitGroupKey(folder))
      const group = g0 && typeof g0 === 'object' ? g0 : null
      if (!group) throw new Error('存储损坏：群组文件缺失或无效')

      ;(d as any).groups.push(group)

      const idx = (meta as any).chatIndexByGroup?.[gid]
      const box = idx && typeof idx === 'object' ? idx : {}
      const activeChatId = String((box as any).activeChatId || '')
      const chatIds = Array.isArray((box as any).chatIds) ? (box as any).chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []

      const chats = []
      for (const cid of chatIds) {
        const c0 = await storage.get(splitGroupChatKey(folder, cid))
        const c = c0 && typeof c0 === 'object' ? c0 : null
        if (!c) throw new Error('存储损坏：群聊会话文件缺失或无效')
        chats.push(c)
      }

      ;(d as any).chatsByGroup[String(group.id || gid)] = { activeChatId, chats }
    }

    return normalizeData(d)
  }

  async function ensureSplitStoreReady() {
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (meta) return
    await saveSplitData(defaultData())
  }

  async function saveSplitData(d: any) {
    if (!d || typeof d !== 'object') return
    const roles = Array.isArray(d.roles) ? d.roles : []
    const chatsByRole = d.chatsByRole && typeof d.chatsByRole === 'object' ? d.chatsByRole : {}
    const groups = Array.isArray((d as any).groups) ? (d as any).groups : []
    const chatsByGroup = (d as any).chatsByGroup && typeof (d as any).chatsByGroup === 'object' ? (d as any).chatsByGroup : {}

    const old = splitMetaCache || (await loadSplitMeta())
    const oldRoleFolders = old?.roleFolders && typeof old.roleFolders === 'object' ? old.roleFolders : {}
    const oldChatIndexByRole = old?.chatIndexByRole && typeof old.chatIndexByRole === 'object' ? old.chatIndexByRole : {}
    const oldGroupFolders = (old as any)?.groupFolders && typeof (old as any).groupFolders === 'object' ? (old as any).groupFolders : {}
    const oldChatIndexByGroup =
      (old as any)?.chatIndexByGroup && typeof (old as any).chatIndexByGroup === 'object' ? (old as any).chatIndexByGroup : {}
    const oldProviderFolders = (old as any)?.providerFolders && typeof (old as any).providerFolders === 'object' ? (old as any).providerFolders : {}

    const roleOrder = roles.map((r: any) => String(r?.id || '')).filter((x: any) => !!x)
    const roleFolders: Record<string, string> = {}
    const chatIndexByRole: Record<string, any> = {}

    const groupOrder = groups.map((g: any) => String(g?.id || '')).filter((x: any) => !!x)
    const groupFolders: Record<string, string> = {}
    const chatIndexByGroup: Record<string, any> = {}
    const providers = d.settings && typeof d.settings === 'object' && Array.isArray((d.settings as any).providers) ? (d.settings as any).providers : []
    const providerOrder = providers.map((p: any) => String(p?.id || '')).filter((x: any) => !!x)
    const providerFolders: Record<string, string> = {}

    const usedFolders = new Set<string>()
    for (const r of roles) {
      const rid = String(r?.id || '')
      if (!rid) continue
      const base = roleFolderName(r)
      let folder = String((oldRoleFolders as any)?.[rid] || '').trim() || base
      if (usedFolders.has(folder)) {
        const tail = rid.slice(Math.max(0, rid.length - 8)) || uid('r')
        folder = `${base}__${tail}`
      }
      usedFolders.add(folder)
      roleFolders[rid] = folder
    }

    const usedGroupFolders = new Set<string>()
    for (const g of groups) {
      const gid = String((g as any)?.id || '')
      if (!gid) continue
      const base = groupFolderName(g)
      let folder = String((oldGroupFolders as any)?.[gid] || '').trim() || base
      if (usedGroupFolders.has(folder)) {
        const tail = gid.slice(Math.max(0, gid.length - 8)) || uid('g')
        folder = `${base}__${tail}`
      }
      usedGroupFolders.add(folder)
      ;(groupFolders as any)[gid] = folder
    }

    const usedProviderFolders = new Set<string>()
    for (const p of providers) {
      const pid = String(p?.id || '')
      if (!pid) continue
      const base = providerFolderName(p)
      let folder = String((oldProviderFolders as any)?.[pid] || '').trim() || base
      if (usedProviderFolders.has(folder)) {
        const tail = pid.slice(Math.max(0, pid.length - 8)) || uid('p')
        folder = `${base}__${tail}`
      }
      usedProviderFolders.add(folder)
      providerFolders[pid] = folder
    }

    for (const r of roles) {
      const rid = String(r?.id || '')
      if (!rid) continue
      const folder = String(roleFolders[rid] || '')
      const box0 = chatsByRole[rid] && typeof chatsByRole[rid] === 'object' ? chatsByRole[rid] : { activeChatId: '', chats: [] }
      const activeChatId = String(box0.activeChatId || '')
      const chats = Array.isArray(box0.chats) ? box0.chats : []
      let chatMetas = chatMetasFromBox(box0, '新聊天')
      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        chatMetas = upsertChatMeta(chatMetas, chatMetaFromChat(c, '新聊天'), '新聊天')
      }
      const chatIds = chatMetaIds(chatMetas)
      const chatUpdatedAt: Record<string, number> = chatMetaUpdatedAtMap(chatMetas)
      chatIndexByRole[rid] = { activeChatId, chatIds, chatUpdatedAt, chatMetas }

      try {
        await storage.set(splitRoleKey(folder), r)
      } catch (_) {}

      await _syncRoleAvatarFile(folder, r)

      const oldFolder = String(oldRoleFolders?.[rid] || '')
      const oldIdx = oldChatIndexByRole?.[rid]
      const oldUpdated = oldIdx && typeof oldIdx === 'object' && oldIdx.chatUpdatedAt && typeof oldIdx.chatUpdatedAt === 'object' ? oldIdx.chatUpdatedAt : {}

      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        const newKey = splitChatKey(folder, cid)
        const oldKey = oldFolder ? splitChatKey(oldFolder, cid) : ''
        const updatedAt = Number(c?.updatedAt || 0)
        const prev = Number(oldUpdated?.[cid] || 0)
        const needWrite = folder !== oldFolder || updatedAt !== prev || !prev
        if (!needWrite) continue
        try {
          await withChatWriteLock('role', rid, cid, async () => {
            const raw0 = await storage.get(newKey)
            const stored = raw0 && typeof raw0 === 'object' ? raw0 : null
            const merged = mergeChatForConcurrentWrite(c, stored)
            await storage.set(newKey, merged)
          })
        } catch (_) {}
        if (oldKey && oldKey !== newKey) {
          try {
            await storage.remove(oldKey)
          } catch (_) {}
        }
      }
    }

    for (const g of groups) {
      const gid = String((g as any)?.id || '')
      if (!gid) continue
      const folder = String((groupFolders as any)[gid] || '')
      const box0 = (chatsByGroup as any)[gid] && typeof (chatsByGroup as any)[gid] === 'object' ? (chatsByGroup as any)[gid] : { activeChatId: '', chats: [] }
      const activeChatId = String((box0 as any).activeChatId || '')
      const chats = Array.isArray((box0 as any).chats) ? (box0 as any).chats : []
      let chatMetas = chatMetasFromBox(box0, '群聊')
      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        chatMetas = upsertChatMeta(chatMetas, chatMetaFromChat(c, '群聊'), '群聊')
      }
      const chatIds = chatMetaIds(chatMetas)
      const chatUpdatedAt: any = chatMetaUpdatedAtMap(chatMetas)
      ;(chatIndexByGroup as any)[gid] = { activeChatId, chatIds, chatUpdatedAt, chatMetas }

      try {
        await storage.set(splitGroupKey(folder), g)
      } catch (_) {}

      await _syncGroupAvatarFile(folder, g)

      const oldFolder = String((oldGroupFolders as any)?.[gid] || '')
      const oldIdx = (oldChatIndexByGroup as any)?.[gid]
      const oldUpdated =
        oldIdx && typeof oldIdx === 'object' && (oldIdx as any).chatUpdatedAt && typeof (oldIdx as any).chatUpdatedAt === 'object'
          ? (oldIdx as any).chatUpdatedAt
          : {}

      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        const newKey = splitGroupChatKey(folder, cid)
        const oldKey = oldFolder ? splitGroupChatKey(oldFolder, cid) : ''
        const updatedAt = Number(c?.updatedAt || 0)
        const prev = Number((oldUpdated as any)?.[cid] || 0)
        const needWrite = folder !== oldFolder || updatedAt !== prev || !prev
        if (!needWrite) continue
        try {
          await withChatWriteLock('group', gid, cid, async () => {
            const raw0 = await storage.get(newKey)
            const stored = raw0 && typeof raw0 === 'object' ? raw0 : null
            const merged = mergeChatForConcurrentWrite(c, stored)
            await storage.set(newKey, merged)
          })
        } catch (_) {}
        if (oldKey && oldKey !== newKey) {
          try {
            await storage.remove(oldKey)
          } catch (_) {}
        }
      }
    }

    const settingsMeta = d.settings && typeof d.settings === 'object' ? { ...(d.settings as any) } : {}
    try {
      delete (settingsMeta as any).stickers
      delete (settingsMeta as any).providers
    } catch (_) {}

    try {
      const stickers = d.settings && typeof d.settings === 'object' ? (d.settings as any).stickers : null
      await storage.set(STICKERS_KEY, stickers && typeof stickers === 'object' ? stickers : {})
    } catch (_) {}

    try {
      await storage.set(splitChatsIndexKey(), {
        schemaVersion: SPLIT_SCHEMA_VERSION,
        updatedAt: now(),
        roleOrder,
        roleFolders,
      })
    } catch (_) {}

    for (const rid of roleOrder) {
      const folder = String(roleFolders[rid] || '')
      if (!folder) continue
      const idx = chatIndexByRole[rid]
      try {
        await storage.set(splitRoleChatIndexKey(folder), {
          schemaVersion: SPLIT_SCHEMA_VERSION,
          roleId: rid,
          roleFolder: folder,
          activeChatId: String(idx?.activeChatId || ''),
          chatIds: Array.isArray(idx?.chatIds) ? idx.chatIds : [],
          chatUpdatedAt: idx?.chatUpdatedAt && typeof idx.chatUpdatedAt === 'object' ? idx.chatUpdatedAt : {},
          chatMetas: chatMetasFromBox(idx, '新聊天'),
          updatedAt: now(),
        })
      } catch (_) {}
    }

    try {
      await storage.set(splitGroupsIndexKey(), {
        schemaVersion: SPLIT_SCHEMA_VERSION,
        updatedAt: now(),
        groupOrder,
        groupFolders,
      })
    } catch (_) {}

    for (const gid of groupOrder) {
      const folder = String((groupFolders as any)[gid] || '')
      if (!folder) continue
      const idx = (chatIndexByGroup as any)[gid]
      try {
        await storage.set(splitGroupChatIndexKey(folder), {
          schemaVersion: SPLIT_SCHEMA_VERSION,
          groupId: gid,
          groupFolder: folder,
          activeChatId: String((idx as any)?.activeChatId || ''),
          chatIds: Array.isArray((idx as any)?.chatIds) ? (idx as any).chatIds : [],
          chatUpdatedAt: (idx as any)?.chatUpdatedAt && typeof (idx as any).chatUpdatedAt === 'object' ? (idx as any).chatUpdatedAt : {},
          chatMetas: chatMetasFromBox(idx, '群聊'),
          updatedAt: now(),
        })
      } catch (_) {}
    }

    try {
      await storage.set(splitProvidersIndexKey(), {
        schemaVersion: SPLIT_SCHEMA_VERSION,
        updatedAt: now(),
        providerOrder,
        providerFolders,
      })
    } catch (_) {}

    for (const p of providers) {
      const pid = String(p?.id || '')
      if (!pid) continue
      const folder = String(providerFolders[pid] || '')
      if (!folder) continue
      try {
        await storage.set(splitProviderKey(folder), p)
      } catch (_) {}
    }

    const meta = {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt: now(),
      ui: d.ui && typeof d.ui === 'object' ? d.ui : {},
      settings: settingsMeta,
      favorites: normalizeFavorites((d as any).favorites),
    }

    try {
      await storage.set(SPLIT_META_KEY, meta)
      splitMetaCache = meta
    } catch (_) {}

    if (old) {
      const newRoleSet = new Set(roleOrder)
      const newChatSetByRole: Record<string, Set<string>> = {}
      for (const rid of roleOrder) {
        const idx = chatIndexByRole?.[rid]
        const ids = Array.isArray(idx?.chatIds) ? idx.chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
        newChatSetByRole[rid] = new Set(ids)
      }

      const oldRoles = Array.isArray(old.roleOrder) ? old.roleOrder : []
      for (const rid0 of oldRoles) {
        const rid = String(rid0 || '')
        if (!rid) continue
        const oldFolder = String(oldRoleFolders?.[rid] || '')
        if (!oldFolder) continue

        if (!newRoleSet.has(rid)) {
          try {
            await storage.remove(splitRoleKey(oldFolder))
          } catch (_) {}
          const oldIdx = oldChatIndexByRole?.[rid]
          const oldChatIds = Array.isArray(oldIdx?.chatIds) ? oldIdx.chatIds : []
          for (const cid0 of oldChatIds) {
            const cid = String(cid0 || '')
            if (!cid) continue
            try {
              await storage.remove(splitChatKey(oldFolder, cid))
            } catch (_) {}
          }
          continue
        }

        const newFolder = String(roleFolders?.[rid] || '')
        if (newFolder && newFolder !== oldFolder) {
          try {
            await storage.remove(splitRoleKey(oldFolder))
          } catch (_) {}
          const oldIdx = oldChatIndexByRole?.[rid]
          const oldChatIds = Array.isArray(oldIdx?.chatIds) ? oldIdx.chatIds : []
          for (const cid0 of oldChatIds) {
            const cid = String(cid0 || '')
            if (!cid) continue
            try {
              await storage.remove(splitChatKey(oldFolder, cid))
            } catch (_) {}
          }
          continue
        }

        const keep = newChatSetByRole[rid]
        const oldIdx = oldChatIndexByRole?.[rid]
        const oldChatIds = Array.isArray(oldIdx?.chatIds) ? oldIdx.chatIds : []
        for (const cid0 of oldChatIds) {
          const cid = String(cid0 || '')
          if (!cid) continue
          if (keep && keep.has(cid)) continue
          try {
            await storage.remove(splitChatKey(oldFolder, cid))
          } catch (_) {}
        }
      }

      const newGroupSet = new Set(groupOrder)
      const newChatSetByGroup: any = {}
      for (const gid of groupOrder) {
        const idx = (chatIndexByGroup as any)?.[gid]
        const ids = Array.isArray((idx as any)?.chatIds) ? (idx as any).chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
        newChatSetByGroup[gid] = new Set(ids)
      }

      const oldGroups = Array.isArray((old as any).groupOrder) ? (old as any).groupOrder : []
      for (const gid0 of oldGroups) {
        const gid = String(gid0 || '')
        if (!gid) continue
        const oldFolder = String((oldGroupFolders as any)?.[gid] || '')
        if (!oldFolder) continue

        if (!newGroupSet.has(gid)) {
          try {
            await storage.remove(splitGroupKey(oldFolder))
          } catch (_) {}
          const oldIdx = (oldChatIndexByGroup as any)?.[gid]
          const oldChatIds = Array.isArray((oldIdx as any)?.chatIds) ? (oldIdx as any).chatIds : []
          for (const cid0 of oldChatIds) {
            const cid = String(cid0 || '')
            if (!cid) continue
            try {
              await storage.remove(splitGroupChatKey(oldFolder, cid))
            } catch (_) {}
          }
          continue
        }

        const newFolder = String((groupFolders as any)?.[gid] || '')
        if (newFolder && newFolder !== oldFolder) {
          try {
            await storage.remove(splitGroupKey(oldFolder))
          } catch (_) {}
          const oldIdx = (oldChatIndexByGroup as any)?.[gid]
          const oldChatIds = Array.isArray((oldIdx as any)?.chatIds) ? (oldIdx as any).chatIds : []
          for (const cid0 of oldChatIds) {
            const cid = String(cid0 || '')
            if (!cid) continue
            try {
              await storage.remove(splitGroupChatKey(oldFolder, cid))
            } catch (_) {}
          }
          continue
        }

        const keep = newChatSetByGroup[gid]
        const oldIdx = (oldChatIndexByGroup as any)?.[gid]
        const oldChatIds = Array.isArray((oldIdx as any)?.chatIds) ? (oldIdx as any).chatIds : []
        for (const cid0 of oldChatIds) {
          const cid = String(cid0 || '')
          if (!cid) continue
          if (keep && keep.has(cid)) continue
          try {
            await storage.remove(splitGroupChatKey(oldFolder, cid))
          } catch (_) {}
        }
      }
    }
  }

  async function saveMetaOnly() {
    const state = getState?.()
    if (!state?.data) return

    state.data.ui.activeRoleId = String(state.draft?.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft?.activeGroupId || '')
    ;(state.data.ui as any).activeTargetKind = String(state.draft?.activeTargetKind || '') === 'group' ? 'group' : 'role'

    const old = splitMetaCache || (await loadSplitMeta())
    if (!old) throw new Error('存储未初始化')

    const settingsMeta = state.data.settings && typeof state.data.settings === 'object' ? { ...(state.data.settings as any) } : {}
    try {
      delete (settingsMeta as any).stickers
      delete (settingsMeta as any).providers
    } catch (_) {}

    const meta = {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt: now(),
      ui: state.data.ui && typeof state.data.ui === 'object' ? state.data.ui : {},
      settings: settingsMeta,
      favorites: normalizeFavorites((state.data as any).favorites),
    }

    await storage.set(SPLIT_META_KEY, meta)
    splitMetaCache = meta
  }

  async function load() {
    const state = getState?.()
    try {
      await ensureSplitStoreReady()
      const split = await loadSplitData()
      if (!split) throw new Error('存储未初始化')
      setState?.(split)
      if (state) {
        state.draft.activeRoleId = String(split?.ui?.activeRoleId || '')
        state.draft.activeGroupId = String((split?.ui as any)?.activeGroupId || '')
        state.draft.activeTargetKind = String((split?.ui as any)?.activeTargetKind || 'role') === 'group' ? 'group' : 'role'
      }
    } catch (e: any) {
      setState?.(null)
      if (state) {
        state.draft.activeRoleId = ''
        state.draft.activeGroupId = ''
        state.draft.activeTargetKind = 'role'
      }
      onError?.(String(e?.message || e || '加载失败'))
    } finally {
      if (state) state.loading = false
    }
  }

  async function save() {
    const state = getState?.()
    if (!state?.data) return
    state.data.ui.activeRoleId = String(state.draft?.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft?.activeGroupId || '')
    ;(state.data.ui as any).activeTargetKind = String(state.draft?.activeTargetKind || '') === 'group' ? 'group' : 'role'
    await saveMetaOnly()
  }

  return {
    loadSplitMeta,
    withSplitMetaWrite,
    touchChatUpdatedAt,
    loadSplitData,
    ensureSplitStoreReady,
    saveSplitData,
    saveRoleChat,
    saveGroupChat,
    renameRoleChat,
    renameGroupChat,
    touchGroupChatUpdatedAt,
    saveMetaOnly,
    load,
    save,
    writeChatUpdatedNotice,
  }
}
