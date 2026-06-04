import * as React from 'react'

type WindowActions = {
  minimize: () => Promise<void> | void
  toggleMaximize: () => Promise<void> | void
  closeToTray: () => Promise<void> | void
}

type TaskTopbarProps = {
  standalone: boolean
  onCreateBoard: () => void
  onStartDragging: () => Promise<void> | void
  windowActions: WindowActions
}

function run(action: () => Promise<void> | void) {
  Promise.resolve(action()).catch(() => {})
}

export function TaskTopbar({ standalone, onCreateBoard, onStartDragging, windowActions }: TaskTopbarProps) {
  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"]')) return
    run(onStartDragging)
  }, [onStartDragging])

  return (
    <header className="tm-topbar" onPointerDown={onPointerDown}>
      <div className="tm-brand">
        <span className="tm-brand-mark" aria-hidden="true">✓</span>
        <span>Task Manager</span>
      </div>
      <div className="tm-topbar-spacer" />
      <button type="button" className="tm-topbar-add" onClick={onCreateBoard} aria-label="新建任务分组">+</button>
      {standalone ? (
        <div className="tm-window-controls" data-window-controls="true" aria-label="窗口控制">
          <button type="button" aria-label="最小化" onClick={() => run(windowActions.minimize)}>-</button>
          <button type="button" aria-label="最大化或还原" onClick={() => run(windowActions.toggleMaximize)}>□</button>
          <button type="button" className="tm-close-button" aria-label="关闭到托盘" onClick={() => run(windowActions.closeToTray)}>×</button>
        </div>
      ) : null}
    </header>
  )
}
