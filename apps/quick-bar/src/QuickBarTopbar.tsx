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

const NAV_ITEMS: Array<{ page: QuickBarPage; label: string }> = [
  { page: 'settings', label: '设置' },
  { page: 'buttons', label: '已注册管理' },
  { page: 'capabilities', label: '能力浏览' },
]

function pageTitle(page: QuickBarPage): string {
  if (page === 'settings') return '设置'
  if (page === 'capabilities') return '能力浏览'
  return '按钮管理'
}

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
      <div className="quickbar-topbar-title" aria-live="polite">{pageTitle(page)}</div>
      <nav className="quickbar-topbar-nav" aria-label="Quick Bar 页面入口">
        {NAV_ITEMS.map(item => (
          <button
            key={item.page}
            type="button"
            className={item.page === page ? 'quickbar-topbar-nav-active' : ''}
            onClick={() => onNavigate(item.page)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="quickbar-topbar-spacer" />
      {standalone ? <WindowControls actions={windowActions} /> : null}
    </header>
  )
}
