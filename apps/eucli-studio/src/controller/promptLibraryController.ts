import type { AiChatShowToast } from '../gateway/capabilities'
import type { PromptFolderLibrary, PromptLibrary, PromptScope } from '../domain/promptLibrary'
import {
  deletePromptEntry,
  deletePromptFolder,
  loadPromptFolders,
  loadPromptLibrary,
  renamePromptFolder,
  reorderFolderPrompts,
  reorderPromptFolders,
  savePromptFolders,
  savePromptLibrary,
} from './promptLibraryClient'

// 提示词仓库的客户端动作：只做请求转发与错误提示。
// 结构与顺序的规矩全部在 Agent 端判定，客户端不重复实现校验。

export function createPromptLibraryController(deps: {
  getNetRequest: () => ((req: any) => Promise<any>) | undefined
  showToast?: AiChatShowToast
}) {
  const { getNetRequest, showToast } = deps

  function requireNetRequest() {
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    return netRequest
  }

  async function run<T>(label: string, task: () => Promise<T>): Promise<T> {
    try {
      return await task()
    } catch (error: any) {
      const message = String(error?.message || error || label)
      showToast?.(message, { kind: 'error' })
      throw error
    }
  }

  return {
    loadPromptLibrary: (scope: PromptScope, ownerId: string): Promise<PromptLibrary> =>
      run('加载提示词失败', () => loadPromptLibrary(requireNetRequest(), scope, ownerId)),

    savePromptLibrary: (scope: PromptScope, ownerId: string, library: PromptLibrary): Promise<PromptLibrary> =>
      run('保存提示词失败', async () => {
        const saved = await savePromptLibrary(requireNetRequest(), scope, ownerId, library)
        showToast?.('提示词已保存', { kind: 'success' })
        return saved
      }),

    deletePromptEntry: (scope: PromptScope, ownerId: string, promptId: string): Promise<PromptLibrary> =>
      run('删除提示词失败', async () => {
        const saved = await deletePromptEntry(requireNetRequest(), scope, ownerId, promptId)
        showToast?.('提示词已删除', { kind: 'success' })
        return saved
      }),

    loadPromptFolders: (scope: PromptScope, ownerId: string): Promise<PromptFolderLibrary> =>
      run('加载收藏夹失败', () => loadPromptFolders(requireNetRequest(), scope, ownerId)),

    savePromptFolders: (scope: PromptScope, ownerId: string, library: PromptFolderLibrary): Promise<PromptFolderLibrary> =>
      run('保存收藏夹失败', () => savePromptFolders(requireNetRequest(), scope, ownerId, library)),

    deletePromptFolder: (scope: PromptScope, ownerId: string, folderId: string): Promise<PromptFolderLibrary> =>
      run('删除收藏夹失败', async () => {
        const saved = await deletePromptFolder(requireNetRequest(), scope, ownerId, folderId)
        showToast?.('收藏夹已删除，子收藏夹已上移', { kind: 'success' })
        return saved
      }),

    renamePromptFolder: (scope: PromptScope, ownerId: string, folderId: string, name: string): Promise<PromptFolderLibrary> =>
      run('重命名收藏夹失败', async () => {
        const saved = await renamePromptFolder(requireNetRequest(), scope, ownerId, folderId, name)
        showToast?.('收藏夹已重命名', { kind: 'success' })
        return saved
      }),

    reorderPromptFolders: (scope: PromptScope, ownerId: string, parentId: string, folderIds: string[]): Promise<PromptFolderLibrary> =>
      run('收藏夹排序失败', () => reorderPromptFolders(requireNetRequest(), scope, ownerId, parentId, folderIds)),

    reorderFolderPrompts: (scope: PromptScope, ownerId: string, folderId: string, promptIds: string[]): Promise<PromptFolderLibrary> =>
      run('条目排序失败', () => reorderFolderPrompts(requireNetRequest(), scope, ownerId, folderId, promptIds)),
  }
}
