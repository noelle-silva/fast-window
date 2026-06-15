import * as React from 'react'

type WindowControlActions = {
  minimize: () => Promise<void> | void
  toggleMaximize: () => Promise<void> | void
  closeToTray: () => Promise<void> | void
}

export type QuickBarPage = 'settings' | 'capabilities' | 'buttons'

type QuickBarTopbarProps = {
  page: QuickBarPage
  standalone: boolean
  onNavigate: (page: QuickBarPage) => void
  onStartDragging: () => Promise<void> | void
  windowActions: WindowControlActions
}

function run(action: () => Promise<void> | void) {
  Promise.resolve(action()).catch(() => {})
}

function WindowControls({ actions }: { actions: WindowControlActions }) {
  return (
    <div className="quickbar-window-controls" data-window-controls="true" aria-label="窗口控制">
      <button type="button" aria-label="最小化" onClick={() => run(actions.minimize)}>
        <span aria-hidden="true">-</span>
      </button>
      <button type="button" aria-label="最大化或还原" onClick={() => run(actions.toggleMaximize)}>
        <span aria-hidden="true">□</span>
      </button>
      <button type="button" className="quickbar-close-button" aria-label="关闭到托盘" onClick={() => run(actions.closeToTray)}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

function IconSettings() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a9 9 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
    </svg>
  )
}

function IconButtons() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M5 4h6v6H5V4Zm8 0h6v6h-6V4ZM5 14h6v6H5v-6Zm8 0h6v6h-6v-6Z" />
    </svg>
  )
}

function IconCapabilities() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="currentColor" d="M12 3a1 1 0 0 1 .92.6l1.9 4.38 4.76.45a1 1 0 0 1 .56 1.74l-3.58 3.15 1.04 4.66a1 1 0 0 1-1.48 1.08L12 16.64l-4.12 2.42a1 1 0 0 1-1.48-1.08l1.04-4.66-3.58-3.15a1 1 0 0 1 .56-1.74l4.76-.45 1.9-4.38A1 1 0 0 1 12 3Z" />
    </svg>
  )
}

const NAV_ITEMS: Array<{ page: QuickBarPage; label: string; icon: React.ReactNode }> = [
  { page: 'settings', label: '设置', icon: <IconSettings /> },
  { page: 'buttons', label: '已注册管理', icon: <IconButtons /> },
  { page: 'capabilities', label: '能力浏览', icon: <IconCapabilities /> },
]

export function QuickBarTopbar(props: QuickBarTopbarProps) {
  const { page, standalone, onNavigate, onStartDragging, windowActions } = props

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    run(onStartDragging)
  }, [onStartDragging])

  return (
    <header className="quickbar-topbar" onPointerDown={onPointerDown}>
      <div className="quickbar-topbar-spacer" />
      <nav className="quickbar-topbar-nav" aria-label="Quick Bar 页面入口">
        {NAV_ITEMS.map(item => (
          <button
            key={item.page}
            type="button"
            className={item.page === page ? 'quickbar-topbar-nav-active' : ''}
            title={item.label}
            aria-label={item.label}
            aria-current={item.page === page ? 'page' : undefined}
            onClick={() => onNavigate(item.page)}
          >
            {item.icon}
          </button>
        ))}
      </nav>
      {standalone ? <WindowControls actions={windowActions} /> : null}
    </header>
  )
}
