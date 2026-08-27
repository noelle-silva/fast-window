import * as React from 'react'
import type { HyperCortexIndexV1 } from '../core'
import type { HyperCortexGateway } from '../gateway'

export function useNoteIndex(gateway: HyperCortexGateway) {
  const [index, setIndexState] = React.useState<HyperCortexIndexV1 | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const indexRef = React.useRef<HyperCortexIndexV1 | null>(null)
  const loadPromiseRef = React.useRef<Promise<HyperCortexIndexV1> | null>(null)

  const setIndex = React.useCallback<React.Dispatch<React.SetStateAction<HyperCortexIndexV1 | null>>>(nextValue => {
    const current = indexRef.current
    const next = typeof nextValue === 'function' ? nextValue(current) : nextValue
    indexRef.current = next
    setIndexState(next)
  }, [])

  const ensureLoaded = React.useCallback(async () => {
    if (indexRef.current) return indexRef.current
    setLoading(true)
    setError(null)
    if (!loadPromiseRef.current) loadPromiseRef.current = gateway.notes.loadNoteIndex('library')

    try {
      const next = await loadPromiseRef.current
      indexRef.current = next
      setIndex(next)
      return next
    } catch (cause: any) {
      loadPromiseRef.current = null
      setError(String(cause?.message || cause || '加载全部笔记失败'))
      throw cause
    } finally {
      setLoading(false)
    }
  }, [gateway, setIndex])

  React.useEffect(() => {
    void ensureLoaded().catch(() => {})
  }, [ensureLoaded])

  return { index, setIndex, loading, error }
}
