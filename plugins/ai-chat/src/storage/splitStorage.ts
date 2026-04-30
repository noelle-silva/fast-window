import { now, uid } from '../core/utils'
import { VERSION, SPLIT_SCHEMA_VERSION, SPLIT_META_KEY, STICKERS_KEY } from '../domain/constants'
import { normalizeSplitMeta, normalizeData, defaultData } from '../domain/dataNormalizers'
import { normalizeFavorites } from '../domain/favorites'
import {
  splitRoleKey,
  splitChatKey,
  splitGroupKey,
  splitGroupChatKey,
  roleFolderName,
  groupFolderName,
} from '../domain/storageKeys'

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
    const raw = await storage.get(SPLIT_META_KEY)
    if (raw == null) return null
    const meta = normalizeSplitMeta(raw)
    if (!meta) throw new Error('存储索引损坏：meta/index 格式不正确')
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

  async function touchChatUpdatedAt(roleId: any, chatId: any, updatedAt: any) {
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!rid || !cid) return

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) return
      const idx = meta.chatIndexByRole?.[rid]
      if (!idx || typeof idx !== 'object') return
      if (!(idx as any).chatUpdatedAt || typeof (idx as any).chatUpdatedAt !== 'object') (idx as any).chatUpdatedAt = {}
      ;(idx as any).chatUpdatedAt[String(cid)] = ua0 > 0 ? ua0 : now()
      meta.updatedAt = now()
      await storage.set(SPLIT_META_KEY, meta)
      splitMetaCache = meta
    })
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

    const roleOrder = roles.map((r: any) => String(r?.id || '')).filter((x: any) => !!x)
    const roleFolders: Record<string, string> = {}
    const chatIndexByRole: Record<string, any> = {}

    const groupOrder = groups.map((g: any) => String(g?.id || '')).filter((x: any) => !!x)
    const groupFolders: Record<string, string> = {}
    const chatIndexByGroup: Record<string, any> = {}

    const usedFolders = new Set<string>()
    for (const r of roles) {
      const rid = String(r?.id || '')
      if (!rid) continue
      const base = roleFolderName(r)
      let folder = base
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
      let folder = base
      if (usedGroupFolders.has(folder)) {
        const tail = gid.slice(Math.max(0, gid.length - 8)) || uid('g')
        folder = `${base}__${tail}`
      }
      usedGroupFolders.add(folder)
      ;(groupFolders as any)[gid] = folder
    }

    for (const r of roles) {
      const rid = String(r?.id || '')
      if (!rid) continue
      const folder = String(roleFolders[rid] || '')
      const box0 = chatsByRole[rid] && typeof chatsByRole[rid] === 'object' ? chatsByRole[rid] : { activeChatId: '', chats: [] }
      const activeChatId = String(box0.activeChatId || '')
      const chats = Array.isArray(box0.chats) ? box0.chats : []
      const chatIds = chats.map((c: any) => String(c?.id || '')).filter((x: any) => !!x)
      const chatUpdatedAt: Record<string, number> = {}
      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        chatUpdatedAt[cid] = Number(c?.updatedAt || 0)
      }
      chatIndexByRole[rid] = { activeChatId, chatIds, chatUpdatedAt }

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
      const chatIds = chats.map((c: any) => String(c?.id || '')).filter((x: any) => !!x)
      const chatUpdatedAt: any = {}
      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        chatUpdatedAt[cid] = Number(c?.updatedAt || 0)
      }
      ;(chatIndexByGroup as any)[gid] = { activeChatId, chatIds, chatUpdatedAt }

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
    } catch (_) {}

    try {
      const stickers = d.settings && typeof d.settings === 'object' ? (d.settings as any).stickers : null
      await storage.set(STICKERS_KEY, stickers && typeof stickers === 'object' ? stickers : {})
    } catch (_) {}

    const meta = {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt: now(),
      ui: d.ui && typeof d.ui === 'object' ? d.ui : {},
      settings: settingsMeta,
      favorites: normalizeFavorites((d as any).favorites),
      roleOrder,
      roleFolders,
      chatIndexByRole,
      groupOrder,
      groupFolders,
      chatIndexByGroup,
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
    if (!old) return saveSplitData(state.data)

    const settingsMeta = state.data.settings && typeof state.data.settings === 'object' ? { ...(state.data.settings as any) } : {}
    try {
      delete (settingsMeta as any).stickers
    } catch (_) {}

    const meta = {
      ...(old && typeof old === 'object' ? old : {}),
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
    await saveSplitData(state.data)
  }

  return {
    loadSplitMeta,
    withSplitMetaWrite,
    touchChatUpdatedAt,
    loadSplitData,
    ensureSplitStoreReady,
    saveSplitData,
    saveMetaOnly,
    load,
    save,
    writeChatUpdatedNotice,
  }
}
