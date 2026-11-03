import { isUnknownWriteOutcome } from '../protocol/directFailure'
import { providerMatchesWrite } from '../domain/providerEntity'
import type { ProviderAuthorityReader } from './providerAuthority'

// 写失败对账的三种可执行结论：
//   not-needed    确定失败，不需要回读，沿用原有回滚；
//   applied       回读确认后端已是本次写入后的值，本地保留新值；
//   not-applied   回读确认后端仍是旧值 / 实体仍存在，本地回滚；
//   unconfirmed   结果未知且回读也失败，无法判定，由调用方明确提示。
export type ProviderReconcileOutcome = 'not-needed' | 'applied' | 'not-applied' | 'unconfirmed'

export async function reconcileProviderSaveFailure(input: {
  error: unknown
  providerId: string
  intended: any
  readProvider?: ProviderAuthorityReader
}): Promise<ProviderReconcileOutcome> {
  if (!isUnknownWriteOutcome(input.error)) return 'not-needed'
  if (typeof input.readProvider !== 'function') return 'unconfirmed'

  try {
    const remote = await input.readProvider(input.providerId)
    if (!remote) return 'not-applied'
    return providerMatchesWrite(remote, input.intended) ? 'applied' : 'not-applied'
  } catch {
    return 'unconfirmed'
  }
}

export async function reconcileProviderDeleteFailure(input: {
  error: unknown
  providerId: string
  readProvider?: ProviderAuthorityReader
}): Promise<ProviderReconcileOutcome> {
  if (!isUnknownWriteOutcome(input.error)) return 'not-needed'
  if (typeof input.readProvider !== 'function') return 'unconfirmed'

  try {
    const remote = await input.readProvider(input.providerId)
    return remote ? 'not-applied' : 'applied'
  } catch {
    return 'unconfirmed'
  }
}
