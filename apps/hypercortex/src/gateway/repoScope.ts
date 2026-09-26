import type { BackgroundClient } from './backgroundClient'

// UI 语义：作用域值 "library" 表示「当前仓库」。
// 请求离开网关边界前统一解析为具体仓库 ID；后端只认仓库 ID 与 data（应用设置域），
// 不存在隐式的「当前仓库」后端状态，谁发的请求就带着自己的目标仓库。
let activeRepoId = ''

export function setActiveRepoScope(repoId: string) {
  activeRepoId = String(repoId || '').trim()
}

export function resolveRequestScope(params: unknown): unknown {
  const record = params as Record<string, unknown> | null | undefined
  if (!record || typeof record !== 'object' || record.scope !== 'library') return params
  if (!activeRepoId) throw new Error('当前仓库尚未就绪')
  return { ...record, scope: activeRepoId }
}

// withRepoScope 为后台客户端加上「当前仓库解析」：
// 服务层保持书写逻辑作用域，仓库切换只影响此后发出的请求。
export function withRepoScope(background: BackgroundClient): BackgroundClient {
  return {
    invoke: (method, params, options) => background.invoke(method, resolveRequestScope(params), options),
    close: () => background.close(),
  }
}
