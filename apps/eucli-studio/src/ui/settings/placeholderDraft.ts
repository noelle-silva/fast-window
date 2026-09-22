import {
  normalizePlaceholderLibrary,
  type PlaceholderFolder,
  type PlaceholderItem,
  type PlaceholderLibrary,
} from '../../domain/placeholder'

// 占位符草稿：服务端库之上的本地未保存状态。
// baselines 是「草稿名 -> 服务端原名」，改名后仍能把草稿条目对回服务端身份；
// 它与 library 放在同一个状态对象里，保证任何一次改动都是原子且可响应的。
export type PlaceholderDraft = {
  library: PlaceholderLibrary
  baselines: Record<string, string>
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function sortedNames(names: Iterable<string>) {
  return Array.from(new Set(Array.from(names).filter(Boolean))).sort((left, right) => left.localeCompare(right))
}

export function createPlaceholderDraft(library: unknown): PlaceholderDraft {
  return { library: normalizePlaceholderLibrary(library), baselines: {} }
}

export function serverIdentityOf(draft: PlaceholderDraft, nameRaw: unknown): string {
  const name = text(nameRaw)
  return text(draft.baselines[name]) || name
}

export function updateDraftLibrary(draft: PlaceholderDraft, updater: (library: PlaceholderLibrary) => PlaceholderLibrary): PlaceholderDraft {
  return { ...draft, library: updater(draft.library) }
}

export function updateDraftPlaceholder(draft: PlaceholderDraft, index: number, patch: Partial<PlaceholderItem>): PlaceholderDraft {
  return updateDraftLibrary(draft, (library) => ({
    ...library,
    placeholders: library.placeholders.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
  }))
}

export function renameDraftPlaceholder(draft: PlaceholderDraft, index: number, nextNameRaw: string): PlaceholderDraft {
  const item = draft.library.placeholders[index]
  if (!item) return draft
  const nextName = String(nextNameRaw ?? '')
  const oldName = text(item.name)
  if (oldName === nextName) return draft

  const identity = serverIdentityOf(draft, oldName)
  const baselines = { ...draft.baselines }
  delete baselines[oldName]
  if (text(nextName) && text(nextName) !== identity) baselines[nextName] = identity

  return {
    baselines,
    library: {
      ...draft.library,
      placeholders: draft.library.placeholders.map((entry, itemIndex) => (itemIndex === index ? { ...entry, name: nextName } : entry)),
      folders: draft.library.folders.map((folder) => ({
        ...folder,
        placeholderNames: (folder.placeholderNames || []).map((name) => (name === oldName ? nextName : name)),
      })),
    },
  }
}

export function addDraftPlaceholder(draft: PlaceholderDraft, item: PlaceholderItem, folderIdRaw?: string): PlaceholderDraft {
  const name = text(item.name)
  const folderId = text(folderIdRaw)
  const updatedAt = new Date().toISOString()
  const baselines = name ? { ...draft.baselines, [name]: name } : { ...draft.baselines }
  return {
    baselines,
    library: {
      ...draft.library,
      placeholders: draft.library.placeholders.concat(item),
      folders: folderId
        ? draft.library.folders.map((folder) => folder.id === folderId
          ? { ...folder, placeholderNames: sortedNames([...(folder.placeholderNames || []), name]), updatedAt }
          : folder)
        : draft.library.folders,
    },
  }
}

export function removeDraftPlaceholder(draft: PlaceholderDraft, nameRaw: string): PlaceholderDraft {
  const name = text(nameRaw)
  if (!name) return draft
  const baselines = { ...draft.baselines }
  delete baselines[name]
  return {
    baselines,
    library: {
      ...draft.library,
      placeholders: draft.library.placeholders.filter((item) => text(item.name) !== name),
      folders: draft.library.folders.map((folder) => ({ ...folder, placeholderNames: (folder.placeholderNames || []).filter((entry) => entry !== name) })),
    },
  }
}

export function setDraftFolderMembership(draft: PlaceholderDraft, nameRaw: string, membership: Record<string, boolean>): PlaceholderDraft {
  const name = text(nameRaw)
  if (!name) return draft
  return updateDraftLibrary(draft, (library) => ({
    ...library,
    folders: library.folders.map((folder) => {
      const names = new Set((folder.placeholderNames || []).filter((entry) => entry !== name))
      if (membership[folder.id] === true) names.add(name)
      return { ...folder, placeholderNames: sortedNames(names) }
    }),
  }))
}

export function markDraftPlaceholderSaved(draft: PlaceholderDraft, nameRaw: string): PlaceholderDraft {
  const name = text(nameRaw)
  if (!name) return draft
  const identity = serverIdentityOf(draft, name)
  const baselines = { ...draft.baselines }
  delete baselines[identity]
  baselines[name] = name
  return { ...draft, baselines }
}

export function planPlaceholderCreate(baseLibrary: unknown, item: PlaceholderItem, folderIdRaw?: string): PlaceholderLibrary {
  const name = text(item.name)
  const folderId = text(folderIdRaw)
  const updatedAt = new Date().toISOString()
  const library = normalizePlaceholderLibrary(baseLibrary)
  library.placeholders = library.placeholders.filter((entry) => text(entry.name) !== name).concat({ ...item })
  if (folderId && name) {
    library.folders = library.folders.map((folder) => folder.id === folderId
      ? { ...folder, placeholderNames: sortedNames([...(folder.placeholderNames || []), name]), updatedAt }
      : folder)
  }
  return library
}

export function planPlaceholderDelete(baseLibrary: unknown, namesRaw: Iterable<string>): PlaceholderLibrary {
  const names = new Set(Array.from(namesRaw).map(text).filter(Boolean))
  const library = normalizePlaceholderLibrary(baseLibrary)
  library.placeholders = library.placeholders.filter((entry) => !names.has(text(entry.name)))
  library.folders = library.folders.map((folder) => ({ ...folder, placeholderNames: (folder.placeholderNames || []).filter((name) => !names.has(name)) }))
  return library
}

export type PlaceholderSavePlan = { ok: true; library: PlaceholderLibrary } | { ok: false; error: string }

// 把草稿里指定占位符（字段 + 收藏归属）合并进服务端库；其他未保存草稿保持不动。
export function planPlaceholderSave(
  baseLibrary: unknown,
  draft: PlaceholderDraft,
  nameRaw: string,
  membershipOverride?: Record<string, boolean>,
): PlaceholderSavePlan {
  const name = text(nameRaw)
  if (!name) return { ok: false, error: '占位符名字不能为空' }
  const item = draft.library.placeholders.find((entry) => text(entry.name) === name)
  if (!item) return { ok: false, error: '占位符不存在' }
  if (draft.library.placeholders.some((entry) => entry !== item && text(entry.name) === name)) {
    return { ok: false, error: '占位符名字必须全局唯一' }
  }

  const identity = serverIdentityOf(draft, name)
  const next = normalizePlaceholderLibrary(baseLibrary)
  next.placeholders = next.placeholders.filter((entry) => {
    const entryName = text(entry.name)
    return entryName !== identity && entryName !== name
  })
  next.placeholders.push({ ...item })
  next.folders = next.folders.map((folder) => {
    const names = new Set((folder.placeholderNames || []).filter((entry) => entry !== identity && entry !== name))
    const include = membershipOverride
      ? membershipOverride[folder.id] === true
      : !!draft.library.folders.find((entry) => entry.id === folder.id)?.placeholderNames?.includes(name)
    if (include) names.add(name)
    return { ...folder, placeholderNames: sortedNames(names) }
  })
  return { ok: true, library: next }
}

function collectFolderIdsByName(folders: PlaceholderFolder[]) {
  const map = new Map<string, Set<string>>()
  for (const folder of folders) {
    for (const name of folder.placeholderNames || []) {
      const set = map.get(name) || new Set<string>()
      set.add(folder.id)
      map.set(name, set)
    }
  }
  return map
}

// 未保存标记：草稿条目与服务端条目（按原名对应）在字段或收藏归属上有差异时算脏。
export function computeDirtyNames(baseLibrary: unknown, draft: PlaceholderDraft): Set<string> {
  const dirty = new Set<string>()
  if (!baseLibrary) return dirty
  const base = normalizePlaceholderLibrary(baseLibrary)
  const baseByName = new Map(base.placeholders.map((entry) => [text(entry.name), entry]))
  const folderIdsByServerName = collectFolderIdsByName(base.folders)
  const folderIdsByDraftName = collectFolderIdsByName(draft.library.folders)

  for (const item of draft.library.placeholders) {
    const name = text(item.name)
    if (!name) continue
    const identity = serverIdentityOf(draft, name)
    const baseItem = baseByName.get(identity)
    const fieldsDirty = !baseItem
      || text(baseItem.value) !== text(item.value)
      || text(baseItem.description) !== text(item.description)
      || identity !== name
    const draftFolderIds = folderIdsByDraftName.get(name) || new Set<string>()
    const baseFolderIds = folderIdsByServerName.get(identity) || new Set<string>()
    const membershipDirty = draftFolderIds.size !== baseFolderIds.size || Array.from(draftFolderIds).some((id) => !baseFolderIds.has(id))
    if (fieldsDirty || membershipDirty) dirty.add(name)
  }
  return dirty
}
