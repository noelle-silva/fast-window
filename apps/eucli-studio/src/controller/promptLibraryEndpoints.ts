import type { PromptScope } from '../domain/promptLibrary'
import { fillPath, withQuery, type EbNetRequest, type PathQuery } from './netPath'

// 提示词库的请求底座：端点表 + 统一的路径拼装与请求发送。
//
// 端点表与 apps/eucli-box/src/gateway-system/routes.go 的注册一一对应，
// 顺序也按那边排列。改后端路由时，这张表必须同步；路径参数统一写成 :name，
// 由 fillPath 负责取值与编码，调用方不再自己拼字符串。

export type { EbNetRequest } from './netPath'
export type PromptQuery = PathQuery

const API_PREFIX = '/api/'

export const PROMPT_LIBRARY_ENDPOINTS = {
  loadLibrary: { method: 'GET', path: 'prompt-library/:scope' },
  saveLibrary: { method: 'PUT', path: 'prompt-library/:scope' },
  deletePrompt: { method: 'DELETE', path: 'prompt-library/:scope/prompts/:promptId' },
  loadFolders: { method: 'GET', path: 'prompt-folders/:scope' },
  saveFolders: { method: 'PUT', path: 'prompt-folders/:scope' },
  deleteFolder: { method: 'DELETE', path: 'prompt-folders/:scope/folders/:folderId' },
  renameFolder: { method: 'PATCH', path: 'prompt-folders/:scope/folders/:folderId' },
  reorderEntries: { method: 'PUT', path: 'prompt-folders/:scope/order' },
  addPromptToFolder: { method: 'POST', path: 'prompt-folders/:scope/folders/:folderId/prompts' },
  removePromptFromFolder: { method: 'DELETE', path: 'prompt-folders/:scope/folders/:folderId/prompts/:promptId' },
  moveFolder: { method: 'POST', path: 'prompt-folders/:scope/folders/:folderId/move' },
  collectFolder: { method: 'POST', path: 'prompt-folders/:scope/folders/:folderId/collect' },
  uncollectFolder: { method: 'DELETE', path: 'prompt-folders/:scope/folders/:folderId/collect' },
  movePrompt: { method: 'POST', path: 'prompt-folders/:scope/prompts/:promptId/move' },
} as const

export type PromptLibraryEndpoint = (typeof PROMPT_LIBRARY_ENDPOINTS)[keyof typeof PROMPT_LIBRARY_ENDPOINTS]

function text(value: unknown) {
  return String(value ?? '').trim()
}

// 归属查询：全局没有归属；其余作用域必须选好，否则直接失败。
export function scopeQuery(scope: PromptScope, ownerId: string): PromptQuery {
  if (scope === 'global') return {}
  const owner = text(ownerId)
  if (!owner) throw new Error('请先选择归属')
  return { ownerId: owner }
}

// 所有提示词库请求的唯一出口：路径、归属查询、附加查询、请求体都在这里组装。
export async function callPromptEndpoint<T>(options: {
  netRequest: EbNetRequest
  endpoint: PromptLibraryEndpoint
  scope: PromptScope
  ownerId: string
  params?: Record<string, string>
  query?: PromptQuery
  body?: unknown
  normalize: (raw: unknown) => T
}): Promise<T> {
  const { netRequest, endpoint, scope, ownerId, params = {}, query = {}, body, normalize } = options
  const path = withQuery(`${API_PREFIX}${fillPath(endpoint.path, { ...params, scope })}`, {
    ...scopeQuery(scope, ownerId),
    ...query,
  })
  const response = await netRequest({ method: endpoint.method, path, body })
  return normalize(response?.body)
}
