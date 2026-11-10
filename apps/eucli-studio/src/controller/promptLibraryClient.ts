import {
  normalizePromptFolderLibrary,
  normalizePromptLibrary,
  type PromptFolderLibrary,
  type PromptLibrary,
  type PromptScope,
} from '../domain/promptLibrary'
import { PROMPT_LIBRARY_ENDPOINTS, callPromptEndpoint, type EbNetRequest } from './promptLibraryEndpoints'

// 提示词库的业务 API：每个函数只描述「用哪个端点、哪些路径参数、哪些查询与请求体」。
// 路径拼装、归属查询、编码与发送统一由 promptLibraryEndpoints 负责，
// 新增端点时先往端点表里加一行，再在这里补一个薄函数。

// 请求体里的 id / 名称沿用原来的空白容忍：空串表示「根级」这类语义，不能被丢掉。
function field(value: unknown) {
  return String(value ?? '').trim()
}

export async function loadPromptLibrary(netRequest: EbNetRequest, scope: PromptScope, ownerId: string): Promise<PromptLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.loadLibrary,
    scope,
    ownerId,
    normalize: normalizePromptLibrary,
  })
}

export async function savePromptLibrary(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, library: PromptLibrary): Promise<PromptLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.saveLibrary,
    scope,
    ownerId,
    body: library,
    normalize: normalizePromptLibrary,
  })
}

export async function deletePromptEntry(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, promptId: string): Promise<PromptLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.deletePrompt,
    scope,
    ownerId,
    params: { promptId },
    normalize: normalizePromptLibrary,
  })
}

export async function loadPromptFolders(netRequest: EbNetRequest, scope: PromptScope, ownerId: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.loadFolders,
    scope,
    ownerId,
    normalize: normalizePromptFolderLibrary,
  })
}

export async function savePromptFolders(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, library: PromptFolderLibrary): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.saveFolders,
    scope,
    ownerId,
    body: library,
    normalize: normalizePromptFolderLibrary,
  })
}

export async function deletePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.deleteFolder,
    scope,
    ownerId,
    params: { folderId },
    normalize: normalizePromptFolderLibrary,
  })
}

export async function renamePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, name: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.renameFolder,
    scope,
    ownerId,
    params: { folderId },
    body: { name: field(name) },
    normalize: normalizePromptFolderLibrary,
  })
}

// 混排排序：parentId 为空表示根级；entryOrder 元素形如 folder:<id> / prompt:<id>。
export async function reorderPromptFolderEntries(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, parentId: string, entryOrder: string[]): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.reorderEntries,
    scope,
    ownerId,
    query: { parentId },
    body: { entryOrder },
    normalize: normalizePromptFolderLibrary,
  })
}

// 收进收藏夹：只加索引，不复制提示词内容。
export async function addPromptToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, promptId: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.addPromptToFolder,
    scope,
    ownerId,
    params: { folderId },
    body: { promptId: field(promptId) },
    normalize: normalizePromptFolderLibrary,
  })
}

// 移出收藏夹：只摘索引，提示词本体保留。
export async function removePromptFromFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, promptId: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.removePromptFromFolder,
    scope,
    ownerId,
    params: { folderId, promptId },
    normalize: normalizePromptFolderLibrary,
  })
}

// 移动收藏夹：parentId 为空表示移到根级。
export async function movePromptFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, fromParentId: string, toParentId: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.moveFolder,
    scope,
    ownerId,
    params: { folderId },
    body: { fromParentId: field(fromParentId), toParentId: field(toParentId) },
    normalize: normalizePromptFolderLibrary,
  })
}

// 把收藏夹收藏到某个层：只加一处索引，别处引用不动。
export async function addFolderToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, parentId: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.collectFolder,
    scope,
    ownerId,
    params: { folderId },
    body: { parentId: field(parentId) },
    normalize: normalizePromptFolderLibrary,
  })
}

// 提示词移动到另一个收藏夹：fromFolderId 为空表示原来在根级，toFolderId 为空表示移出到根级。
export async function movePromptToFolder(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, promptId: string, fromFolderId: string, toFolderId: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.movePrompt,
    scope,
    ownerId,
    params: { promptId },
    body: { fromFolderId: field(fromFolderId), toFolderId: field(toFolderId) },
    normalize: normalizePromptFolderLibrary,
  })
}

// 从指定位置摘掉收藏夹索引：parentId 为空表示根级。
export async function removeFolderFromParent(netRequest: EbNetRequest, scope: PromptScope, ownerId: string, folderId: string, parentId: string): Promise<PromptFolderLibrary> {
  return callPromptEndpoint({
    netRequest,
    endpoint: PROMPT_LIBRARY_ENDPOINTS.uncollectFolder,
    scope,
    ownerId,
    params: { folderId },
    query: { parentId },
    normalize: normalizePromptFolderLibrary,
  })
}
