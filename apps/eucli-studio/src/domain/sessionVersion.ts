// 会话事实版本：由后台权威载荷携带，是客户端判断事件新旧的本地已知版本。
//
// 两种形状必须在这里统一：
//   - 业务端原始会话载荷用 version；
//   - 已经进入内存的会话用 sessionVersion。
// 入内存只加不减，迟到的旧载荷不得把本地已知版本拉回去。

export function sessionVersionOf(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const source = value as Record<string, unknown>
  const raw = Number(source.version)
  const loaded = Number(source.sessionVersion)
  const version = Math.max(Number.isFinite(raw) ? Math.floor(raw) : 0, Number.isFinite(loaded) ? Math.floor(loaded) : 0)
  return version > 0 ? version : 0
}

// applyLoadedSessionVersion 把「权威会话载荷的 version」留在内存会话上。
// 它是客户端判断事件新旧的本地已知版本；重新归一化或乐观更新都不得抹掉它。
export function applyLoadedSessionVersion(chat: any, raw: any, existing: any): any {
  if (!chat || typeof chat !== 'object') return chat
  const version = Math.max(sessionVersionOf(raw), sessionVersionOf(existing))
  if (version > 0) chat.sessionVersion = Math.max(sessionVersionOf(chat), version)
  return chat
}

// staleSessionPayload 判定「迟到的旧正文」：已有版本更高时不得覆盖本地视图。
// 版本缺失的载荷（旧业务端 / 窗口切片）没有新旧证据，仍按原路径合并。
export function staleSessionPayload(raw: any, existing: any): boolean {
  const incomingVersion = sessionVersionOf(raw)
  const existingVersion = sessionVersionOf(existing)
  return incomingVersion > 0 && existingVersion > 0 && incomingVersion < existingVersion
}
