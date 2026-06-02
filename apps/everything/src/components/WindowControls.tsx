type WindowControlsProps = {
  onMinimize: () => Promise<void> | void
  onToggleMaximize: () => Promise<void> | void
  onCloseToTray: () => Promise<void> | void
}

function runWindowAction(action: () => Promise<void> | void) {
  Promise.resolve(action()).catch(() => {})
}

export function WindowControls(props: WindowControlsProps) {
  const { onMinimize, onToggleMaximize, onCloseToTray } = props
  return (
    <div className="everything-window-controls" data-window-control aria-label="窗口控制">
      <button type="button" onClick={() => runWindowAction(onMinimize)} aria-label="最小化">-</button>
      <button type="button" onClick={() => runWindowAction(onToggleMaximize)} aria-label="最大化或还原">□</button>
      <button type="button" className="everything-window-close" onClick={() => runWindowAction(onCloseToTray)} aria-label="隐藏到托盘">×</button>
    </div>
  )
}
