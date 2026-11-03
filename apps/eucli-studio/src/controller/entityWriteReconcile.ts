import { isUnknownWriteOutcome } from '../protocol/directFailure'
import type { EntityAuthorityReader } from './entityAuthority'

// 写失败对账的三种可执行结论：
//   not-needed    确定失败，不需要回读，沿用原有回滚；
//   applied       回读确认后端已是本次写入后的值，本地保留新值；
//   not-applied   回读确认后端仍是旧值 / 实体仍存在，本地回滚；
//   unconfirmed   结果未知且回读也失败，无法判定，由调用方明确提示。
export type EntityReconcileOutcome = 'not-needed' | 'applied' | 'not-applied' | 'unconfirmed'

export type EntityWriteMatches = (remote: any, intended: any) => boolean

export async function reconcileEntitySaveFailure(input: {
  error: unknown
  entityId: string
  intended: any
  readEntity?: EntityAuthorityReader
  matchesWrite: EntityWriteMatches
}): Promise<EntityReconcileOutcome> {
  if (!isUnknownWriteOutcome(input.error)) return 'not-needed'
  if (typeof input.readEntity !== 'function') return 'unconfirmed'

  try {
    const remote = await input.readEntity(input.entityId)
    if (!remote) return 'not-applied'
    return input.matchesWrite(remote, input.intended) ? 'applied' : 'not-applied'
  } catch {
    return 'unconfirmed'
  }
}

export async function reconcileEntityDeleteFailure(input: {
  error: unknown
  entityId: string
  readEntity?: EntityAuthorityReader
}): Promise<EntityReconcileOutcome> {
  if (!isUnknownWriteOutcome(input.error)) return 'not-needed'
  if (typeof input.readEntity !== 'function') return 'unconfirmed'

  try {
    const remote = await input.readEntity(input.entityId)
    return remote ? 'not-applied' : 'applied'
  } catch {
    return 'unconfirmed'
  }
}

// entityWriteFailureMessage 把对账结论翻译成用户可理解的结果：
// 确定失败沿用原错误文案；只有「已回读确认」与「回读也失败」才追加限定语。
export function entityWriteFailureMessage(input: {
  action: 'save' | 'delete'
  outcome: EntityReconcileOutcome
  error: any
  entityLabel: string
}): string {
  const { action, outcome, error, entityLabel } = input
  const actionLabel = action === 'save' ? '保存' : '删除'
  const reason = String(error?.message || error || `${entityLabel}${actionLabel}失败`)
  if (outcome === 'unconfirmed') return `${entityLabel}${actionLabel}结果未确认：${reason}`
  if (outcome === 'not-applied') {
    return action === 'save'
      ? `${entityLabel}保存失败（已确认未写入）：${reason}`
      : `${entityLabel}删除失败（已确认${entityLabel}仍存在）：${reason}`
  }
  return reason
}
