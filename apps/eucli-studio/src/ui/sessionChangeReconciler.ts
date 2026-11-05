import { normalizeSessionChange, sessionChangeViewTarget, type SessionChangeViewTarget } from '../domain/sessionChange'
import { refreshScopes } from '../domain/uiRefreshScope'
import { workspaceRoleTargetId } from '../domain/workspaceRoleTarget'
import type { ChatIndexSnapshot } from '../storage/splitProjectionCache'
import type { TargetChatScope } from '../storage/targetChatSync'

// 会话变更广播的对账器：把「事件携带的 version」变成视图刷新。
//
// 三条硬约束：
//   1. 只比较版本，不用时间推断新旧；
//   2. 会话已进入视窗正文时，按事件指向权威重取该会话；
//   3. 同一会话的并发刷新共享一条链，更高版本只抬高目标，绝并发重取。

// 一次会话版本对账最多重取几轮：事件在拉取期间继续到达时，
// 只允许用最新版本再补一次，绝不在单次对账里无限追版本。
const MAX_SESSION_VERSION_REFRESH_ROUNDS = 3

export type SessionChangeReconcilerDeps = {
  getState: () => any
  activeScope: () => TargetChatScope | null
  activeChatIdForScope: (scope: TargetChatScope) => string
  // 工作区会话没有索引 scope，活动目标由 workspaceId + roleId 表达。
  activeWorkspaceTarget: () => { workspaceId: string; roleId: string } | null
  emitScope: (scope: string) => void
  isDisposed: () => boolean
  syncChatById: (scope: TargetChatScope, chatId: string) => Promise<boolean>
  // 工作区会话正文的权威重取：与角色 / 群聊事件共用同一套版本对账。
  syncWorkspaceChatById: (workspaceId: string, roleId: string, chatId: string) => Promise<boolean>
  // 事件指向的会话还没进入正文：只让索引刷新列表事实。
  requestListReconcile: () => void
}

export type SessionVersionCheck = {
  checked: boolean
  changed: boolean
  guardedChatIds: Set<string>
}

// 会话目标地址：事件 / 索引 / 工作区列表都先落到同一份身份上，
// 版本核对再按地址逐条会话补 chatId。工作区比角色 / 群聊多两个定位字段。
type SessionTargetAddress =
  | { kind: 'role' | 'group'; targetId: string }
  | { kind: 'workspace'; targetId: string; workspaceId: string; roleId: string }

function targetViewFor(address: SessionTargetAddress, chatId: string): SessionChangeViewTarget {
  if (address.kind === 'workspace') {
    return {
      kind: 'workspace',
      targetId: address.targetId,
      workspaceId: address.workspaceId,
      roleId: address.roleId,
      chatId,
    }
  }
  return { kind: address.kind, targetId: address.targetId, chatId }
}

export function createSessionChangeReconciler(deps: SessionChangeReconcilerDeps) {
  // 同一会话的版本刷新链：key -> 目标版本 + 共享 promise。
  const refreshes = new Map<string, { version: number; promise: Promise<boolean> }>()

  function chatsBoxFor(target: Pick<SessionChangeViewTarget, 'kind' | 'targetId'>): any {
    const state = deps.getState()
    if (!state.data) return null
    const root = target.kind === 'workspace'
      ? (state.data as any).chatsByWorkspace
      : target.kind === 'group'
        ? (state.data as any).chatsByGroup
        : (state.data as any).chatsByRole
    return root?.[target.targetId] || null
  }

  function loadedChatFor(target: SessionChangeViewTarget): any {
    const box = chatsBoxFor(target)
    const chats = Array.isArray(box?.chats) ? box.chats : []
    return chats.find((chat: any) => String(chat?.id || '').trim() === target.chatId) || null
  }

  // localSessionVersion 是「本地已知版本」的唯一读取点：
  // 它只来自已经进入内存的权威会话载荷，索引摘要不能替本地正文背书。
  function localSessionVersion(target: SessionChangeViewTarget): number {
    return Math.max(0, Math.floor(Number(loadedChatFor(target)?.sessionVersion || 0) || 0))
  }

  function markLocalSessionVersion(target: SessionChangeViewTarget, version: number) {
    const chat = loadedChatFor(target)
    if (!chat || !(version > 0)) return
    chat.sessionVersion = Math.max(Number(chat.sessionVersion || 0) || 0, Math.floor(version))
  }

  function refreshKey(target: SessionChangeViewTarget): string {
    return `${target.kind}:${target.targetId}:${target.chatId}`
  }

  // pullSession 是「按事件指向取回权威正文」的唯一分派点：
  // 角色 / 群聊走投影管线，工作区走它自己的会话端点；上层不关心来源差异。
  async function pullSession(target: SessionChangeViewTarget): Promise<boolean> {
    if (target.kind === 'workspace') {
      return deps.syncWorkspaceChatById(target.workspaceId, target.roleId, target.chatId)
    }
    return deps.syncChatById({ kind: target.kind, targetId: target.targetId }, target.chatId)
  }

  // requestRefresh 是「按事件指向刷新对应会话」的唯一入口。
  //
  // 同一会话的并发请求共享一条链：推送更高的版本只会抬高目标，
  // 正在进行的拉取完成后最多再补一次；不会并发重取，也不会无限追版本。
  function requestRefresh(target: SessionChangeViewTarget, versionRaw: number): Promise<boolean> {
    const version = Math.max(0, Math.floor(Number(versionRaw) || 0))
    if (!target.chatId || version <= 0) return Promise.resolve(false)

    const key = refreshKey(target)
    const existing = refreshes.get(key)
    if (existing) {
      if (version > existing.version) existing.version = version
      return existing.promise
    }

    const entry: { version: number; promise: Promise<boolean> } = { version, promise: Promise.resolve(false) }
    entry.promise = (async () => {
      let changed = false
      for (let round = 0; round < MAX_SESSION_VERSION_REFRESH_ROUNDS; round++) {
        if (deps.isDisposed()) break
        const wanted = entry.version
        if (wanted <= localSessionVersion(target)) break
        let applied = false
        try {
          applied = await pullSession(target)
        } catch {
          applied = false
        }
        if (!applied) break
        changed = true
        const observed = localSessionVersion(target)
        if (observed > 0 && observed < wanted) {
          // 拉到的正文仍落后于事件版本：绝不能把它冒充成最新事实。
          // 只在有限轮次内重试；仍追不上就停下，等下一次事件 / 重连。
          continue
        }
        markLocalSessionVersion(target, wanted)
        if (entry.version <= wanted) break
      }
      return changed
    })().finally(() => {
      if (refreshes.get(key) === entry) refreshes.delete(key)
    })
    refreshes.set(key, entry)
    return entry.promise
  }

  function activeChatIdFor(target: SessionChangeViewTarget): string {
    if (target.kind === 'workspace') {
      return String(chatsBoxFor(target)?.activeChatId || '').trim()
    }
    return deps.activeChatIdForScope({ kind: target.kind, targetId: target.targetId })
  }

  function notifyRefreshed(target: SessionChangeViewTarget) {
    deps.emitScope(refreshScopes.chatList(target.kind, target.targetId))
    if (activeChatIdFor(target) === target.chatId) {
      deps.emitScope(refreshScopes.session(target.kind, target.targetId, target.chatId))
    }
  }

  // verifyTargetVersions 是「断线恢复先核对版本」的唯一实现。
  // 会话目标只提供身份，具体版本表由调用方从对应的权威列表取得：
  //   - 角色 / 群聊：索引快照 chatVersions；
  //   - 工作区：会话摘要 version。
  // 只有权威版本高于本地已知版本，才发一次权威拉取；
  // 版本相等即证明本地视图已经是最新，绝不做多余的正文重取。
  async function verifyTargetVersions(
    address: SessionTargetAddress,
    versions: Record<string, number>,
  ): Promise<SessionVersionCheck> {
    if (!Object.keys(versions).length) return { checked: false, changed: false, guardedChatIds: new Set() }

    const box = chatsBoxFor(address)
    const chats = Array.isArray(box?.chats) ? box.chats.slice() : []
    let changed = false
    const guardedChatIds = new Set<string>()
    for (const chat of chats) {
      if (deps.isDisposed()) break
      const chatId = String(chat?.id || '').trim()
      if (!chatId) continue
      const serverVersion = Math.max(0, Math.floor(Number(versions[chatId] || 0) || 0))
      if (serverVersion <= 0) continue
      // 这条会话的版本已经由权威列表裁决：无论相等还是落后，都不再回落到时间戳二次拉取。
      guardedChatIds.add(chatId)
      const target = targetViewFor(address, chatId)
      if (serverVersion <= localSessionVersion(target)) continue
      const applied = await requestRefresh(target, serverVersion)
      changed = applied || changed
    }
    return { checked: true, changed, guardedChatIds }
  }

  function verifyVersions(scope: TargetChatScope, snapshot: ChatIndexSnapshot): Promise<SessionVersionCheck> {
    return verifyTargetVersions(
      { kind: scope.kind, targetId: scope.targetId },
      snapshot.chatVersions || {},
    )
  }

  // verifyWorkspaceVersions 把工作区会话摘要里的 version 接入同一条版本核对：
  // 工作区没有索引 scope，但版本语义与角色 / 群聊完全一致。
  function verifyWorkspaceVersions(
    workspaceId: string,
    roleId: string,
    versions: Record<string, number>,
  ): Promise<SessionVersionCheck> {
    const targetId = workspaceRoleTargetId(workspaceId, roleId)
    if (!targetId) return Promise.resolve({ checked: false, changed: false, guardedChatIds: new Set() })
    return verifyTargetVersions({ kind: 'workspace', targetId, workspaceId, roleId }, versions)
  }

  function isActiveTarget(target: SessionChangeViewTarget): boolean {
    if (target.kind === 'workspace') {
      const active = deps.activeWorkspaceTarget()
      return !!active && workspaceRoleTargetId(active.workspaceId, active.roleId) === target.targetId
    }
    const active = deps.activeScope()
    return !!active && active.kind === target.kind && active.targetId === target.targetId
  }

  // applyEvent 是「实时消费会话变更广播」的唯一落点。
  //
  // 事件只驱动它指向的会话：
  //   - 版本不高于本地已知版本 → 忽略，视图不倒退；
  //   - 会话已经进入本地正文 → 权威重取该会话（非当前目标也静默刷新，
  //     切回该目标时直接看到新事实）；
  //   - 会话还没进入本地正文 → 只有它属于当前目标时，才让索引刷新列表事实。
  function applyEvent(raw: any) {
    if (deps.isDisposed()) return
    const change = normalizeSessionChange(raw)
    if (!change) return
    const target = sessionChangeViewTarget(change)
    if (!target) return

    const loaded = loadedChatFor(target)
    if (!loaded) {
      // 工作区会话没有索引列表可对账：未进入正文时不制造第二套加载路径。
      if (target.kind !== 'workspace' && isActiveTarget(target)) deps.requestListReconcile()
      return
    }

    const localVersion = localSessionVersion(target)
    if (localVersion > 0 && change.version <= localVersion) return

    void requestRefresh(target, change.version)
      .then((changed) => {
        if (deps.isDisposed() || !changed) return
        if (isActiveTarget(target)) notifyRefreshed(target)
      })
      .catch(() => {})
  }

  function stop() {
    refreshes.clear()
  }

  return { applyEvent, verifyVersions, verifyWorkspaceVersions, stop }
}

export type SessionChangeReconciler = ReturnType<typeof createSessionChangeReconciler>
