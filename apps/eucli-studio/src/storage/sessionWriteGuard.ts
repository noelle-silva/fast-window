import { createGenerationGuard } from './cacheGuard'
import { parseWorkspaceRoleTargetId } from '../domain/workspaceRoleTarget'

// 会话写回的代数守卫。
//
// 缓存层（索引 / 窗口 / 正文）已经有 generation 机制，但「会话进入内存状态」
// 还有一类写回发生在缓存之外：异步加载完成后的 upsert、索引对账、设置回包、
// 重命名回包。它们共同的事实边界是「一条会话」，因此这里用同一个代数表
// 表达失效：删除会话 / 删除 target / 删除工作区时推进代数，旧请求落地时
// 校验代数，不成立就不再写回。
//
// 这里只做「旧请求不得回填」，不做永久墓碑：删除之后发起的新请求会捕获
// 新代数，仍可正常落地（服务端删除失败后 UI 也还能恢复）。

export type SessionWriteKind = 'role' | 'group' | 'workspace'

const SEP = '\u0000'

function text(value: unknown) {
  return String(value ?? '').trim()
}

export type SessionWriteToken = {
  key: string
  generation: number
}

export function sessionWriteKey(kind: SessionWriteKind, targetIdRaw: unknown, sessionIdRaw: unknown): string {
  return `${kind}${SEP}${text(targetIdRaw)}${SEP}${text(sessionIdRaw)}`
}

export function createSessionWriteGuard() {
  const guard = createGenerationGuard()

  function capture(kind: SessionWriteKind, targetIdRaw: unknown, sessionIdRaw: unknown): SessionWriteToken {
    const key = sessionWriteKey(kind, targetIdRaw, sessionIdRaw)
    return { key, generation: guard.current(key) }
  }

  function isCurrent(token: SessionWriteToken | null | undefined): boolean {
    if (!token) return true
    return guard.isCurrent(token.key, token.generation)
  }

  function invalidateSession(kind: SessionWriteKind, targetIdRaw: unknown, sessionIdRaw: unknown) {
    guard.advance(sessionWriteKey(kind, targetIdRaw, sessionIdRaw))
  }

  // 删除角色 / 群组：该 target 下所有会话（含未指定 session 的 target 级写入）
  // 都属于上一代。
  function invalidateTarget(kind: SessionWriteKind, targetIdRaw: unknown) {
    const prefix = `${kind}${SEP}${text(targetIdRaw)}${SEP}`
    guard.advanceMatching((key) => key.startsWith(prefix))
  }

  // 删除工作区：该工作区下所有角色组合的会话都属于上一代。
  function invalidateWorkspace(workspaceIdRaw: unknown) {
    const workspaceId = text(workspaceIdRaw)
    if (!workspaceId) return
    guard.advanceMatching((key) => {
      if (!key.startsWith(`workspace${SEP}`)) return false
      const targetId = key.split(SEP)[1] || ''
      const parsed = parseWorkspaceRoleTargetId(targetId)
      return parsed.workspaceId === workspaceId || targetId === workspaceId
    })
  }

  return { capture, isCurrent, invalidateSession, invalidateTarget, invalidateWorkspace }
}

export type SessionWriteGuard = ReturnType<typeof createSessionWriteGuard>
