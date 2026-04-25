import type { PluginContext } from '../pluginApi'

export type PluginMethodHandlerExtra = {
  runtime: 'ui' | 'background'
  onBack?: () => void
  postStream?: (payload: { streamId: string; event: any }) => void
}

export type PluginMethodHandler = (
  ctx: PluginContext,
  args: unknown[],
  extra: PluginMethodHandlerExtra,
) => unknown | Promise<unknown>

export type PluginMethodDef = {
  handler: PluginMethodHandler
}

export type PluginMethodRegistry = Record<string, PluginMethodDef>
