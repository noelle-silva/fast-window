import * as React from 'react'

type DocumentFiltersProps = {
  query: string
  tag: string
  busy: boolean
  hasServerKey: boolean
  onQueryChange: (value: string) => void
  onTagChange: (value: string) => void
  onApplyFilters: () => Promise<void> | void
}

export function DocumentFilters(props: DocumentFiltersProps) {
  const { query, tag, busy, hasServerKey, onQueryChange, onTagChange, onApplyFilters } = props
  return (
    <div className="kc-filters" role="search">
      <label>
        <span>关键词</span>
        <input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索标题、描述、标签和正文" />
      </label>
      <label>
        <span>标签</span>
        <input value={tag} onChange={event => onTagChange(event.target.value)} placeholder="精确标签" />
      </label>
      <button type="button" onClick={onApplyFilters} disabled={busy || !hasServerKey}>应用筛选</button>
    </div>
  )
}
