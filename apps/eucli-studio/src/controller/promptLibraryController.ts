import type { AiChatShowToast } from '../gateway/capabilities'
import type { PromptFolderLibrary, PromptLibrary, PromptScope } from '../domain/promptLibrary'
import {
  deletePromptEntry,
  deletePromptFolder,
  loadPromptFolders,
  loadPromptLibrary,
  addFolderToFolder,
  addPromptToFolder,
  movePromptFolder,
  movePromptToFolder,
  removePromptFromFolder,
  renamePromptFolder,
  reorderPromptFolderEntries,
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
    // 面板的提示统一走这里弹出，不在页面上找空地硬塞文字。
    notifyPromptLibrary: (message: string, kind: 'error' | 'success' = 'error') => {
      showToast?.(String(message ?? ''), { kind })
    },

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

    reorderPromptFolderEntries: (scope: PromptScope, ownerId: string, parentId: string, entryOrder: string[]): Promise<PromptFolderLibrary> =>
      run('排序失败', () => reorderPromptFolderEntries(requireNetRequest(), scope, ownerId, parentId, entryOrder)),

    addPromptToFolder: (scope: PromptScope, ownerId: string, folderId: string, promptId: string): Promise<PromptFolderLibrary> =>
      run('收藏失败', async () => {
        const saved = await addPromptToFolder(requireNetRequest(), scope, ownerId, folderId, promptId)
        showToast?.('已收进收藏夹', { kind: 'success' })
        return saved
      }),

    movePromptFolder: (scope: PromptScope, ownerId: string, folderId: string, fromParentId: string, toParentId: string): Promise<PromptFolderLibrary> =>
      run('移动收藏夹失败', async () => {
        const saved = await movePromptFolder(requireNetRequest(), scope, ownerId, folderId, fromParentId, toParentId)
        showToast?.('收藏夹已移动', { kind: 'success' })
        return saved
      }),

    addFolderToFolder: (scope: PromptScope, ownerId: string, folderId: string, parentId: string): Promise<PromptFolderLibrary> =>
      run('收藏失败', async () => {
        const saved = await addFolderToFolder(requireNetRequest(), scope, ownerId, folderId, parentId)
        showToast?.('收藏夹已收藏到目标位置', { kind: 'success' })
        return saved
      }),

    movePromptToFolder: (scope: PromptScope, ownerId: string, promptId: string, fromFolderId: string, toFolderId: string): Promise<PromptFolderLibrary> =>
      run('移动提示词失败', async () => {
        const saved = await movePromptToFolder(requireNetRequest(), scope, ownerId, promptId, fromFolderId, toFolderId)
        showToast?.('提示词已移动', { kind: 'success' })
        return saved
      }),

    removePromptFromFolder: (scope: PromptScope, ownerId: string, folderId: string, promptId: string): Promise<PromptFolderLibrary> =>
      run('移出收藏夹失败', async () => {
        const saved = await removePromptFromFolder(requireNetRequest(), scope, ownerId, folderId, promptId)
        showToast?.('已从收藏夹移出', { kind: 'success' })
        return saved
      }),
  }
}
