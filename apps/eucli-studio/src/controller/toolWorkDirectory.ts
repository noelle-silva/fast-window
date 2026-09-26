import type { AiChatShowToast } from '../gateway/capabilities'

// 本地记忆键：主人是否见过一次「工具默认工作目录」引导。
export const TOOL_WORK_DIRECTORY_PROMPTED_KEY = 'tool-work-directory-prompted'

export function defaultToolWorkDirectoryState() {
  return {
    loading: false,
    saving: false,
    error: '',
    directory: '',
    draft: '',
    promptOpen: false,
  }
}

// createToolWorkDirectoryController 管理「AI 工具默认工作目录」：
// 配置的读取与保存走业务端接口；「是否引导过」只由客户端本地记忆判断。
export function createToolWorkDirectoryController(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  rtStorage?: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<any> }
  emit: () => void
  showToast?: AiChatShowToast
}) {
  function currentState() {
    const state = deps.getState()
    if (!state.toolWorkDirectory || typeof state.toolWorkDirectory !== 'object') state.toolWorkDirectory = defaultToolWorkDirectoryState()
    return state.toolWorkDirectory
  }

  function patch(partial: Record<string, any>) {
    const state = deps.getState()
    state.toolWorkDirectory = { ...defaultToolWorkDirectoryState(), ...currentState(), ...partial }
  }

  async function loadToolWorkDirectory(): Promise<string> {
    const response = await deps.netRequest({ method: 'GET', path: '/api/tools/work-directory', timeoutMs: 15000 })
    const status = Number(response?.status || 0)
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
    return String(response?.body?.directory || '').trim()
  }

  async function saveToolWorkDirectoryDirectory(directory: string): Promise<string> {
    const response = await deps.netRequest({ method: 'PUT', path: '/api/tools/work-directory', body: { directory }, timeoutMs: 15000 })
    const status = Number(response?.status || 0)
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
    return String(response?.body?.directory || '').trim()
  }

  async function refreshToolWorkDirectory() {
    patch({ loading: true, error: '' })
    deps.emit()
    try {
      const directory = await loadToolWorkDirectory()
      patch({ loading: false, error: '', directory, draft: directory })
      return directory
    } catch (e: any) {
      const error = String(e?.message || e || '工具默认工作目录读取失败')
      patch({ loading: false, error })
      return ''
    } finally {
      deps.emit()
    }
  }

  function setToolWorkDirectoryDraft(value: any) {
    patch({ draft: String(value ?? ''), error: '' })
    deps.emit()
  }

  // persistToolWorkDirectory 保存目录值；空串由业务端归一为默认目录。
  async function persistToolWorkDirectory(directory: string): Promise<string> {
    patch({ saving: true, error: '' })
    deps.emit()
    try {
      const saved = await saveToolWorkDirectoryDirectory(directory)
      patch({ saving: false, error: '', directory: saved, draft: saved })
      deps.showToast?.('工具默认工作目录已保存', { kind: 'success' })
      return saved
    } catch (e: any) {
      const error = String(e?.message || e || '工具默认工作目录保存失败')
      patch({ saving: false, error })
      deps.showToast?.(error, { kind: 'error' })
      return ''
    } finally {
      deps.emit()
    }
  }

  function saveToolWorkDirectory() {
    return persistToolWorkDirectory(String(currentState().draft ?? '').trim())
  }

  function resetToolWorkDirectoryToDefault() {
    return persistToolWorkDirectory('')
  }

  async function readPrompted(): Promise<boolean> {
    try {
      const value = await deps.rtStorage?.get?.(TOOL_WORK_DIRECTORY_PROMPTED_KEY)
      return String(value ?? '') === '1'
    } catch (_) {
      return false
    }
  }

  async function markPrompted() {
    try {
      await deps.rtStorage?.set?.(TOOL_WORK_DIRECTORY_PROMPTED_KEY, '1')
    } catch (_) {
      // 本地记忆失败不阻断关闭：最坏情况是下次再引导一次。
    }
  }

  // checkToolWorkDirectoryPrompt 启动检查：读取配置事实，再按本地记忆
  // 决定是否弹出一次引导窗；已引导过或配置暂时读不到都不打扰。
  async function checkToolWorkDirectoryPrompt() {
    const prompted = await readPrompted()
    if (prompted) return false
    const directory = await refreshToolWorkDirectory()
    if (!directory) return false
    patch({ promptOpen: true })
    deps.emit()
    return true
  }

  async function dismissToolWorkDirectoryPrompt() {
    patch({ promptOpen: false })
    await markPrompted()
    deps.emit()
  }

  // confirmToolWorkDirectoryPrompt 确认当前草稿：保存成功后关闭并记住已引导；
  // 保存失败时保留引导窗，错误就地可见。
  async function confirmToolWorkDirectoryPrompt() {
    const saved = await saveToolWorkDirectory()
    if (!saved) return false
    await dismissToolWorkDirectoryPrompt()
    return true
  }

  async function useDefaultToolWorkDirectoryPrompt() {
    const saved = await resetToolWorkDirectoryToDefault()
    if (!saved) return false
    await dismissToolWorkDirectoryPrompt()
    return true
  }

  return { refreshToolWorkDirectory, setToolWorkDirectoryDraft, saveToolWorkDirectory, resetToolWorkDirectoryToDefault, checkToolWorkDirectoryPrompt, confirmToolWorkDirectoryPrompt, useDefaultToolWorkDirectoryPrompt, dismissToolWorkDirectoryPrompt }
}
