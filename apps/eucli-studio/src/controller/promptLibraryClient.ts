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

// 混排排序：parentId 为空表示根级；entryOrder 元素形如 folder:<id> / prompt:<id>。
export async function reorderPromptFolderEntries(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, parentId: string, entryOrder: string[]): Promise<PromptFolderLibrary> {
  const base = `${folderScopePath(scope, ownerId)}/order`
  const path = text(parentId) ? `${base}${base.includes('?') ? '&' : '?'}parentId=${encodeURIComponent(text(parentId))}` : base
  const response = await netRequest({ method: 'PUT', path, body: { entryOrder } })
  return normalizePromptFolderLibrary(response?.body)
}

// 收进收藏夹：只加索引，不复制提示词内容。
export async function addPromptToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, promptId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'POST',
    path: `${folderScopePath(scope, ownerId)}/folders/${encodeURIComponent(text(folderId))}/prompts`,
    body: { promptId: text(promptId) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 移出收藏夹：只摘索引，提示词本体保留。
export async function removePromptFromFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, promptId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'DELETE',
    path: `${folderScopePath(scope, ownerId)}/folders/${encodeURIComponent(text(folderId))}/prompts/${encodeURIComponent(text(promptId))}`,
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 移动收藏夹：parentId 为空表示移到根级。
export async function movePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, fromParentId: string, toParentId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'POST',
    path: `${folderScopePath(scope, ownerId)}/folders/${encodeURIComponent(text(folderId))}/move`,
    body: { fromParentId: text(fromParentId), toParentId: text(toParentId) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 把收藏夹收藏到某个层：只加一处索引，别处引用不动。
export async function addFolderToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, parentId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'POST',
    path: `${folderScopePath(scope, ownerId)}/folders/${encodeURIComponent(text(folderId))}/collect`,
    body: { parentId: text(parentId) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 提示词移动到另一个收藏夹：fromFolderId 为空表示原来在根级，toFolderId 为空表示移出到根级。
export async function movePromptToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, promptId: string, fromFolderId: string, toFolderId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'POST',
    path: `${folderScopePath(scope, ownerId)}/prompts/${encodeURIComponent(text(promptId))}/move`,
    body: { fromFolderId: text(fromFolderId), toFolderId: text(toFolderId) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

export { withOwner }
