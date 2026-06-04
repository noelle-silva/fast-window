import * as React from 'react'

type DialogShellProps = {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  onClose: () => void
}

export function DialogShell({ title, subtitle, action, children, onClose }: DialogShellProps) {
  return (
    <div className="tm-dialog-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="tm-dialog" role="dialog" aria-modal="true" aria-labelledby="tm-dialog-title">
        <header className="tm-dialog-header">
          <div>
            <h2 id="tm-dialog-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="tm-dialog-actions">
            {action}
            <button type="button" className="tm-icon-button" aria-label="关闭" onClick={onClose}>×</button>
          </div>
        </header>
        {children}
      </section>
    </div>
  )
}
