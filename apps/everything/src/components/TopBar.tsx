import * as React from 'react'
import { WindowControls } from './WindowControls'
import type { AppPhase, AppView } from '../types'

type TopBarProps = {
  view: AppView
  phase: AppPhase
  query: string
  queryRef: React.Ref<HTMLInputElement>
  searching: boolean
  busy: boolean
  clientReady: boolean
  onViewChange: (view: AppView) => void
  onQueryChange: (query: string) => void
  onClearQuery: () => void
  onSearch: () => void
  onStartDrag: () => Promise<void> | void
  standalone: boolean
  onMinimize: () => Promise<void> | void
  onToggleMaximize: () => Promise<void> | void
  onCloseToTray: () => Promise<void> | void
}

function IconBack() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0Z" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a9 9 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
    </svg>
  )
}

function IconClear() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
      <path fill="currentColor" d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z" />
    </svg>
  )
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('button,input,select,textarea,a,[role="button"],[data-window-control]'))
}

export function TopBar(props: TopBarProps) {
  const {
    view,
    phase,
    query,
    queryRef,
    searching,
    busy,
    clientReady,
    onViewChange,
    onQueryChange,
    onClearQuery,
    onSearch,
    onStartDrag,
    standalone,
    onMinimize,
    onToggleMaximize,
    onCloseToTray,
  } = props
  const searchDisabled = !clientReady || searching || busy
  const inputDisabled = busy || phase !== 'ready'

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    void onStartDrag()
  }, [onStartDrag])

  const onSearchSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!searchDisabled) onSearch()
  }, [onSearch, searchDisabled])

  return (
    <header className="everything-topbar" onPointerDown={onPointerDown}>
      {view === 'settings' ? (
        <button type="button" className="everything-icon-button" onClick={() => onViewChange('search')} aria-label="返回主页">
          <IconBack />
        </button>
      ) : null}

      <form className="everything-topbar-search" role="search" onSubmit={onSearchSubmit}>
        <div className="everything-topbar-search-field">
          <input
            ref={queryRef}
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="输入文件名、扩展名或 Everything 查询语法"
            aria-label="Everything 搜索"
            disabled={inputDisabled}
          />
          {query ? (
            <button type="button" className="everything-search-clear-button" onClick={onClearQuery} aria-label="清空搜索内容">
              <IconClear />
            </button>
          ) : null}
        </div>
      </form>

      <div className="everything-topbar-spacer" />

      <button type="button" className={`everything-icon-button ${view === 'settings' ? 'is-active' : ''}`} onClick={() => onViewChange('settings')} aria-label="设置">
        <IconSettings />
      </button>

      {standalone ? (
        <WindowControls onMinimize={onMinimize} onToggleMaximize={onToggleMaximize} onCloseToTray={onCloseToTray} />
      ) : null}
    </header>
  )
}
