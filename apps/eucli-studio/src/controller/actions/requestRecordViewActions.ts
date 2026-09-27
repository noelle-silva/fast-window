import { isRequestRecordViewOptionKey, normalizeRequestRecordViewOptions, setRequestRecordViewOption } from '../../domain/requestRecordViewOptions'

export function createRequestRecordViewActions(deps: {
  state: any
  emit: () => void
  saveMeta: () => Promise<any>
}) {
  const { state, emit, saveMeta } = deps

  return {
    setRequestRecordViewOption: (key: any, value: any) => {
      if (!isRequestRecordViewOptionKey(key)) return
      if (!state.data) return
      if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {} as any
      const current = normalizeRequestRecordViewOptions((state.data.settings as any).requestRecordViewOptions)
      ;(state.data.settings as any).requestRecordViewOptions = setRequestRecordViewOption(current, key, !!value)
      saveMeta().catch(() => {})
      emit()
    },
  }
}
