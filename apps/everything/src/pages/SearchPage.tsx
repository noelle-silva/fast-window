import * as React from 'react'
import { formatSize } from '../format'
import type { SearchResult, SetupInfo } from '../types'

type SearchPageProps = {
  setup: SetupInfo | null
  searching: boolean
  results: SearchResult[]
  lastSearchedQuery: string
  onOpenSettings: () => void
  onOpenPath: (path: string) => void
  onRevealPath: (path: string) => void
}

function emptyResultText(setupRequired: boolean, lastSearchedQuery: string) {
  if (setupRequired) return '先到设置页启用全局索引，再开始搜索。'
  if (lastSearchedQuery) return '没有结果。若刚启用索引，请等 Everything 建库完成后再试。'
  return '输入关键词后按 Enter 搜索。'
}

function resultKindLabel(kind: SearchResult['kind']) {
  if (kind === 'folder') return 'DIR'
  if (kind === 'file') return 'FILE'
  return 'ITEM'
}

function IconFolder() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M3 6.75A2.75 2.75 0 0 1 5.75 4h4.08c.73 0 1.43.29 1.94.8l1.2 1.2h5.28A2.75 2.75 0 0 1 21 8.75v8.5A2.75 2.75 0 0 1 18.25 20H5.75A2.75 2.75 0 0 1 3 17.25v-10.5Zm2.75-1.25c-.69 0-1.25.56-1.25 1.25v.75h15v-.75c0-.69-.56-1.25-1.25-1.25h-5.9l-1.64-1.64a1.25 1.25 0 0 0-.88-.36H5.75ZM4.5 9v8.25c0 .69.56 1.25 1.25 1.25h12.5c.69 0 1.25-.56 1.25-1.25V9h-15Z" />
    </svg>
  )
}

export function SearchPage(props: SearchPageProps) {
  const {
    setup,
    searching,
    results,
    lastSearchedQuery,
    onOpenSettings,
    onOpenPath,
    onRevealPath,
  } = props
  const setupRequired = Boolean(setup && !setup.configured)
  const emptyText = emptyResultText(setupRequired, lastSearchedQuery)

  return (
    <section className="everything-page everything-search-page" aria-label="Everything 搜索">
      {setupRequired ? (
        <div className="everything-setup-callout" aria-live="polite">
          <div>
            <strong>需要先完成一次性索引设置</strong>
            <p>到设置页启用全局索引后，Everything 会通过已授权服务建立电脑全局文件索引。</p>
          </div>
          <button type="button" className="everything-secondary-button" onClick={onOpenSettings}>打开设置</button>
        </div>
      ) : null}

      <article className="everything-results-panel">
        <div className="everything-panel-title-row">
          <div>
            <p className="everything-kicker">Results</p>
            <h2>搜索结果</h2>
          </div>
          <span>{searching ? '搜索中' : `${results.length} 项`}</span>
        </div>
        {results.length === 0 ? (
          <div className="everything-empty-state">{emptyText}</div>
        ) : (
          <div className="everything-results-list" role="list">
            {results.map(item => (
              <div className="everything-result-row" role="listitem" key={`${item.fullPath}-${item.modifiedAt}`}>
                <button type="button" className="everything-result-open" onClick={() => onOpenPath(item.fullPath)}>
                  <span className={`everything-result-icon everything-kind-${item.kind}`}>{resultKindLabel(item.kind)}</span>
                  <span className="everything-result-main">
                    <span className="everything-result-name">{item.name}</span>
                    <span className="everything-result-path">{item.path}</span>
                  </span>
                </button>
                <div className="everything-result-meta" aria-label="文件信息">
                  <span>{formatSize(item.size)}</span>
                  <span>{item.modifiedAt || '-'}</span>
                </div>
                <button type="button" className="everything-reveal-button" onClick={() => onRevealPath(item.fullPath)} aria-label={`在文件夹中显示 ${item.name}`} title="在文件夹中显示">
                  <IconFolder />
                </button>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}
