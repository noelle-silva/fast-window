import { uid } from '../core/utils'

export type PlaceholderItem = {
  name: string
  value: string
  description?: string
  source?: { kind?: string; pluginId?: string; interfaceId?: string }
  createdAt?: string
}

export type PlaceholderFolder = {
  id: string
  name: string
  parentId?: string
  placeholderNames?: string[]
  createdAt?: string
  updatedAt?: string
}

export type PlaceholderLibrary = {
  placeholders: PlaceholderItem[]
  folders: PlaceholderFolder[]
}

export type PlaceholderProblem = {
  name: string
  type: string
}

export type PlaceholderResolveResult = {
  text: string
  problems: PlaceholderProblem[]
}

export type PlaceholderDependencyNode = {
  name: string
  missing?: boolean
  cycle?: boolean
  children?: PlaceholderDependencyNode[]
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizePlaceholderLibrary(raw: unknown): PlaceholderLibrary {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  const placeholdersRaw = Array.isArray(box.placeholders) ? box.placeholders : []
  const placeholders: PlaceholderItem[] = []
  const knownNames = new Set<string>()
  for (const itemRaw of placeholdersRaw) {
    const item = itemRaw && typeof itemRaw === 'object' ? (itemRaw as any) : {}
    const name = text(item.name)
    if (!name) continue
    knownNames.add(name)
    const source = item.source && typeof item.source === 'object' ? { kind: text(item.source.kind), pluginId: text(item.source.pluginId), interfaceId: text(item.source.interfaceId) } : undefined
    placeholders.push({ name, value: String(item.value ?? ''), description: text(item.description), source, createdAt: text(item.createdAt) || new Date().toISOString() })
  }
  placeholders.sort((left, right) => left.name.localeCompare(right.name))

  const foldersRaw = Array.isArray(box.folders) ? box.folders : []
  const folders: PlaceholderFolder[] = []
  const knownFolderIds = new Set<string>()
  for (const folderRaw of foldersRaw) {
    const folder = folderRaw && typeof folderRaw === 'object' ? (folderRaw as any) : {}
    const id = text(folder.id)
    const name = text(folder.name)
    if (!id || !name || knownFolderIds.has(id)) continue
    knownFolderIds.add(id)
    const names: string[] = Array.isArray(folder.placeholderNames)
      ? folder.placeholderNames.map((item: unknown) => text(item)).filter((item: string) => item !== '' && knownNames.has(item))
      : []
    folders.push({
      id,
      name,
      parentId: text(folder.parentId),
      placeholderNames: Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)),
      createdAt: text(folder.createdAt) || new Date().toISOString(),
      updatedAt: text(folder.updatedAt) || text(folder.createdAt) || new Date().toISOString(),
    })
  }
  for (const folder of folders) {
    if (folder.parentId === folder.id || !knownFolderIds.has(String(folder.parentId || ''))) folder.parentId = ''
  }
  folders.sort((left, right) => {
    const p = String(left.parentId || '').localeCompare(String(right.parentId || ''))
    return p || left.name.localeCompare(right.name)
  })
  return { placeholders, folders }
}

export function normalizePlaceholderProblems(raw: unknown): PlaceholderProblem[] {
  const items = Array.isArray(raw) ? raw : []
  return items
    .map((item) => {
      const box = item && typeof item === 'object' ? (item as any) : {}
      return { name: text(box.name), type: text(box.type) }
    })
    .filter((item) => item.name && item.type)
}

export function normalizePlaceholderResolveResult(raw: unknown): PlaceholderResolveResult {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  return { text: String(box.text ?? ''), problems: normalizePlaceholderProblems(box.problems) }
}

export function normalizePlaceholderDependencyNode(raw: unknown): PlaceholderDependencyNode {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  return {
    name: text(box.name),
    missing: !!box.missing,
    cycle: !!box.cycle,
    children: Array.isArray(box.children) ? box.children.map(normalizePlaceholderDependencyNode).filter((item: PlaceholderDependencyNode) => item.name) : [],
  }
}

export function createPlaceholderItem(): PlaceholderItem {
  return { name: '', value: '', description: '', createdAt: new Date().toISOString() }
}

export function createPlaceholderFolder(): PlaceholderFolder {
  const ts = new Date().toISOString()
  return { id: uid('placeholder-folder'), name: '新收藏夹', parentId: '', placeholderNames: [], createdAt: ts, updatedAt: ts }
}

export function placeholderProblemLabel(type: string) {
  if (type === 'cycle_reference') return '循环引用'
  if (type === 'duplicate_name') return '重复名称'
  if (type === 'plugin_failed') return '插件取值失败'
  return type || '未知问题'
}
