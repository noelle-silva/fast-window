import { useMemo, useState } from 'react'
import type { Plugin } from './constants'

export function useSearch(plugins: Plugin[]) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return plugins

    const needle = q.toLowerCase()
    return plugins.filter(p => {
      const keyword = p.keyword?.toLowerCase() || ''
      return p.name.toLowerCase().includes(needle) || keyword.includes(needle)
    })
  }, [query, plugins])

  return { query, setQuery, filtered }
}
