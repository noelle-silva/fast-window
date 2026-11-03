// 实体权威读取的通用实现：只按实体地址做一次 GET，不拉全量列表。
// 404 / *.not_found 是「实体确定不存在」，其他失败原样抛出，
// 交给上层标记为结果未确认。

export type EntityAuthorityReader = (entityId: string) => Promise<any | null>

export type EntityAuthorityListFallback = {
  path: string
  idOf?: (item: any) => string
}

export function createEntityAuthorityReader(options: {
  netRequest: (req: any) => Promise<any>
  resourcePath: string
  entityLabel: string
  // 某些后端的实体读取在“文件不存在”时返回通用 storage.read_failed，
  // 无法从错误码区分“不存在”与“读取失败”。这里用一次列表成员检查做仲裁：
  // 列表确认没有该 id -> 视为不存在；列表有该 id -> 说明是读取失败，原样抛出。
  listFallback?: EntityAuthorityListFallback
}): EntityAuthorityReader {
  const netRequest = options.netRequest
  const resourcePath = String(options.resourcePath || '').replace(/\/+$/, '')
  const entityLabel = String(options.entityLabel || '实体')
  const listFallback = options.listFallback

  async function existsInList(entityId: string): Promise<boolean | null> {
    if (!listFallback) return null
    try {
      const response = await netRequest({ method: 'GET', path: listFallback.path })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) return null
      const body = response?.body
      const items = Array.isArray(body) ? body : []
      const idOf = listFallback.idOf || ((item: any) => String(item?.id || '').trim())
      return items.some((item: any) => idOf(item) === entityId)
    } catch {
      return null
    }
  }

  return async (entityIdRaw) => {
    const entityId = String(entityIdRaw || '').trim()
    if (!entityId) return null

    try {
      const response = await netRequest({
        method: 'GET',
        path: `${resourcePath}/${encodeURIComponent(entityId)}`,
      })
      const status = Number(response?.status || 0)
      if (status === 404) return null
      if (status < 200 || status >= 300) throw new Error(`读取${entityLabel}失败：HTTP ${status}`)
      const body = response?.body
      return body && typeof body === 'object' ? body : null
    } catch (error) {
      if (isEntityNotFoundError(error)) return null
      const exists = await existsInList(entityId)
      if (exists === false) return null
      throw error
    }
  }
}

// isEntityNotFoundError 只认结构化字段：HTTP 404 或业务错误码。
// 业务端的实体错误码并不统一（供应商为 provider.not_found，
// studio 本地投影为裸 NOT_FOUND），因此按大小写不敏感的 .not_found 后缀
// 或裸 not_found 识别；不解析 message 文本，避免把人类可读文案当成协议。
export function isEntityNotFoundError(error: unknown): boolean {
  const raw = error as any
  const statusCode = Number(raw?.details?.statusCode ?? raw?.statusCode)
  if (statusCode === 404) return true
  const errorCode = String(raw?.details?.json?.error?.code || raw?.code || '').trim().toLowerCase()
  return errorCode === 'not_found' || errorCode.endsWith('.not_found')
}
