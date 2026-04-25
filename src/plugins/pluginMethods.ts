import type { PluginContext } from './pluginApi'
import { PluginBridgeError } from './pluginBridge'
import { clipboardMethods } from './hostApi/clipboard'
import { clipboardWatchMethods } from './hostApi/clipboardWatch'
import { dialogMethods } from './hostApi/dialog'
import { hostMethods } from './hostApi/host'
import { processMethods } from './hostApi/process'
import { tauriGatewayMethods } from './hostApi/tauriGateway'
import { taskMethods } from './hostApi/task'
import type { PluginMethodRegistry } from './hostApi/types'
import { workspaceMethods } from './hostApi/workspace'

const coreMethods: PluginMethodRegistry = {
  ...hostMethods,
  ...processMethods,
  ...taskMethods,
  ...workspaceMethods,
  ...dialogMethods,
  ...clipboardMethods,
  ...clipboardWatchMethods,
}

/**
 * Plugin RPC 方法表（按 API 版本隔离）。
 *
 * 重要：v3 插件必须在宿主 RPC 层面与 tauri 网关（tauri.invoke/streamOpen/streamCancel）硬隔离，
 * 不能只依赖 SDK “不暴露”。否则插件可自行构造 RPC 调用绕过六原语。
 *
 * - v2：兼容历史能力，保留 tauri 网关入口
 * - v3：仅允许 coreMethods（六原语对应的宿主 API），不暴露 tauri 网关
 */
const v2Methods: PluginMethodRegistry = {
  ...coreMethods,
  ...tauriGatewayMethods,
}

const v3Methods: PluginMethodRegistry = {
  ...coreMethods,
}

function resolveMethodRegistry(ctx: PluginContext): PluginMethodRegistry {
  return ctx.apiVersion >= 3 ? v3Methods : v2Methods
}

export async function dispatchPluginMethod(
  ctx: PluginContext,
  method: string,
  args: unknown,
  extra: {
    runtime: 'ui' | 'background'
    onBack?: () => void
    postStream?: (payload: { streamId: string; event: any }) => void
  },
) {
  const def = resolveMethodRegistry(ctx)[String(method)]
  if (!def) throw new PluginBridgeError('UNKNOWN_METHOD', `Unknown method: ${String(method)}`)

  const list = Array.isArray(args) ? (args as unknown[]) : []
  return def.handler(ctx, list, extra)
}
