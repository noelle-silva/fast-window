import * as React from 'react'
import type { AppPage, KnowledgePage } from './knowledgePages'

type WindowControlActions = {
  minimize: () => Promise<void> | void
  toggleMaximize: () => Promise<void> | void
  closeToTray: () => Promise<void> | void
}

type KnowledgeTopbarProps = {
  page: AppPage
  pages: Array<{ value: KnowledgePage; label: string }>
  standalone: boolean
  connected: boolean
  hasServerKey: boolean
  busy: boolean
  onBack: () => void
  onOpenPage: (page: KnowledgePage) => void
  onOpenSettings: () => void
  onRefresh: () => Promise<void> | void
  onStartDragging: () => Promise<void> | void
  windowActions: WindowControlActions
}

function run(action: () => Promise<void> | void) {
  Promise.resolve(action()).catch(() => {})
}

function IconSettings() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a9 9 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
    </svg>
  )
}

function IconBack() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0Z" />
    </svg>
  )
}

function WindowControls({ actions }: { actions: WindowControlActions }) {
  return (
    <div className="kc-window-controls" data-window-controls="true" aria-label="窗口控制">
      <button type="button" aria-label="最小化" onClick={() => run(actions.minimize)}>
        <span aria-hidden="true">-</span>
      </button>
      <button type="button" aria-label="最大化或还原" onClick={() => run(actions.toggleMaximize)}>
        <span aria-hidden="true">□</span>
      </button>
      <button type="button" className="kc-close-button" aria-label="关闭到托盘" onClick={() => run(actions.closeToTray)}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

export function KnowledgeTopbar(props: KnowledgeTopbarProps) {
  const { page, pages, standalone, connected, hasServerKey, busy, onBack, onOpenPage, onOpenSettings, onRefresh, onStartDragging, windowActions } = props

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    run(onStartDragging)
  }, [onStartDragging])

  return (
    <header className="kc-topbar" onPointerDown={onPointerDown}>
      {page === 'settings' ? (
        <button type="button" className="kc-icon-button" onClick={onBack} aria-label="返回知识中心页面">
          <IconBack />
        </button>
      ) : null}

      <div className="kc-topbar-title" aria-live="polite">{page === 'settings' ? '连接设置' : 'AI 知识中心'}</div>
      <nav className="kc-topbar-nav" aria-label="知识中心页面">
        {pages.map(item => (
          <button
            key={item.value}
            type="button"
            className={page === item.value ? 'is-active' : ''}
            onClick={() => onOpenPage(item.value)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="kc-topbar-spacer" />

      <span className={`kc-topbar-status ${connected ? 'kc-status-good' : 'kc-status-warn'}`}>{connected ? '服务器可用' : hasServerKey ? '等待连接' : '未配置钥匙'}</span>

      {page !== 'settings' ? (
        <button type="button" className="kc-topbar-action" onClick={() => run(onRefresh)} disabled={busy || !hasServerKey}>刷新</button>
      ) : null}

      <button type="button" className="kc-icon-button" onClick={onOpenSettings} aria-label="连接设置">
        <IconSettings />
      </button>

      {standalone ? <WindowControls actions={windowActions} /> : null}
    </header>
  )
}
