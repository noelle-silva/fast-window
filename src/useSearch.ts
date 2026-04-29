import { useState, useEffect, useCallback, useRef } from 'react'
import type { Plugin } from './constants'

export function useSearch(plugins: Plugin[]) {
  const [query, setQuery] = useState('')
  const [filtered, setFiltered] = useState<Plugin[]>(plugins)
  const [activeIndex, setActiveIndex] = useState(0)
  const selectedIdRef = useRef<string | null>(null)
  const prevQueryRef = useRef<string>('')

  useEffect(() => {
    const q = query.trim()
    const isQueryChanged = prevQueryRef.current !== query
    prevQueryRef.current = query

    const next =
      q === ''
        ? plugins
        : plugins.filter(
            p => p.name.toLowerCase().includes(q.toLowerCase()) || p.keyword?.toLowerCase() === q.toLowerCase(),
          )

    setFiltered(next)

    if (isQueryChanged) {
      setActiveIndex(0)
      return
    }

    const selectedId = selectedIdRef.current
    if (!selectedId) {
      setActiveIndex(0)
      return
    }
    const nextIndex = next.findIndex(p => p.id === selectedId)
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0)
  }, [query, plugins])

  useEffect(() => {
    selectedIdRef.current = filtered[activeIndex]?.id ?? null
  }, [filtered, activeIndex])

  const reset = useCallback(() => {
    setQuery('')
    setActiveIndex(0)
  }, [])

  return { query, setQuery, filtered, activeIndex, setActiveIndex, reset }
}
