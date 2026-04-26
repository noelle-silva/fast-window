import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { PluginManifest } from '../pluginContract'
import type { PluginBackendStatus } from './backendStatus'

export type BackendStatusPlugin = {
  id: string
  manifest?: PluginManifest
}

export function usePluginBackendStatuses(plugins: BackendStatusPlugin[]) {
  const [statusesById, setStatusesById] = useState<Record<string, PluginBackendStatus>>({})

  useEffect(() => {
    const ids = plugins.filter(p => !!p.manifest?.background?.main).map(p => p.id)
    if (!ids.length) {
      setStatusesById({})
      return
    }

    let cancelled = false
    const loadStatuses = () => {
      void invoke<Record<string, PluginBackendStatus>>('plugin_backend_status_many', { pluginIds: ids })
        .then(statuses => {
          if (!cancelled) setStatusesById(statuses || {})
        })
        .catch(() => {
          if (!cancelled) setStatusesById({})
        })
    }

    loadStatuses()
    const timer = window.setInterval(loadStatuses, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [plugins])

  return statusesById
}
