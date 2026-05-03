import { useState, useCallback } from 'react'
import type { RegisteredApp, RegisteredAppUpdatePatch } from './types'
import { loadRegistry, addApp, removeApp, updateApp } from './appRegistry'

function applyRegisteredAppPatch(app: RegisteredApp, patch: RegisteredAppUpdatePatch): RegisteredApp {
  const next: RegisteredApp = { ...app }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.icon !== undefined) next.icon = patch.icon
  if (patch.path !== undefined) next.path = patch.path
  if (patch.displayMode !== undefined) next.displayMode = patch.displayMode
  if (patch.commands !== undefined) next.commands = patch.commands
  if (patch.autoStart !== undefined) next.autoStart = patch.autoStart
  if (patch.windowWidth !== undefined) next.windowWidth = patch.windowWidth
  if (patch.windowHeight !== undefined) next.windowHeight = patch.windowHeight
  if (patch.windowX !== undefined) next.windowX = patch.windowX
  if (patch.windowY !== undefined) next.windowY = patch.windowY
  if (patch.hotkey !== undefined) {
    if (patch.hotkey) next.hotkey = patch.hotkey
    else delete next.hotkey
  }
  return next
}

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

  const update = useCallback(async (id: string, patch: RegisteredAppUpdatePatch) => {
    await updateApp(id, patch)
    setApps(prev => {
      const idx = prev.findIndex(a => a.id === id)
      if (idx < 0) return prev
      const next = prev.slice()
      next[idx] = applyRegisteredAppPatch(next[idx], patch)
      return next
    })
  }, [])

  return { apps, load, add, remove, update }
}
