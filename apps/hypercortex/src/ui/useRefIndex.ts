import * as React from 'react'
import type { HyperCortexGateway } from '../gateway'
import type { NoteRefIndex } from '../noteRefs'

// 引用索引随当前仓库装载：仓库切换或刷新信号变化时丢弃旧索引与在途请求，重新加载。
// 与笔记索引同源，仅供全局关系图按需装载，不在仓库现场常驻。
export function useRefIndex(gateway: HyperCortexGateway, activeRepoId: string, refreshSignal = 0, enabled = true) {
  const [index, setIndexState] = React.useState<NoteRefIndex | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const indexRef = React.useRef<NoteRefIndex | null>(null)
  const loadPromiseRef = React.useRef<Promise<NoteRefIndex> | null>(null)
  const loadSeqRef = React.useRef(0)

  const ensureLoaded = React.useCallback(async () => {
    if (indexRef.current) return indexRef.current
    const seq = loadSeqRef.current
    setLoading(true)
    setError(null)
    if (!loadPromiseRef.current) loadPromiseRef.current = gateway.refs.loadRefIndex('library')

    try {
      const next = await loadPromiseRef.current
      if (loadSeqRef.current !== seq) return next
      indexRef.current = next
      setIndexState(next)
      return next
    } catch (cause: any) {
      if (loadSeqRef.current !== seq) throw cause
      loadPromiseRef.current = null
      setError(String(cause?.message || cause || '加载引用索引失败'))
      throw cause
    } finally {
      if (loadSeqRef.current === seq) setLoading(false)
    }
  }, [gateway])

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
  }, [activeRepoId, enabled, ensureLoaded, refreshSignal])

  return { refIndex: index, loading, error }
}
