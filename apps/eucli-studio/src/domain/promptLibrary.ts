// 提示词仓库的客户端事实：作用域、提示词本体、收藏夹索引、以及收藏夹与条目混排后的当前层。
// 校验与时间戳由 Agent 端负责；客户端只做形状归一与导航计算。

export type PromptScope = 'global' | 'role' | 'workspace'

export type PromptEntry = {
  id: string
  name: string
  content: string
  description: string
  createdAt: string
  updatedAt: string
}

export type PromptLibrary = {
  prompts: PromptEntry[]
}

export type PromptFolder = {
  id: string
  name: string
  folderIds: string[]
  promptIds: string[]
  /** 混排顺序：元素形如 folder:<id> 或 prompt:<id>。 */
  entryOrder: string[]
  createdAt: string
  updatedAt: string
}

export type PromptFolderLibrary = {
  rootFolderIds: string[]
  /** 根级混排顺序。 */
  rootEntryOrder: string[]
  folders: PromptFolder[]
}

export const EMPTY_PROMPT_LIBRARY: PromptLibrary = { prompts: [] }
export const EMPTY_PROMPT_FOLDER_LIBRARY: PromptFolderLibrary = { rootFolderIds: [], rootEntryOrder: [], folders: [] }

function text(value: unknown) {
  return String(value ?? '').trim()
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    const id = text(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

export function normalizePromptEntry(raw: any): PromptEntry {
  return {
    id: text(raw?.id),
    name: text(raw?.name),
    content: String(raw?.content ?? ''),
    description: text(raw?.description),
    createdAt: text(raw?.createdAt),
    updatedAt: text(raw?.updatedAt),
  }
}

export function normalizePromptLibrary(raw: any): PromptLibrary {
  const seen = new Set<string>()
  const prompts: PromptEntry[] = []
  if (Array.isArray(raw?.prompts)) {
    for (const item of raw.prompts) {
      const entry = normalizePromptEntry(item)
      if (!entry.id || seen.has(entry.id)) continue
      seen.add(entry.id)
      prompts.push(entry)
    }
  }
  return { prompts }
}

export function normalizePromptFolder(raw: any): PromptFolder {
  return {
    id: text(raw?.id),
    name: text(raw?.name),
    folderIds: textList(raw?.folderIds),
    promptIds: textList(raw?.promptIds),
    entryOrder: textList(raw?.entryOrder),
    createdAt: text(raw?.createdAt),
    updatedAt: text(raw?.updatedAt),
  }
}

export function normalizePromptFolderLibrary(raw: any): PromptFolderLibrary {
  const seen = new Set<string>()
  const folders: PromptFolder[] = []
  if (Array.isArray(raw?.folders)) {
    for (const item of raw.folders) {
      const folder = normalizePromptFolder(item)
      if (!folder.id || seen.has(folder.id)) continue
      seen.add(folder.id)
      folders.push(folder)
    }
  }
  return {
    rootFolderIds: textList(raw?.rootFolderIds),
    rootEntryOrder: textList(raw?.rootEntryOrder),
    folders,
  }
}

// ---------------------------------------------------------------- 混排顺序

export type PromptEntryKind = 'folder' | 'prompt'

export function promptEntryKey(kind: PromptEntryKind, id: string): string {
  return `${kind}:${id}`
}

export function parsePromptEntryKey(key: string): { kind: PromptEntryKind; id: string } | null {
  const index = key.indexOf(':')
  if (index <= 0) return null
  const kind = key.slice(0, index)
  const id = key.slice(index + 1).trim()
  if (!id) return null
  if (kind !== 'folder' && kind !== 'prompt') return null
  return { kind, id }
}

export type PromptLayerEntry =
  | { kind: 'folder'; key: string; id: string; folder: PromptFolder }
  | { kind: 'prompt'; key: string; id: string; prompt: PromptEntry }

export type PromptFolderCrumb = {
  id: string
  name: string
}

export type PromptFolderLayer = {
  /** 当前收藏夹 id；空串表示根级。 */
  folderId: string
  /** 从根到当前的路径，用于面包屑与返回上一级。 */
  crumbs: PromptFolderCrumb[]
  /** 当前层的混排条目：收藏夹与提示词同处一个列表。 */
  entries: PromptLayerEntry[]
}

const ROOT_CRUMB: PromptFolderCrumb = { id: '', name: '全部提示词' }

// 从根向下找收藏夹路径；找不到时返回 null（调用方回落到根级）。
function findFolderPath(library: PromptFolderLibrary, folderId: string): PromptFolder[] | null {
  const byId = new Map(library.folders.map((folder) => [folder.id, folder]))
  const walk = (ids: string[], trail: PromptFolder[]): PromptFolder[] | null => {
    for (const id of ids) {
      const folder = byId.get(id)
      if (!folder) continue
      const next = [...trail, folder]
      if (folder.id === folderId) return next
      const found = walk(folder.folderIds, next)
      if (found) return found
    }
    return null
  }
  return walk(library.rootFolderIds, [])
}

// 按混排顺序合成当前层：顺序里没有的项按「收藏夹在前、条目在后」补齐到末尾，
// 这样服务端刚新增而顺序还没跟上时也不会丢条目。
function buildLayerEntries(
  order: string[],
  folderIds: string[],
  promptIds: string[],
  folderById: Map<string, PromptFolder>,
  promptById: Map<string, PromptEntry>,
): PromptLayerEntry[] {
  const entries: PromptLayerEntry[] = []
  const used = new Set<string>()
  for (const key of order) {
    const parsed = parsePromptEntryKey(key)
    if (!parsed || used.has(key)) continue
    if (parsed.kind === 'folder') {
      const folder = folderById.get(parsed.id)
      if (!folder) continue
      entries.push({ kind: 'folder', key, id: parsed.id, folder })
      used.add(key)
      continue
    }
    const prompt = promptById.get(parsed.id)
    if (!prompt) continue
    entries.push({ kind: 'prompt', key, id: parsed.id, prompt })
    used.add(key)
  }
  for (const id of folderIds) {
    const key = promptEntryKey('folder', id)
    if (used.has(key)) continue
    const folder = folderById.get(id)
    if (!folder) continue
    entries.push({ kind: 'folder', key, id, folder })
    used.add(key)
  }
  for (const id of promptIds) {
    const key = promptEntryKey('prompt', id)
    if (used.has(key)) continue
    const prompt = promptById.get(id)
    if (!prompt) continue
    entries.push({ kind: 'prompt', key, id, prompt })
    used.add(key)
  }
  return entries
}

// 解析当前层：根级是全部提示词加根收藏夹，夹内是该夹的子收藏夹与该夹索引的条目。
export function resolvePromptFolderLayer(
  folderLibrary: PromptFolderLibrary,
  promptLibrary: PromptLibrary,
  currentFolderId: string,
): PromptFolderLayer {
  const byFolderId = new Map(folderLibrary.folders.map((folder) => [folder.id, folder]))
  const byPromptId = new Map(promptLibrary.prompts.map((prompt) => [prompt.id, prompt]))
  const currentId = text(currentFolderId)

  if (currentId) {
    const path = findFolderPath(folderLibrary, currentId)
    if (path) {
      const current = path[path.length - 1]
      return {
        folderId: current.id,
        crumbs: [ROOT_CRUMB, ...path.map((folder) => ({ id: folder.id, name: folder.name }))],
        entries: buildLayerEntries(current.entryOrder, current.folderIds, current.promptIds, byFolderId, byPromptId),
      }
    }
  }

  const allPromptIds = promptLibrary.prompts.map((prompt) => prompt.id)
  return {
    folderId: '',
    crumbs: [ROOT_CRUMB],
    entries: buildLayerEntries(folderLibrary.rootEntryOrder, folderLibrary.rootFolderIds, allPromptIds, byFolderId, byPromptId),
  }
}

// 当前层能否返回上一级。
export function promptFolderParentId(layer: PromptFolderLayer): string {
  return layer.crumbs.length > 1 ? layer.crumbs[layer.crumbs.length - 2].id : ''
}

// 收集某个收藏夹及其全部后代的 id：移动收藏夹时不能把它放进自己的子树。
export function collectPromptFolderSubtreeIds(library: PromptFolderLibrary, folderId: string): string[] {
  const byId = new Map(library.folders.map((folder) => [folder.id, folder]))
  const result: string[] = []
  const walk = (id: string) => {
    const folder = byId.get(id)
    if (!folder) return
    result.push(id)
    for (const childId of folder.folderIds) walk(childId)
  }
  walk(folderId)
  return result
}

// 当前层的混排 key 顺序：拖拽后直接提交给排序接口。
export function promptLayerKeys(layer: PromptFolderLayer): string[] {
  return layer.entries.map((entry) => entry.key)
}

// 本地先按新顺序重排：拖拽松手时立刻生效，避免等服务端回来才归位造成的回跳。
export function applyPromptEntryOrder(library: PromptFolderLibrary, folderId: string, order: string[]): PromptFolderLibrary {
  if (!text(folderId)) return { ...library, rootEntryOrder: order }
  return {
    ...library,
    folders: library.folders.map((folder) => (folder.id === folderId ? { ...folder, entryOrder: order } : folder)),
  }
}

// 把顺序补齐成「本层全部条目」的完整排列：已有顺序里有效的项保持原位，缺失项追加到末尾。
// 客户端提交排序或整库保存前都要先补齐，服务端只接受完整排列。
function mergeOrderKeys(order: string[], expected: string[]): string[] {
  const expectedSet = new Set(expected)
  const result: string[] = []
  const used = new Set<string>()
  for (const key of order) {
    if (!expectedSet.has(key) || used.has(key)) continue
    result.push(key)
    used.add(key)
  }
  for (const key of expected) {
    if (used.has(key)) continue
    result.push(key)
    used.add(key)
  }
  return result
}

// 夹内完整混排顺序。
export function completeFolderEntryOrder(folder: PromptFolder): string[] {
  const expected = [
    ...folder.folderIds.map((id) => promptEntryKey('folder', id)),
    ...folder.promptIds.map((id) => promptEntryKey('prompt', id)),
  ]
  return mergeOrderKeys(folder.entryOrder, expected)
}

// 根级完整混排顺序：根收藏夹加全部提示词。
export function completeRootEntryOrder(library: PromptFolderLibrary, promptLibrary: PromptLibrary): string[] {
  const expected = [
    ...library.rootFolderIds.map((id) => promptEntryKey('folder', id)),
    ...promptLibrary.prompts.map((prompt) => promptEntryKey('prompt', prompt.id)),
  ]
  return mergeOrderKeys(library.rootEntryOrder, expected)
}

// 归属解析：只认当前作用域里真实存在的归属。
// 切换作用域时旧的归属 id（例如角色 id）不会带进工作区请求，直接回落到该作用域的第一个归属。
export function resolveActiveOwnerId(scope: PromptScope, ownerId: string, ownerIds: unknown[]): string {
  if (scope === 'global') return ''
  const ids = ownerIds.map((id) => text(id)).filter(Boolean)
  const current = text(ownerId)
  return ids.includes(current) ? current : ids[0] ?? ''
}

// 生成一个客户端临时 id：服务端只把它当普通字符串，冲突时由服务端校验拒绝。
export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
