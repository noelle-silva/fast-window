import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { nowId } from '../shared/historyDomain'
import { STORAGE_META_PATH, STORAGE_SCHEMA_VERSION, ClipboardHistoryStorageKeys } from '../shared/storageKeys'
import type { ClipboardHistoryItem, ClipboardHistorySettings, CollectionsDoc, DeletedHistoryMap } from '../shared/types'
import { resolvePathInData } from './paths'

const LEGACY_AGGREGATE_PATH = 'clipboard-history.json'

function dataFile(key: string) {
  return resolvePathInData(`${key}.json`)
}

async function readJson(path: string) {
  try {
    const raw = await readFile(path, 'utf8')
    return raw.trim() ? JSON.parse(raw) : null
  } catch (error: any) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

async function atomicWriteJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

async function exists(path: string) {
  try {
    await readFile(path)
    return true
  } catch (error: any) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

function pickLegacyPart(legacy: any, key: string) {
  if (!legacy || typeof legacy !== 'object') return null
  if (key in legacy) return legacy[key]
  if (key === ClipboardHistoryStorageKeys.deletedHistory && 'deleted' in legacy) return legacy.deleted
  return null
}

export function createClipboardHistoryStore() {
  async function writeMeta() {
    await atomicWriteJson(resolvePathInData(STORAGE_META_PATH), {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      updatedAt: Date.now(),
    })
  }

  async function ensureStorageReady() {
    await mkdir(resolvePathInData(''), { recursive: true })
    const hasAnyShard = await Promise.all(Object.values(ClipboardHistoryStorageKeys).map(key => exists(dataFile(key))))
    if (hasAnyShard.some(Boolean)) {
      await writeMeta()
      return
    }

    const legacyPath = resolvePathInData(LEGACY_AGGREGATE_PATH)
    if (!(await exists(legacyPath))) {
      await writeMeta()
      return
    }

    const legacy = await readJson(legacyPath)
    await copyFile(legacyPath, resolvePathInData(`_backup-migrate-${nowId()}.json`))
    for (const key of Object.values(ClipboardHistoryStorageKeys)) {
      const value = pickLegacyPart(legacy, key)
      if (value !== null) await atomicWriteJson(dataFile(key), value)
    }
    await writeMeta()
  }

  async function loadKey<T>(key: string): Promise<T | null> {
    await ensureStorageReady()
    return readJson(dataFile(key)) as Promise<T | null>
  }

  async function saveKey(key: string, value: unknown) {
    await atomicWriteJson(dataFile(key), value)
    await writeMeta()
  }

  return {
    ensureStorageReady,
    loadHistory: () => loadKey<ClipboardHistoryItem[]>(ClipboardHistoryStorageKeys.history),
    saveHistory: (items: ClipboardHistoryItem[]) => saveKey(ClipboardHistoryStorageKeys.history, items),
    loadSettings: () => loadKey<Partial<ClipboardHistorySettings>>(ClipboardHistoryStorageKeys.settings),
    saveSettings: (settings: ClipboardHistorySettings) => saveKey(ClipboardHistoryStorageKeys.settings, settings),
    loadDeletedHistory: () => loadKey<DeletedHistoryMap>(ClipboardHistoryStorageKeys.deletedHistory),
    saveDeletedHistory: (deleted: DeletedHistoryMap) => saveKey(ClipboardHistoryStorageKeys.deletedHistory, deleted),
    loadCollections: () => loadKey<CollectionsDoc>(ClipboardHistoryStorageKeys.collections),
    saveCollections: (collections: CollectionsDoc) => saveKey(ClipboardHistoryStorageKeys.collections, collections),
    loadRecentFolders: () => loadKey<string[]>(ClipboardHistoryStorageKeys.recentFolders),
    saveRecentFolders: (folderIds: string[]) => saveKey(ClipboardHistoryStorageKeys.recentFolders, folderIds),
  }
}

export type ClipboardHistoryStore = ReturnType<typeof createClipboardHistoryStore>
