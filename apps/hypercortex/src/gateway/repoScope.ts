import type { BackgroundClient } from './backgroundClient'

// UI 语义：作用域值 "library" 表示「当前仓库」。
// 请求离开网关边界前统一解析为具体仓库标识；后端只认仓库标识与 data（应用设置域），
// 不存在隐式的「当前仓库」后端状态，谁发的请求就带着自己的目标仓库。
// 作用域由请求方显式提供（每个仓库现场绑定自己的仓库），不存在模块级共享当前仓库。

export function resolveRequestScope(params: unknown, repoId: string): unknown {
  const record = params as Record<string, unknown> | null | undefined
  if (!record || typeof record !== 'object' || record.scope !== 'library') return params
  if (!repoId) throw new Error('当前仓库尚未就绪')
  return { ...record, scope: repoId }
}

// bindRepoScope 为后台客户端绑定固定仓库：现场内书写的逻辑作用域 "library"
// 在出站时解析为该现场所属仓库；多个现场并存时各自寻址，绝不串仓。
export function bindRepoScope(background: BackgroundClient, repoId: string): BackgroundClient {
  return {
    invoke: (method, params, options) => background.invoke(method, resolveRequestScope(params, repoId), options),
    close: () => background.close(),
  }
}
