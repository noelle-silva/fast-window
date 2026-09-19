import { useCallback, useRef, useState } from 'react'
import type { RegisteredApp } from '../apps/types'

export interface HostHomeRefreshSources {
  reloadPlugins: () => Promise<void>
  reloadRegisteredApps: () => Promise<RegisteredApp[]>
  refreshRegisteredAppStatuses: (apps: RegisteredApp[]) => Promise<void>
  notify: (message: string) => void
}

export function useHostHomeRefresh(sources: HostHomeRefreshSources) {
  const { reloadPlugins, reloadRegisteredApps, refreshRegisteredAppStatuses, notify } = sources
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)

  const refreshHome = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    try {
      const [, apps] = await Promise.all([reloadPlugins(), reloadRegisteredApps()])
      await refreshRegisteredAppStatuses(apps)
      notify('已刷新')
    } catch (error) {
      console.warn('[host] home refresh failed:', error)
      notify('刷新失败（详情见控制台）')
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [reloadPlugins, reloadRegisteredApps, refreshRegisteredAppStatuses, notify])

  return { refreshHome, refreshingHome: refreshing }
}
