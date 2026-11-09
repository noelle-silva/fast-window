import {
  normalizePromptFolderLibrary,
  normalizePromptLibrary,
  type PromptFolderLibrary,
  type PromptLibrary,
  type PromptScope,
} from '../domain/promptLibrary'

type EbNetRequest = (req: any) => Promise<any>
type Query = Record<string, string>

function text(value: unknown) {
  return String(value ?? '').trim()
}

// 三个作用域共用一组端点：scope 走路径段，归属 id 走查询参数。
//
// 路径与查询必须分开累加：先拼完所有路径段，最后才合并查询串。
// 把 ?ownerId=… 塞在中间再拼子路径，会把子路径并进 query，
// 服务端只看得到作用域根路径，非 GET 的方法就变成 405。
function scopePath(kind: 'prompt-library' | 'prompt-folders', scope: PromptScope): string {
  return `/api/${kind}/${encodeURIComponent(scope)}`
}

function scopeQuery(scope: PromptScope, ownerId: string): Query {
  if (scope === 'global') return {}
  const owner = text(ownerId)
  if (!owner) throw new Error('请先选择归属')
  return { ownerId: owner }
}

function withQuery(path: string, query: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const next = text(value)
    if (next) params.set(key, next)
  }
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

function libraryPath(scope: PromptScope): string {
  return scopePath('prompt-library', scope)
}

function folderPath(scope: PromptScope): string {
  return scopePath('prompt-folders', scope)
}

export async function loadPromptLibrary(netRequest: EbNetRequest, scope: PromptScope, ownerId: string): Promise<PromptLibrary> {
  const response = await netRequest({
    method: 'GET',
    path: withQuery(libraryPath(scope), scopeQuery(scope, ownerId)),
  })
  return normalizePromptLibrary(response?.body)
}

export async function savePromptLibrary(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, library: PromptLibrary): Promise<PromptLibrary> {
  const response = await netRequest({
    method: 'PUT',
    path: withQuery(libraryPath(scope), scopeQuery(scope, ownerId)),
    body: library,
  })
  return normalizePromptLibrary(response?.body)
}

export async function deletePromptEntry(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, promptId: string): Promise<PromptLibrary> {
  const response = await netRequest({
    method: 'DELETE',
    path: withQuery(`${libraryPath(scope)}/prompts/${encodeURIComponent(text(promptId))}`, scopeQuery(scope, ownerId)),
  })
  return normalizePromptLibrary(response?.body)
}

export async function loadPromptFolders(netRequest: EbNetRequest, scope: PromptScope, ownerId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'GET',
    path: withQuery(folderPath(scope), scopeQuery(scope, ownerId)),
  })
  return normalizePromptFolderLibrary(response?.body)
}

export async function savePromptFolders(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, library: PromptFolderLibrary): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'PUT',
    path: withQuery(folderPath(scope), scopeQuery(scope, ownerId)),
    body: library,
  })
  return normalizePromptFolderLibrary(response?.body)
}

export async function deletePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'DELETE',
    path: withQuery(`${folderPath(scope)}/folders/${encodeURIComponent(text(folderId))}`, scopeQuery(scope, ownerId)),
  })
  return normalizePromptFolderLibrary(response?.body)
}

export async function renamePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, name: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'PATCH',
    path: withQuery(`${folderPath(scope)}/folders/${encodeURIComponent(text(folderId))}`, scopeQuery(scope, ownerId)),
    body: { name: text(name) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 混排排序：parentId 为空表示根级；entryOrder 元素形如 folder:<id> / prompt:<id>。
export async function reorderPromptFolderEntries(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, parentId: string, entryOrder: string[]): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'PUT',
    path: withQuery(`${folderPath(scope)}/order`, { ...scopeQuery(scope, ownerId), parentId: text(parentId) }),
    body: { entryOrder },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 收进收藏夹：只加索引，不复制提示词内容。
export async function addPromptToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, promptId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'POST',
    path: withQuery(`${folderPath(scope)}/folders/${encodeURIComponent(text(folderId))}/prompts`, scopeQuery(scope, ownerId)),
    body: { promptId: text(promptId) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 移出收藏夹：只摘索引，提示词本体保留。
export async function removePromptFromFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, promptId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'DELETE',
    path: withQuery(
      `${folderPath(scope)}/folders/${encodeURIComponent(text(folderId))}/prompts/${encodeURIComponent(text(promptId))}`,
      scopeQuery(scope, ownerId),
    ),
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 移动收藏夹：parentId 为空表示移到根级。
export async function movePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, fromParentId: string, toParentId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'POST',
    path: withQuery(`${folderPath(scope)}/folders/${encodeURIComponent(text(folderId))}/move`, scopeQuery(scope, ownerId)),
    body: { fromParentId: text(fromParentId), toParentId: text(toParentId) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 把收藏夹收藏到某个层：只加一处索引，别处引用不动。
export async function addFolderToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, parentId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'POST',
    path: withQuery(`${folderPath(scope)}/folders/${encodeURIComponent(text(folderId))}/collect`, scopeQuery(scope, ownerId)),
    body: { parentId: text(parentId) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 提示词移动到另一个收藏夹：fromFolderId 为空表示原来在根级，toFolderId 为空表示移出到根级。
export async function movePromptToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, promptId: string, fromFolderId: string, toFolderId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'POST',
    path: withQuery(`${folderPath(scope)}/prompts/${encodeURIComponent(text(promptId))}/move`, scopeQuery(scope, ownerId)),
    body: { fromFolderId: text(fromFolderId), toFolderId: text(toFolderId) },
  })
  return normalizePromptFolderLibrary(response?.body)
}

// 从指定位置摘掉收藏夹索引：parentId 为空表示根级。
export async function removeFolderFromParent(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, parentId: string): Promise<PromptFolderLibrary> {
  const response = await netRequest({
    method: 'DELETE',
    path: withQuery(`${folderPath(scope)}/folders/${encodeURIComponent(text(folderId))}/collect`, {
      ...scopeQuery(scope, ownerId),
      parentId: text(parentId),
    }),
  })
  return normalizePromptFolderLibrary(response?.body)
}
