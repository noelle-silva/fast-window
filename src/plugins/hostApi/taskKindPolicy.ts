import { PluginBridgeError } from '../pluginBridge'
import type { PluginContext } from '../pluginApi'
import { usesSystemBackend } from '../pluginProfiles'

/**
 * 系统后台插件任务模型约束：
 * - task 只承载“任务/调度原语”，不作为宿主业务能力扩展点。
 * - 宿主业务能力不应借道 task.kind（如 clipboard.watch）。
 * - 特别地：不提供宿主 http.request 原语面，网络请求请由插件自行实现（例如 background 用 fetch）。
 *
 * v2：历史兼容不在此限制范围内（v2 走 tauri 网关 & legacy 调用链）。
 */

const V3_RESERVED_HOST_CAPABILITY_KINDS = new Set(['http.request', 'clipboard.watch'])

export function assertV3TaskKindAllowed(ctx: PluginContext, kind: string) {
  if (!usesSystemBackend(ctx.apiVersion)) return
  if (!V3_RESERVED_HOST_CAPABILITY_KINDS.has(kind)) return

  const hint =
    kind === 'http.request'
      ? '系统后台插件不提供宿主 http.request 原语面：请在插件 background 中使用 fetch（或自建网络层），再通过 workspace 文件/自定义协议把结果回传给 UI'
      : kind === 'clipboard.watch'
        ? '请改用 fastWindow.clipboard.watch（clipboard 原语），不要用 task.create(kind=clipboard.watch)'
        : '请改用对应宿主原语，不要用 task.create 承接宿主业务能力'

  throw new PluginBridgeError(
    'BAD_REQUEST',
    `系统后台插件不允许用 task.kind 承接宿主业务能力（kind=${JSON.stringify(kind)}）。${hint}`,
  )
}
