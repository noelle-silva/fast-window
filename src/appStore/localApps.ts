import { inspectLocalStoreApp } from '../apps/installedAppInfo'
import type { RegisteredApp } from '../apps/types'

export type LocalStoreApp = {
  app: RegisteredApp
  version: string
}

/**
 * 商店页本地状态：只巡检商店条目命中的注册应用。
 * 未命中商店的本地应用不参与；单条记录巡检失败按未安装处理，不向商店页抛错。
 */
export async function loadLocalStoreApps(
  storeIds: readonly string[],
  registeredApps: RegisteredApp[],
): Promise<Map<string, LocalStoreApp>> {
  const wanted = new Set(storeIds)
  const candidates = registeredApps.filter(app => wanted.has(app.id))

  const entries = await Promise.all(
    candidates.map(async app => {
      try {
        const info = await inspectLocalStoreApp(app.path)
        if (!info || info.id !== app.id) return null
        return [app.id, { app, version: info.version }] as const
      } catch (error) {
        console.warn(`[app-store] 本机应用巡检失败，按未安装处理: ${app.id}`, error)
        return null
      }
    }),
  )

  const out = new Map<string, LocalStoreApp>()
  for (const entry of entries) {
    if (entry) out.set(entry[0], entry[1])
  }
  return out
}
