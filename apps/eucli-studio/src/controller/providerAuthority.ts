import { createEntityAuthorityReader, isEntityNotFoundError, type EntityAuthorityReader } from './entityAuthority'

// 供应商权威读取是通用实体读取器在供应商资源上的实例：
// 路径与实体名称是唯一差异，读取/404/错误判定全部复用同一套机制。
export type ProviderAuthorityReader = EntityAuthorityReader

export function createProviderAuthorityReader(netRequest: (req: any) => Promise<any>): ProviderAuthorityReader {
  return createEntityAuthorityReader({
    netRequest,
    resourcePath: '/api/providers',
    entityLabel: '供应商',
  })
}

export function isProviderNotFoundError(error: unknown): boolean {
  return isEntityNotFoundError(error)
}
