import * as React from 'react'

type QuickActionButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger' | 'ghost'

type QuickActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: QuickActionButtonVariant
  icon?: React.ReactNode
  compact?: boolean
}

export function QuickActionButton(props: QuickActionButtonProps) {
  const { variant = 'secondary', icon, compact = false, className, children, type = 'button', ...buttonProps } = props
  const classes = [
    'quickbar-action-button',
    `quickbar-action-button-${variant}`,
    compact ? 'quickbar-action-button-compact' : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <button {...buttonProps} type={type} className={classes}>
      {icon ? <span className="quickbar-action-button-icon" aria-hidden="true">{icon}</span> : null}
      <span className="quickbar-action-button-label">{children}</span>
    </button>
  )
}
