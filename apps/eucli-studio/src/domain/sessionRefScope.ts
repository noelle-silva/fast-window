import type { SessionIndexScope } from '../storage/splitProjectionCache'
import { workspaceRoleTargetId } from './workspaceRoleTarget'

// 跨 target 的会话引用（工作桌面、会话收藏夹）在存储上同构：
// 四段身份 targetKind / targetId / roleId / chatId，标题这类事实要按 target 现查。
//
// 这个模块是「一条引用的事实住在哪」的唯一口径：
//   盒子键   chatsByRole / chatsByGroup / chatsByWorkspace 的下标；
//   索引 scope  sessionIndex.get 的寻址单位。
// 桌面装配、收藏夹预取、启动预热都从这里取，不再各拼一遍合成键。

export type SessionRefKind = 'role' | 'group' | 'workspace'

export type SessionRefIdentity = {
  targetKind: SessionRefKind
  targetId: string
  roleId: string
  chatId: string
}

export function normalizeSessionRefKind(raw: unknown): SessionRefKind {
  const text = String(raw || '').trim()
  return text === 'group' ? 'group' : text === 'workspace' ? 'workspace' : 'role'
}

// 归一化一条引用：工作区必须同时有两段身份，否则它对不上任何盒子。
export function sessionRefIdentity(raw: any): SessionRefIdentity | null {
  if (!raw || typeof raw !== 'object') return null
  const targetKind = normalizeSessionRefKind(raw.targetKind)
  const targetId = String(raw.targetId || '').trim()
  const chatId = String(raw.chatId || '').trim()
  const roleId = targetKind === 'workspace' ? String(raw.roleId || '').trim() : ''
  if (!targetId || !chatId) return null
  if (targetKind === 'workspace' && !roleId) return null
  return { targetKind, targetId, roleId, chatId }
}

// 盒子键：工作区的盒子按「工作区::角色」两段身份挂载，其余就是 targetId。
export function sessionRefBoxKey(targetKind: SessionRefKind, targetId: string, roleId = ''): string {
  if (targetKind !== 'workspace') return String(targetId || '').trim()
  return workspaceRoleTargetId(targetId, roleId)
}

export function sessionRefBox(data: any, ref: SessionRefIdentity): any | null {
  const key = sessionRefBoxKey(ref.targetKind, ref.targetId, ref.roleId)
  if (!key) return null
  const root =
    ref.targetKind === 'group'
      ? data?.chatsByGroup
      : ref.targetKind === 'workspace'
        ? data?.chatsByWorkspace
        : data?.chatsByRole
  const box = root && typeof root === 'object' ? root[key] : null
  return box && typeof box === 'object' ? box : null
}

// 事实是否已在内存：正文或索引任一命中即算到位。
// 只回答「有没有」，不代替各处按自己需要读正文或读摘要。
export function sessionRefHasFacts(data: any, ref: SessionRefIdentity): boolean {
  const box = sessionRefBox(data, ref)
  if (!box) return false
  const chatId = ref.chatId
  const metas = Array.isArray(box.chatMetas) ? box.chatMetas : []
  if (metas.some((meta: any) => String(meta?.id || '').trim() === chatId)) return true
  const chats = Array.isArray(box.chats) ? box.chats : []
  return chats.some((chat: any) => String(chat?.id || '').trim() === chatId)
}

// 一条引用 → 索引 scope：工作区用合成键，其余用 targetId。
export function sessionRefScope(ref: SessionRefIdentity): SessionIndexScope | null {
  const key = sessionRefBoxKey(ref.targetKind, ref.targetId, ref.roleId)
  if (!key) return null
  return { kind: ref.targetKind, targetId: key }
}

// 一批引用 → 去重后的索引 scope。桌面与收藏夹共用这一个收集口径。
export function sessionRefScopes(refsRaw: Iterable<any>): SessionIndexScope[] {
  const out: SessionIndexScope[] = []
  const seen = new Set<string>()
  for (const raw of refsRaw) {
    const ref = sessionRefIdentity(raw)
    if (!ref) continue
    const scope = sessionRefScope(ref)
    if (!scope) continue
    const key = `${scope.kind}:${scope.targetId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(scope)
  }
  return out
}

// 只挑出「事实还没进内存」的 scope：已有的不重复请求。
// 启动预热用它把「当前工作区已经拉过」的那部分自然排除掉。
export function missingSessionRefScopes(data: any, refsRaw: Iterable<any>): SessionIndexScope[] {
  const pending: SessionRefIdentity[] = []
  for (const raw of refsRaw) {
    const ref = sessionRefIdentity(raw)
    if (!ref) continue
    if (sessionRefHasFacts(data, ref)) continue
    pending.push(ref)
  }
  return sessionRefScopes(pending)
}
