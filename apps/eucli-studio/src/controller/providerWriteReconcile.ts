import { providerMatchesWrite } from '../domain/providerEntity'
import {
  reconcileEntityDeleteFailure,
  reconcileEntitySaveFailure,
  type EntityReconcileOutcome,
} from './entityWriteReconcile'
import type { ProviderAuthorityReader } from './providerAuthority'

// 供应商写失败对账只提供实体比对函数，对账流程复用通用机制。
export type ProviderReconcileOutcome = EntityReconcileOutcome

export async function reconcileProviderSaveFailure(input: {
  error: unknown
  providerId: string
  intended: any
  readProvider?: ProviderAuthorityReader
}): Promise<ProviderReconcileOutcome> {
  return reconcileEntitySaveFailure({
    error: input.error,
    entityId: input.providerId,
    intended: input.intended,
    readEntity: input.readProvider,
    matchesWrite: providerMatchesWrite,
  })
}

export async function reconcileProviderDeleteFailure(input: {
  error: unknown
  providerId: string
  readProvider?: ProviderAuthorityReader
}): Promise<ProviderReconcileOutcome> {
  return reconcileEntityDeleteFailure({
    error: input.error,
    entityId: input.providerId,
    readEntity: input.readProvider,
  })
}
