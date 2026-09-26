import * as React from 'react'
import type { HyperCortexIndexV1 } from '../core'
import type { HyperCortexGateway } from '../gateway'

// 笔记索引随当前仓库装载：仓库切换时丢弃旧索引与在途请求，重新加载。
// enabled 用于让装载等待仓库激活完成（骨架与派生索引调和），避免并发读到中间态。
export function useNoteIndex(gateway: HyperCortexGateway, activeRepoId: string, enabled = true) {
  const [index, setIndexState] = React.useState<HyperCortexIndexV1 | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const indexRef = React.useRef<HyperCortexIndexV1 | null>(null)
  const loadPromiseRef = React.useRef<Promise<HyperCortexIndexV1> | null>(null)
  const loadSeqRef = React.useRef(0)

  const setIndex = React.useCallback<React.Dispatch<React.SetStateAction<HyperCortexIndexV1 | null>>>(nextValue => {
    const current = indexRef.current
    const next = typeof nextValue === 'function' ? nextValue(current) : nextValue
    indexRef.current = next
    setIndexState(next)
  }, [])

  const ensureLoaded = React.useCallback(async () => {
    if (indexRef.current) return indexRef.current
    const seq = loadSeqRef.current
    setLoading(true)
    setError(null)
    if (!loadPromiseRef.current) loadPromiseRef.current = gateway.notes.loadNoteIndex('library')

    try {
      const next = await loadPromiseRef.current
      if (loadSeqRef.current !== seq) return next
      indexRef.current = next
      setIndex(next)
      return next
    } catch (cause: any) {
      if (loadSeqRef.current !== seq) throw cause
      loadPromiseRef.current = null
      setError(String(cause?.message || cause || '加载全部笔记失败'))
      throw cause
    } finally {
      if (loadSeqRef.current === seq) setLoading(false)
    }
  }, [gateway, setIndex])

  React.useEffect(() => {
    loadSeqRef.current += 1
    indexRef.current = null
    loadPromiseRef.current = null
    setIndexState(null)
    if (!activeRepoId || !enabled) {
      setLoading(true)
      return
    }
    void ensureLoaded().catch(() => {})
  }, [activeRepoId, enabled, ensureLoaded])

  return { index, setIndex, loading, error }
}
