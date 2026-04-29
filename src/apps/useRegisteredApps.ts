import { useState, useCallback } from 'react'
import type { RegisteredApp } from './types'
import { loadRegistry, addApp, removeApp, updateApp } from './appRegistry'

export function useRegisteredApps() {
  const [apps, setApps] = useState<RegisteredApp[]>([])

  const load = useCallback(async () => {
    const list = await loadRegistry()
    setApps(list)
  }, [])

  const add = useCallback(async (app: RegisteredApp) => {
    await addApp(app)
    setApps(prev => {
      const idx = prev.findIndex(a => a.id === app.id)
      if (idx >= 0) {
        const next = prev.slice()
        next[idx] = app
        return next
      }
      return [...prev, app]
    })
  }, [])

  const remove = useCallback(async (id: string) => {
    await removeApp(id)
    setApps(prev => prev.filter(a => a.id !== id))
  }, [])

  const update = useCallback(async (id: string, patch: Partial<RegisteredApp>) => {
    await updateApp(id, patch)
    setApps(prev => {
      const idx = prev.findIndex(a => a.id === id)
      if (idx < 0) return prev
      const next = prev.slice()
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }, [])

  return { apps, load, add, remove, update }
}
