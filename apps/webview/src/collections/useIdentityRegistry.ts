import * as React from 'react'
import type { DirectClient, IdentityInfo } from './types'

/**
 * 登录信息注册表：全应用唯一的读取入口。
 * 连接成功后加载；条目保存、身份创建、详情保存、删除等身份变更后由调用方刷新。
 */
export function useIdentityRegistry(client: DirectClient | null) {
  const [identities, setIdentities] = React.useState<IdentityInfo[]>([])

  const refresh = React.useCallback(async () => {
    if (!client) {
      setIdentities([])
      return
    }
    try {
      setIdentities(await client.request<IdentityInfo[]>('collections.identity.list'))
    } catch {
      setIdentities([])
    }
  }, [client])

  React.useEffect(() => { void refresh() }, [refresh])

  return { identities, refresh }
}
