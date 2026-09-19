import { useState, useCallback } from 'react'
import type { RegisteredApp, RegisteredAppUpdatePatch } from './types'
import { loadRegistry, addApp, replaceApp, removeApp, updateApp } from './appRegistry'

export function useRegisteredApps() {
  const [apps, setApps] = useState<RegisteredApp[]>([])

  const load = useCallback(async () => {
    const list = await loadRegistry()
    setApps(list)
    return list
  }, [])

  const add = useCallback(async (app: RegisteredApp) => {
    await addApp(app)
    await load()
  }, [load])

  const replace = useCallback(async (previousId: string, app: RegisteredApp) => {
    await replaceApp(previousId, app)
    await load()
  }, [load])

  const remove = useCallback(async (id: string) => {
    await removeApp(id)
    await load()
  }, [load])

  const update = useCallback(async (id: string, patch: RegisteredAppUpdatePatch) => {
    await updateApp(id, patch)
    await load()
  }, [load])

  return { apps, load, add, replace, remove, update }
}
