// 供应商权威读取：只按实体地址做一次 GET，不拉全量列表。
// 404 是「实体确定不存在」，其他失败原样抛出，交给上层标记为结果未确认。

export type ProviderAuthorityReader = (providerId: string) => Promise<any | null>

export function createProviderAuthorityReader(netRequest: (req: any) => Promise<any>): ProviderAuthorityReader {
  return async (providerIdRaw) => {
    const providerId = String(providerIdRaw || '').trim()
    if (!providerId) return null

    try {
      const response = await netRequest({
        method: 'GET',
        path: `/api/providers/${encodeURIComponent(providerId)}`,
      })
      const status = Number(response?.status || 0)
      if (status === 404) return null
      if (status < 200 || status >= 300) throw new Error(`读取供应商失败：HTTP ${status}`)
      const body = response?.body
      return body && typeof body === 'object' ? body : null
    } catch (error) {
      if (isProviderNotFoundError(error)) return null
      throw error
    }
  }
}

// isProviderNotFoundError 只认结构化字段：HTTP 404 或业务错误码。
// 后端实际返回 provider.not_found，因此按大小写不敏感的 .not_found 后缀识别；
// 不解析 message 文本，避免把人类可读文案当成协议。
export function isProviderNotFoundError(error: unknown): boolean {
  const raw = error as any
  const statusCode = Number(raw?.details?.statusCode ?? raw?.statusCode)
  if (statusCode === 404) return true
  const errorCode = String(raw?.details?.json?.error?.code || raw?.code || '').trim().toLowerCase()
  return errorCode === 'not_found' || errorCode.endsWith('.not_found')
}
