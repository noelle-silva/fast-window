import { requireAnyCapability } from './capability'
import { invokeWithTimeout } from './shared'
import type { PluginMethodRegistry } from './types'
import { V3_METHOD } from './v3/methodNames'
import { expectPlainObject, readNonEmptyString, readOptionalNumber } from './v3/validate'
import { assertV3TaskKindAllowed } from './taskKindPolicy'

export const taskMethods: PluginMethodRegistry = {
  [V3_METHOD.task.create]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:task.create', 'cap:task.*'])
      const req = expectPlainObject(args?.[0], 'task.create payload must be an object')
      // 对齐 tauri TaskCreateReq：kind 必填，其它字段原样透传给宿主做更严格校验
      const kind = readNonEmptyString(req.kind, 'kind')
      assertV3TaskKindAllowed(ctx, kind)
      return await invokeWithTimeout('task_create', { pluginId: ctx.id, req })
    },
  },
  [V3_METHOD.task.get]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:task.get', 'cap:task.*'])
      const taskId = readNonEmptyString(args?.[0], 'taskId')
      return await invokeWithTimeout('task_get', { pluginId: ctx.id, taskId })
    },
  },
  [V3_METHOD.task.list]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:task.list', 'cap:task.*'])
      const req = expectPlainObject(args?.[0] ?? {}, 'task.list payload must be an object') as { limit?: unknown }
      const limit = readOptionalNumber(req?.limit, 'limit')
      return await invokeWithTimeout('task_list', { pluginId: ctx.id, limit })
    },
  },
  [V3_METHOD.task.cancel]: {
    handler: async (ctx, args) => {
      requireAnyCapability(ctx, ['cap:task.cancel', 'cap:task.*'])
      const taskId = readNonEmptyString(args?.[0], 'taskId')
      return await invokeWithTimeout('task_cancel', { pluginId: ctx.id, taskId })
    },
  },
}
