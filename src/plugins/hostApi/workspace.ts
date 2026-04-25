import type { PluginMethodRegistry } from './types'
import { PluginBridgeError } from '../pluginBridge'
import { requireAnyCapability } from './capability'
import { invokeWithTimeout, joinPath } from './shared'
import { V3_METHOD } from './v3/methodNames'
import { isLikelyAbsolutePath, readNonEmptyString } from './v3/validate'

export const workspaceMethods: PluginMethodRegistry = {
  [V3_METHOD.workspace.getPaths]: {
    handler: async (ctx) => {
      requireAnyCapability(ctx, ['cap:workspace.getPaths', 'cap:workspace.*'])
      const dataRoot = await invokeWithTimeout<string>('get_data_dir', {})
      const outputDir = await invokeWithTimeout<string>('plugin_get_output_dir', { pluginId: ctx.id })
      const libraryDir = await invokeWithTimeout<string>('plugin_get_library_dir', { pluginId: ctx.id })
      const dataDir = joinPath(dataRoot, ctx.id)
      return {
        dataDir,
        outputDir,
        libraryDir,
        tempDir: joinPath(dataDir, 'tmp'),
      }
    },
  },
  [V3_METHOD.workspace.openOutputDir]: {
    handler: async (ctx) => {
      requireAnyCapability(ctx, ['cap:workspace.openOutputDir', 'cap:workspace.*'])
      await invokeWithTimeout('plugin_open_output_dir', { pluginId: ctx.id })
      return null
    },
  },
  [V3_METHOD.workspace.openDir]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.openDir', 'cap:workspace.*'])
      const dir = readNonEmptyString(args?.[0], 'dir')
      if (!isLikelyAbsolutePath(dir)) throw new PluginBridgeError('BAD_REQUEST', 'dir must be an absolute path')
      await invokeWithTimeout('plugin_open_dir', { pluginId: ctx.id, dir })
      return null
    },
  },
}
