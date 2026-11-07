import {
  normalizePromptFolderLibrary,
  normalizePromptLibrary,
  type PromptFolderLibrary,
  type PromptLibrary,
  type PromptScope,
} from '../domain/promptLibrary'

type EbNetRequest = (req: any) => Promise<any>

function text(value: unknown) {
  return String(value ?? '').trim()
}

// 三个作用域共用一组端点：scope 走路径，归属 id 走查询参数，全局不需要归属。
function scopePath(scope: PromptScope, ownerId: string) {
  const path = `/api/prompt-library/${encodeURIComponent(scope)}`
  if (scope === 'global') return path
  const owner = text(ownerId)
  if (!owner) throw new Error('请先选择归属')
  return `${path}?ownerId=${encodeURIComponent(owner)}`
}

function folderScopePath(scope: PromptScope, ownerId: string) {
  const path = `/api/prompt-folders/${encodeURIComponent(scope)}`
  if (scope === 'global') return path
  const owner = text(ownerId)
  if (!owner) throw new Error('请先选择归属')
  return `${path}?ownerId=${encodeURIComponent(owner)}`
}

function withOwner(path: string, ownerId: string) {
  const owner = text(ownerId)
  return owner ? `${path}?ownerId=${encodeURIComponent(owner)}` : path
}

export async function loadPromptLibrary(netRequest: EbNetRequest, scope: PromptScope, ownerId: string): Promise<PromptLibrary> {
  const response = await netRequest({ method: 'GET', path: scopePath(scope, ownerId) })
  return normalizePromptLibrary(response?.body)
}

export async function savePromptLibrary(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, library: PromptLibrary): Promise<PromptLibrary> {
  const response = await netRequest({ method: 'PUT', path: scopePath(scope, ownerId), body: library })
  return normalizePromptLibrary(response?.body)
}

export async function deletePromptEntry(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, promptId: string): Promise<PromptLibrary> {
  const response = await netRequest({
    method: 'DELETE',
    path: `${scopePath(scope, ownerId)}/prompts/${encodeURIComponent(text(promptId))}`,
  })
  return normalizePromptLibrary(response?.body)
}

export async function loadPromptFolders(netRequest: EbNetRequest, scope: PromptScope, ownerId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({ method: 'GET', path: folderScopePath(scope, ownerId) })
  return normalizePromptFolderLibrary(response?.body)
}

export async function savePromptFolders(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, library: PromptFolderLibrary): Promise<PromptFolderLibrary> {
  const response = await netRequest({ method: 'PUT', path: folderScopePath(scope, ownerId), body: library })
  return normalizePromptFolderLibrary(response?.body)
}

export async function deletePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'DELETE',
    path: `${folderScopePath(scope, ownerId)}/folders/${encodeURIComponent(text(folderId))}`,
  })
  return normalizePromptFolderLibrary(response?.body)
}

export async function renamePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, name: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'PATCH',
    path: `${folderScopePath(scope, ownerId)}/folders/${encodeURIComponent(text(folderId))}`,
    body: { name: text(name) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 兄弟收藏夹排序：parentId 为空表示根级。
export async function reorderPromptFolders(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, parentId: string, folderIds: string[]): Promise<PromptFolderLibrary> {
  const base = `${folderScopePath(scope, ownerId)}/order`
  const path = text(parentId) ? `${base}${base.includes('?') ? '&' : '?'}parentId=${encodeURIComponent(text(parentId))}` : base
  const response = await netRequest({ method: 'PUT', path, body: { folderIds } })
  return normalizePromptFolderLibrary(response?.body)
}

// 收藏夹内条目排序。
export async function reorderFolderPrompts(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, promptIds: string[]): Promise<PromptFolderLibrary> {
  const base = `${folderScopePath(scope, ownerId)}/prompts/order`
  const path = `${base}${base.includes('?') ? '&' : '?'}folderId=${encodeURIComponent(text(folderId))}`
  const response = await netRequest({ method: 'PUT', path, body: { promptIds } })
  return normalizePromptFolderLibrary(response?.body)
}

export { withOwner }
