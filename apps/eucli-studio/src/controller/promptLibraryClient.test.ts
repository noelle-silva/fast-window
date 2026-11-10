import { describe, expect, it } from 'vitest'
import {
  addFolderToFolder,
  addPromptToFolder,
  deletePromptEntry,
  deletePromptFolder,
  loadPromptFolders,
  loadPromptLibrary,
  movePromptFolder,
  movePromptToFolder,
  removeFolderFromParent,
  removePromptFromFolder,
  renamePromptFolder,
  reorderPromptFolderEntries,
  savePromptFolders,
  savePromptLibrary,
} from './promptLibraryClient'
import { PROMPT_LIBRARY_ENDPOINTS } from './promptLibraryEndpoints'

const EMPTY_LIBRARY = { prompts: [] }
const EMPTY_FOLDERS = { rootFolderIds: [], rootEntryOrder: [], folders: [] }

function createRecorder() {
  const calls: Array<{ method: string; path: string; body?: any }> = []
  const netRequest = async (req: any) => {
    calls.push({ method: req.method, path: String(req.path), body: req.body })
    return { body: String(req.path).includes('prompt-folders') ? EMPTY_FOLDERS : EMPTY_LIBRARY }
  }
  return { calls, netRequest }
}

// 回归：归属 query 只能出现在路径末尾。
// 之前把 ?ownerId=… 拼在作用域根路径上再追加子路径，子路径被并进 query，
// 服务端只看到 /api/prompt-library/role，非 GET 方法直接 405。
describe('提示词库请求路径', () => {
  it('keeps the scope path clean for the global library', async () => {
    const { calls, netRequest } = createRecorder()

    await loadPromptLibrary(netRequest, 'global', '')
    await savePromptLibrary(netRequest, 'global', '', EMPTY_LIBRARY)

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/prompt-library/global',
      'PUT /api/prompt-library/global',
    ])
  })

  it('puts the owner query on the scope root request', async () => {
    const { calls, netRequest } = createRecorder()

    await loadPromptLibrary(netRequest, 'role', 'role-1')

    expect(calls[0].path).toBe('/api/prompt-library/role?ownerId=role-1')
  })

  it('keeps sub-paths before the owner query', async () => {
    const { calls, netRequest } = createRecorder()

    await deletePromptEntry(netRequest, 'workspace', 'ws-1', 'p1')
    await deletePromptFolder(netRequest, 'workspace', 'ws-1', 'f1')
    await renamePromptFolder(netRequest, 'workspace', 'ws-1', 'f1', '新名字')

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'DELETE /api/prompt-library/workspace/prompts/p1?ownerId=ws-1',
      'DELETE /api/prompt-folders/workspace/folders/f1?ownerId=ws-1',
      'PATCH /api/prompt-folders/workspace/folders/f1?ownerId=ws-1',
    ])
  })

  it('merges the folder query with the owner query', async () => {
    const { calls, netRequest } = createRecorder()

    await reorderPromptFolderEntries(netRequest, 'role', 'role-1', '', ['prompt:p2'])
    await reorderPromptFolderEntries(netRequest, 'role', 'role-1', 'f1', ['prompt:p2'])
    await removeFolderFromParent(netRequest, 'role', 'role-1', 'f1', '')

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'PUT /api/prompt-folders/role/order?ownerId=role-1',
      'PUT /api/prompt-folders/role/order?ownerId=role-1&parentId=f1',
      'DELETE /api/prompt-folders/role/folders/f1/collect?ownerId=role-1',
    ])
  })

  it('keeps the collection and move endpoints intact', async () => {
    const { calls, netRequest } = createRecorder()

    await addPromptToFolder(netRequest, 'role', 'role-1', 'f1', 'p1')
    await removePromptFromFolder(netRequest, 'role', 'role-1', 'f1', 'p1')
    await movePromptFolder(netRequest, 'role', 'role-1', 'f1', '', 'f2')
    await addFolderToFolder(netRequest, 'role', 'role-1', 'f1', 'f2')
    await movePromptToFolder(netRequest, 'role', 'role-1', 'p1', 'f1', '')

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/prompt-folders/role/folders/f1/prompts?ownerId=role-1',
      'DELETE /api/prompt-folders/role/folders/f1/prompts/p1?ownerId=role-1',
      'POST /api/prompt-folders/role/folders/f1/move?ownerId=role-1',
      'POST /api/prompt-folders/role/folders/f1/collect?ownerId=role-1',
      'POST /api/prompt-folders/role/prompts/p1/move?ownerId=role-1',
    ])
  })

  it('encodes ids that contain slashes instead of breaking the path', async () => {
    const { calls, netRequest } = createRecorder()

    await deletePromptEntry(netRequest, 'role', 'role-1', 'a/b')

    expect(calls[0].path).toBe('/api/prompt-library/role/prompts/a%2Fb?ownerId=role-1')
  })

  it('refuses non-global scopes without an owner', async () => {
    const { netRequest } = createRecorder()

    await expect(loadPromptFolders(netRequest, 'workspace', '')).rejects.toThrow('请先选择归属')
  })

  it('keeps folder loads on the scope root', async () => {
    const { calls, netRequest } = createRecorder()

    await loadPromptFolders(netRequest, 'workspace', 'ws-1')
    await savePromptFolders(netRequest, 'workspace', 'ws-1', EMPTY_FOLDERS)

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/prompt-folders/workspace?ownerId=ws-1',
      'PUT /api/prompt-folders/workspace?ownerId=ws-1',
    ])
  })
})

describe('提示词库端点表', () => {
  it('declares a method and a scoped api path for every endpoint', () => {
    const entries = Object.entries(PROMPT_LIBRARY_ENDPOINTS)
    expect(entries).toHaveLength(14)

    for (const [, endpoint] of entries) {
      expect(['GET', 'PUT', 'POST', 'PATCH', 'DELETE']).toContain(endpoint.method)
      expect(endpoint.path.startsWith('prompt-')).toBe(true)
      expect(endpoint.path).toContain(':scope')
    }
  })

  it('fails fast when a path parameter is missing', async () => {
    const { netRequest } = createRecorder()

    await expect(deletePromptEntry(netRequest, 'role', 'role-1', '')).rejects.toThrow('缺少路径参数：promptId')
  })
})
