import { loadPlaceholderDependencies, loadPlaceholderLibrary, loadPlaceholderProblems, previewPlaceholders, savePlaceholderLibrary } from './placeholderClient'
import { normalizePlaceholderLibrary } from '../domain/placeholder'
import type { AiChatShowToast } from '../gateway/capabilities'

export function createPlaceholderLibraryController(deps: {
  getState: () => any
  getNetRequest: () => ((req: any) => Promise<any>) | undefined
  emit: () => void
  showToast?: AiChatShowToast
}) {
  const { getState, getNetRequest, emit, showToast } = deps

  async function refreshPlaceholderLibrary(force?: boolean) {
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') {
      state.placeholders = { ...state.placeholders, loading: false, error: '业务端请求通道不可用' }
      emit()
      return state.placeholders.library
    }
    if (state.placeholders.loading && !force) return state.placeholders.library
    state.placeholders = { ...state.placeholders, loading: true, error: '' }
    emit()
    try {
      const library = await loadPlaceholderLibrary(netRequest)
      const problems = await loadPlaceholderProblems(netRequest).catch(() => [])
      state.placeholders = { ...state.placeholders, loading: false, error: '', library, problems }
      emit()
      return library
    } catch (e: any) {
      const message = String(e?.message || e || '加载占位符失败')
      state.placeholders = { ...state.placeholders, loading: false, error: message }
      showToast?.(message, { kind: 'error' })
      emit()
      return state.placeholders.library
    }
  }

  async function persistPlaceholderLibrary(libraryRaw: any) {
    const state = getState()
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    const previous = state.placeholders.library
    const next = normalizePlaceholderLibrary(libraryRaw)
    state.placeholders = { ...state.placeholders, library: next, loading: true, error: '' }
    emit()
    try {
      const saved = await savePlaceholderLibrary(netRequest, next)
      const problems = await loadPlaceholderProblems(netRequest).catch(() => [])
      state.placeholders = { ...state.placeholders, loading: false, error: '', library: saved, problems }
      showToast?.('占位符已保存', { kind: 'success' })
      emit()
      return saved
    } catch (e) {
      state.placeholders = { ...state.placeholders, loading: false, library: previous, error: globalThis.String((e as any)?.message || e || '保存占位符失败') }
      emit()
      throw e
    }
  }

  async function refreshPlaceholderPreview(value: any) {
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    const preview = await previewPlaceholders(netRequest, String(value ?? ''))
    const state = getState()
    state.placeholders = { ...state.placeholders, preview }
    emit()
    return preview
  }

  async function refreshPlaceholderDependencyTree(name: any) {
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') throw new Error('业务端请求通道不可用')
    const dependencyTree = await loadPlaceholderDependencies(netRequest, String(name ?? ''))
    const state = getState()
    state.placeholders = { ...state.placeholders, dependencyTree }
    emit()
    return dependencyTree
  }

  return { refreshPlaceholderLibrary, persistPlaceholderLibrary, refreshPlaceholderPreview, refreshPlaceholderDependencyTree }
}
