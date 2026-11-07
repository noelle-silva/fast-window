// 提示词仓库的客户端事实：作用域、提示词本体、收藏夹索引，以及收藏夹树在当前层的展开。
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
  createdAt: string
  updatedAt: string
}

export type PromptFolderLibrary = {
  rootFolderIds: string[]
  folders: PromptFolder[]
}

export const EMPTY_PROMPT_LIBRARY: PromptLibrary = { prompts: [] }
export const EMPTY_PROMPT_FOLDER_LIBRARY: PromptFolderLibrary = { rootFolderIds: [], folders: [] }

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
    createdAt: text(raw?.createdAt),
    updatedAt: text(raw?.updatedAt),
  }
}

export function normalizePromptFolderLibrary(raw: any): PromptFolderLibrary {
  const folders = Array.isArray(raw?.folders) ? raw.folders.map(normalizePromptFolder).filter((folder: PromptFolder) => folder.id) : []
  return { rootFolderIds: textList(raw?.rootFolderIds), folders }
}

export type PromptFolderCrumb = {
  id: string
  name: string
}

// 归属解析：只认当前作用域里真实存在的归属。
// 切换作用域时旧的归属 id（例如角色 id）不会带进工作区请求，直接回落到该作用域的第一个归属。
export function resolveActiveOwnerId(scope: PromptScope, ownerId: string, ownerIds: unknown[]): string {
  if (scope === 'global') return ''
  const ids = ownerIds.map((id) => text(id)).filter(Boolean)
  const current = text(ownerId)
  return ids.includes(current) ? current : ids[0] ?? ''
}

export type PromptFolderLayer = {
  /** 当前收藏夹 id；空串表示根级。 */
  folderId: string
  /** 从根到当前的路径，用于面包屑与返回上一级。 */
  crumbs: PromptFolderCrumb[]
  /** 当前层的子收藏夹，顺序即索引顺序。 */
  folders: PromptFolder[]
  /** 当前层的提示词条目，顺序即索引顺序。 */
  prompts: PromptEntry[]
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

// 收集所有被收藏夹索引过的提示词 id：根级只展示「还没被收进任何夹子」的条目。
export function collectIndexedPromptIds(library: PromptFolderLibrary): Set<string> {
  const indexed = new Set<string>()
  for (const folder of library.folders) {
    for (const id of folder.promptIds) indexed.add(id)
  }
  return indexed
}

// 解析当前层：子收藏夹在前、条目在后，两者各自保持索引顺序。
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
      const folders = current.folderIds.map((id) => byFolderId.get(id)).filter((folder): folder is PromptFolder => Boolean(folder))
      const prompts = current.promptIds.map((id) => byPromptId.get(id)).filter((prompt): prompt is PromptEntry => Boolean(prompt))
      return {
        folderId: current.id,
        crumbs: [ROOT_CRUMB, ...path.map((folder) => ({ id: folder.id, name: folder.name }))],
        folders,
        prompts,
      }
    }
  }

  const indexed = collectIndexedPromptIds(folderLibrary)
  const folders = folderLibrary.rootFolderIds.map((id) => byFolderId.get(id)).filter((folder): folder is PromptFolder => Boolean(folder))
  const prompts = promptLibrary.prompts.filter((prompt) => !indexed.has(prompt.id))
  return { folderId: '', crumbs: [ROOT_CRUMB], folders, prompts }
}

// 当前层能否返回上一级。
export function promptFolderParentId(layer: PromptFolderLayer): string {
  return layer.crumbs.length > 1 ? layer.crumbs[layer.crumbs.length - 2].id : ''
}

// 把「当前层条目的新顺序」合回本体顺序：只改动这些条目的相对位置，其余条目原位不动。
export function mergePromptOrder(base: PromptEntry[], orderedIds: string[]): PromptEntry[] {
  const order = orderedIds.slice()
  if (!order.length) return base
  let cursor = 0
  return base.map((prompt) => {
    if (!order.includes(prompt.id)) return prompt
    const nextId = order[cursor]
    cursor += 1
    return base.find((entry) => entry.id === nextId) ?? prompt
  })
}

// 生成一个客户端临时 id：服务端只把它当普通字符串，冲突时由服务端校验拒绝。
export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
