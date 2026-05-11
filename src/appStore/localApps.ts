import { inspectLocalStoreApp } from '../apps/installedAppInfo'
import type { RegisteredApp } from '../apps/types'

export type LocalStoreApp = {
  app: RegisteredApp
  storeId: string
  version: string
}

export async function loadLocalStoreApps(apps: RegisteredApp[]): Promise<Map<string, LocalStoreApp>> {
  const entries = await Promise.all(apps.map(async app => {
    const info = await inspectLocalStoreApp(app.path)
    if (!info) return null
    return { app, storeId: info.id, version: info.version }
  }))

  const out = new Map<string, LocalStoreApp>()
  for (const entry of entries) {
    if (!entry) continue
    if (out.has(entry.storeId)) throw new Error(`多个注册应用指向同一个商店应用: ${entry.storeId}`)
    out.set(entry.storeId, entry)
  }
  return out
}
