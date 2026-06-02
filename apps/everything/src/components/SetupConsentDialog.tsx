import * as React from 'react'

type SetupConsentDialogProps = {
  open: boolean
  busy: boolean
  clientReady: boolean
  error: string | null
  onAuthorize: () => void
}

function IconShieldSearch() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28">
      <path fill="currentColor" d="M12 2.25 19 5v5.35c0 4.38-2.78 8.27-7 9.4-4.22-1.13-7-5.02-7-9.4V5l7-2.75Zm0 1.62L6.5 6.03v4.32c0 3.55 2.1 6.82 5.5 8.18 3.4-1.36 5.5-4.63 5.5-8.18V6.03L12 3.87Zm-.75 4.38a3.75 3.75 0 0 1 2.95 6.07l1.3 1.3-1.06 1.06-1.3-1.3A3.75 3.75 0 1 1 11.25 8.25Zm0 1.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" />
    </svg>
  )
}

export function SetupConsentDialog(props: SetupConsentDialogProps) {
  const { open, busy, clientReady, error, onAuthorize } = props
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const disabled = busy || !clientReady

  React.useEffect(() => {
    if (!open || disabled) return
    window.setTimeout(() => buttonRef.current?.focus(), 0)
  }, [disabled, open])

  if (!open) return null

  return (
    <section className="everything-consent-overlay" role="presentation">
      <div
        className="everything-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="everything-consent-title"
        aria-describedby="everything-consent-detail"
        onKeyDown={event => {
          if (event.key === 'Escape') event.preventDefault()
          if (event.key === 'Tab' && buttonRef.current && !disabled) {
            event.preventDefault()
            buttonRef.current.focus()
          }
        }}
      >
        <div className="everything-consent-icon" aria-hidden="true"><IconShieldSearch /></div>
        <div className="everything-consent-copy">
          <p className="everything-kicker">Authorization Required</p>
          <h2 id="everything-consent-title">点击授权，Everything 才会正常工作</h2>
          <p id="everything-consent-detail">Everything 需要一次系统授权来启用全局索引服务。授权完成后，应用会自动建立搜索实例并回到搜索页。</p>
          {error ? <p className="everything-consent-error" role="alert">{error}</p> : null}
        </div>
        <button ref={buttonRef} type="button" className="everything-consent-primary" onClick={onAuthorize} disabled={disabled}>
          {busy ? '正在等待授权完成' : clientReady ? '点击以授权 Everything' : '正在连接后台'}
        </button>
      </div>
    </section>
  )
}
