import { loadHookPromptLibrary, saveHookPromptLibrary } from './hookPromptClient'
import { normalizeHookPromptLibrary } from '../domain/hookPrompt'
import type { AiChatShowToast } from '../gateway/capabilities'

export function createHookPromptLibraryController(deps: {
  getState: () => any
  getNetRequest: () => ((req: any) => Promise<any>) | undefined
  emit: () => void
  showToast?: AiChatShowToast
}) {
  const { getState, getNetRequest, emit, showToast } = deps

  async function refreshHookPromptLibrary(force?: boolean) {
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') {
      state.hookPrompts = { ...state.hookPrompts, loading: false, error: '业务端请求通道不可用' }
      emit()
      return state.hookPrompts.library
    }
    if (state.hookPrompts.loading && !force) return state.hookPrompts.library
    state.hookPrompts = { ...state.hookPrompts, loading: true, error: '' }
    emit()
    try {
      const library = await loadHookPromptLibrary(netRequest)
      state.hookPrompts = { loading: false, error: '', library }
      emit()
      return library
    } catch (e: any) {
      const message = String(e?.message || e || '加载 hook 提示词失败')
      state.hookPrompts = { ...state.hookPrompts, loading: false, error: message }
      showToast?.(message, { kind: 'error' })
      emit()
      return state.hookPrompts.library
    }
  }

  async function persistHookPromptLibrary(libraryRaw: any) {
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    const previous = state.hookPrompts.library
    const next = normalizeHookPromptLibrary(libraryRaw)
    state.hookPrompts = { ...state.hookPrompts, library: next, loading: true, error: '' }
    emit()
    try {
      const saved = await saveHookPromptLibrary(netRequest, next)
      state.hookPrompts = { loading: false, error: '', library: saved }
      showToast?.('hook 提示词已保存', { kind: 'success' })
      emit()
      return saved
    } catch (e) {
      state.hookPrompts = { ...state.hookPrompts, loading: false, library: previous, error: globalThis.String((e as any)?.message || e || '保存 hook 提示词失败') }
      emit()
      throw e
    }
  }

  return { refreshHookPromptLibrary, persistHookPromptLibrary }
}
