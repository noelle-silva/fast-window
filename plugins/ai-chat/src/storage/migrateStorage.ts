import {
  AnyRecord,
  STORAGE_META_PATH,
  STORAGE_SCHEMA_VERSION,
  nowId,
  runtimeKeyToRelPath,
  storageKeyToRelPath,
} from './storageCodec'
import { createPluginFilesClient } from './pluginFilesClient'

export async function migrateIfNeeded(tauri: any, pluginId: string) {
  const client = createPluginFilesClient(tauri, pluginId)

  const meta = await client.readJson(STORAGE_META_PATH).catch(() => null)
  if (meta && typeof meta === 'object' && Number((meta as any).schemaVersion || 0) >= STORAGE_SCHEMA_VERSION) return

  const pid = client.pluginId
  const oldStorageRoot = 'storage'
  const oldRoots = ['meta', 'stickers', 'roles', 'chats']
  const source: AnyRecord = { from: [`${pid}.json`, `${pid}.runtime.json`] }

  const legacyMain = await client.readJsonMaybeLarge(`${pid}.json`).catch((e) => {
    const msg = String((e as any)?.message || e || '')
    if (msg.includes('文件不存在')) return null
    throw e
  })
  const legacyRt = await client.readJsonMaybeLarge(`${pid}.runtime.json`).catch((e) => {
    const msg = String((e as any)?.message || e || '')
    if (msg.includes('文件不存在')) return null
    throw e
  })

  const hasLegacyMain = !!legacyMain && typeof legacyMain === 'object'
  const hasLegacyRt = !!legacyRt && typeof legacyRt === 'object'

  if (hasLegacyMain || hasLegacyRt) {
    if (hasLegacyMain) {
      const keys = Object.keys(legacyMain as any)
      for (const k of keys) {
        if (k === '__migrated_from_legacy_v1') continue
        if (k === 'bg.queue' || k.startsWith('bg.')) {
          await client.writeJson(runtimeKeyToRelPath(k), (legacyMain as any)[k])
          continue
        }
        if (k === 'ui/notice/chat-updated') {
          await client.writeJson(runtimeKeyToRelPath(k), (legacyMain as any)[k])
          continue
        }
        await client.writeJson(storageKeyToRelPath(k), (legacyMain as any)[k])
      }
    } else {
      source.mainReadable = false
    }

    if (hasLegacyRt) {
      const keys = Object.keys(legacyRt as any)
      for (const k of keys) {
        await client.writeJson(runtimeKeyToRelPath(k), (legacyRt as any)[k])
      }
    } else {
      source.runtimeReadable = false
    }

    await client
      .writeJson(STORAGE_META_PATH, {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        migratedAt: Date.now(),
        source,
        priority: 'legacy-first',
        note: `migrate@${nowId()}`,
      })
      .catch(() => {})
    return
  }

  // 无 legacy：若根目录分片已存在，只补 meta。
  const rootMeta = await client.readJson('meta/index.json').catch(() => null)
  const rootStickers = await client.readJson('stickers/index.json').catch(() => null)
  if (rootMeta != null || rootStickers != null) {
    await client
      .writeJson(STORAGE_META_PATH, { schemaVersion: STORAGE_SCHEMA_VERSION, migratedAt: Date.now(), reason: 'root-shards-existed' })
      .catch(() => {})
    return
  }

  // 无 legacy：检测旧布局（storage/<root>/**.json），存在则迁移到根目录（去掉 storage/ 这一层）。
  let hasOld = false
  for (const r of oldRoots) {
    const probe = await client.readJson(`${oldStorageRoot}/${r}/index.json`).catch(() => null)
    if (probe != null) {
      hasOld = true
      break
    }
  }

  if (hasOld) {
    const walk = async (dir: string) => {
      const entries = await client.listDir(dir)
      for (const ent of entries as any[]) {
        if (!ent) continue
        const name = String((ent as any).name || '')
        if (!name) continue
        const full = `${dir}/${name}`
        if ((ent as any).isDirectory) {
          await walk(full)
          continue
        }
        if (!(ent as any).isFile) continue
        if (!name.toLowerCase().endsWith('.json')) continue
        const rel = full.replaceAll('\\', '/')
        if (!rel.startsWith(`${oldStorageRoot}/`)) continue
        const dst = rel.slice(`${oldStorageRoot}/`.length)
        const v = await client.readJsonMaybeLarge(rel)
        await client.writeJson(dst, v)
      }
    }

    for (const r of oldRoots) {
      await walk(`${oldStorageRoot}/${r}`)
    }

    await client
      .writeJson(STORAGE_META_PATH, { schemaVersion: STORAGE_SCHEMA_VERSION, migratedAt: Date.now(), reason: 'migrated-from-old-storage' })
      .catch(() => {})
    return
  }

  await client
    .writeJson(STORAGE_META_PATH, { schemaVersion: STORAGE_SCHEMA_VERSION, createdAt: Date.now(), freshInstall: true, source })
    .catch(() => {})
}
