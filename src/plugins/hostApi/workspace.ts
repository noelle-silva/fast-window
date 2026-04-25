import type { PluginMethodRegistry } from './types'
import { PluginBridgeError } from '../pluginBridge'
import { requireAnyCapability } from './capability'
import { invokeWithTimeout, joinPath } from './shared'
import { V3_METHOD } from './v3/methodNames'
import { expectPlainObject, isLikelyAbsolutePath, readNonEmptyString, readOptionalBoolean } from './v3/validate'
import { Channel } from '@tauri-apps/api/core'

const WORKSPACE_FS_SCOPES = new Set(['data', 'output', 'library'])
const WORKSPACE_FS_WRITE_CHUNK_MAX_BYTES = 1024 * 1024

function readWorkspaceRelativePath(value: unknown, fieldName: string): string {
  const path = readNonEmptyString(value, fieldName)
  if (isLikelyAbsolutePath(path) || path.includes(':')) {
    throw new PluginBridgeError('BAD_REQUEST', `${fieldName} must be a relative workspace path`)
  }
  return path
}

function readWorkspaceFsReq(value: unknown): { scope: string; path: string } {
  const req = expectPlainObject(value ?? {}, 'workspace.fs payload must be an object')
  const scope = readNonEmptyString(req.scope, 'scope')
  if (!WORKSPACE_FS_SCOPES.has(scope)) {
    throw new PluginBridgeError('BAD_REQUEST', 'scope must be data, output, or library')
  }
  const path = readWorkspaceRelativePath(req.path, 'path')
  return { scope, path }
}

function readWorkspaceFsDirReq(value: unknown): { scope: string; dir: string | null } {
  const req = expectPlainObject(value ?? {}, 'workspace.fs payload must be an object')
  const scope = readNonEmptyString(req.scope, 'scope')
  if (!WORKSPACE_FS_SCOPES.has(scope)) {
    throw new PluginBridgeError('BAD_REQUEST', 'scope must be data, output, or library')
  }
  const rawDir = req.dir == null ? '' : String(req.dir).trim()
  if (rawDir.includes('\n') || rawDir.includes('\r')) throw new PluginBridgeError('BAD_REQUEST', 'dir must be a single line')
  if (rawDir && (isLikelyAbsolutePath(rawDir) || rawDir.includes(':'))) {
    throw new PluginBridgeError('BAD_REQUEST', 'dir must be a relative workspace path')
  }
  return { scope, dir: rawDir || null }
}

function readWorkspaceFsTransferReq(value: unknown): { scope: string; from: string; to: string; overwrite?: boolean } {
  const req = expectPlainObject(value ?? {}, 'workspace.fs payload must be an object')
  const scope = readNonEmptyString(req.scope, 'scope')
  if (!WORKSPACE_FS_SCOPES.has(scope)) throw new PluginBridgeError('BAD_REQUEST', 'scope must be data, output, or library')
  const from = readWorkspaceRelativePath(req.from, 'from')
  const to = readWorkspaceRelativePath(req.to, 'to')
  const overwrite = readOptionalBoolean(req.overwrite, 'overwrite')
  return { scope, from, to, overwrite }
}

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
  [V3_METHOD.workspace.fs.readText]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.readText', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const req = readWorkspaceFsReq(args?.[0])
      return await invokeWithTimeout('plugin_files_read_text', { pluginId: ctx.id, req })
    },
  },
  [V3_METHOD.workspace.fs.writeText]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.writeText', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const req0 = expectPlainObject(args?.[0] ?? {}, 'workspace.fs.writeText payload must be an object')
      const { scope, path } = readWorkspaceFsReq(req0)
      const text = String(req0.text ?? '')
      const overwrite = readOptionalBoolean(req0.overwrite, 'overwrite')
      await invokeWithTimeout('plugin_files_write_text', { pluginId: ctx.id, req: { scope, path, text, overwrite: overwrite ?? true } })
      return null
    },
  },
  [V3_METHOD.workspace.fs.readBytes]: {
    handler: async (ctx, args, extra) => {
      if (!extra.postStream) throw new PluginBridgeError('BAD_REQUEST', 'postStream is required for workspace.fs.readBytes')
      requireAnyCapability(ctx, ['cap:workspace.fs.readBytes', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const req = readWorkspaceFsReq(args?.[0])
      const streamId = `workspace-fs-${ctx.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const channel = new Channel<any>(event => {
        const normalized = event && event.type === 'chunk' && Array.isArray(event.bytes)
          ? { ...event, bytes: new Uint8Array(event.bytes) }
          : event
        extra.postStream?.({ streamId, event: normalized })
      })
      await invokeWithTimeout('plugin_files_read_stream', { pluginId: ctx.id, streamId, req, channel })
      return { streamId }
    },
  },
  [V3_METHOD.workspace.fs.writeBytes]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.writeBytes', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const req0 = expectPlainObject(args?.[0] ?? {}, 'workspace.fs.writeBytes payload must be an object')
      const { scope, path } = readWorkspaceFsReq(req0)
      const overwrite = readOptionalBoolean(req0.overwrite, 'overwrite')
      const res = await invokeWithTimeout<{ writeId: string }>('plugin_files_write_stream_open', {
        pluginId: ctx.id,
        req: { scope, path, overwrite: overwrite ?? true },
      })
      return res
    },
  },
  [V3_METHOD.workspace.fs.readBytesCancel]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.readBytes', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const streamId = readNonEmptyString(args?.[0], 'streamId')
      await invokeWithTimeout('plugin_files_read_stream_cancel', { streamId })
      return null
    },
  },
  [V3_METHOD.workspace.fs.writeBytesChunk]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.writeBytes', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'workspace.fs.writeBytesChunk payload must be an object')
      const writeId = readNonEmptyString((req as any).writeId, 'writeId')
      const rawBytes = (req as any).bytes
      if (!Array.isArray(rawBytes)) throw new PluginBridgeError('BAD_REQUEST', 'bytes must be an array')
      if (rawBytes.length > WORKSPACE_FS_WRITE_CHUNK_MAX_BYTES) throw new PluginBridgeError('BAD_REQUEST', 'bytes chunk too large')
      const bytes = rawBytes.map((v, idx) => {
        const n = Number(v)
        if (!Number.isInteger(n) || n < 0 || n > 255) throw new PluginBridgeError('BAD_REQUEST', `bytes[${idx}] must be 0..255`)
        return n
      })
      await invokeWithTimeout('plugin_files_write_stream_chunk', { pluginId: ctx.id, req: { writeId, bytes } })
      return null
    },
  },
  [V3_METHOD.workspace.fs.writeBytesClose]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.writeBytes', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const writeId = readNonEmptyString(args?.[0], 'writeId')
      await invokeWithTimeout('plugin_files_write_stream_close', { pluginId: ctx.id, writeId })
      return null
    },
  },
  [V3_METHOD.workspace.fs.writeBytesCancel]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.writeBytes', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const writeId = readNonEmptyString(args?.[0], 'writeId')
      await invokeWithTimeout('plugin_files_write_stream_cancel', { pluginId: ctx.id, writeId })
      return null
    },
  },
  [V3_METHOD.workspace.fs.listDir]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.listDir', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const { scope, dir } = readWorkspaceFsDirReq(args?.[0])
      return await invokeWithTimeout('plugin_files_list_dir', { pluginId: ctx.id, req: { scope, dir } })
    },
  },
  [V3_METHOD.workspace.fs.mkdir]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.mkdir', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const req = readWorkspaceFsReq(args?.[0])
      await invokeWithTimeout('plugin_files_mkdir', { pluginId: ctx.id, req })
      return null
    },
  },
  [V3_METHOD.workspace.fs.remove]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.remove', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const req = readWorkspaceFsReq(args?.[0])
      await invokeWithTimeout('plugin_files_delete_tree', { pluginId: ctx.id, req })
      return null
    },
  },
  [V3_METHOD.workspace.fs.stat]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.stat', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const req = readWorkspaceFsReq(args?.[0])
      return await invokeWithTimeout('plugin_files_stat', { pluginId: ctx.id, req })
    },
  },
  [V3_METHOD.workspace.fs.rename]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.rename', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const { scope, from, to, overwrite } = readWorkspaceFsTransferReq(args?.[0])
      await invokeWithTimeout('plugin_files_rename', { pluginId: ctx.id, req: { scope, from, to, overwrite: overwrite ?? false } })
      return null
    },
  },
  [V3_METHOD.workspace.fs.copy]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:workspace.fs.copy', 'cap:workspace.fs.*', 'cap:workspace.*'])
      const { scope, from, to, overwrite } = readWorkspaceFsTransferReq(args?.[0])
      await invokeWithTimeout('plugin_files_copy', { pluginId: ctx.id, req: { scope, from, to, overwrite: overwrite ?? false } })
      return null
    },
  },
}
