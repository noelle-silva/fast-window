import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ResultPopupPayload } from './types'

export function ResultPopupApp() {
  const [payload, setPayload] = React.useState<ResultPopupPayload | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null
    void invoke<ResultPopupPayload | null>('quick_bar_result_payload')
      .then(next => {
        if (!cancelled) setPayload(next)
      })
      .catch(e => {
        if (!cancelled) setError(errorMessage(e, '读取结果窗口内容失败'))
      })
    void listen<ResultPopupPayload>('quick-bar-result', event => {
      setError(null)
      setPayload(event.payload)
    })
      .then(nextUnlisten => {
        if (cancelled) {
          nextUnlisten()
        } else {
          unlisten = nextUnlisten
          void invoke('quick_bar_result_popup_ready').catch(e => {
            if (!cancelled) setError(errorMessage(e, '结果窗口准备失败'))
          })
        }
      })
      .catch(e => {
        if (!cancelled) setError(errorMessage(e, '订阅结果窗口内容失败'))
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const handleClose = React.useCallback(() => {
    void invoke('hide_quick_bar_result_popup').catch(() => {})
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleClose])

  const title = payload?.title || 'Quick Bar 结果'
  return (
    <main className="quickbar-result-shell" aria-label="Quick Bar 结果浮窗">
      <section className="quickbar-result-popup" aria-live="polite">
        <div className="quickbar-result-header">
          <div>
            <span className="quickbar-result-title">{title}</span>
            <span className="quickbar-result-subtitle">能力调用结果</span>
          </div>
          <button type="button" className="quickbar-result-close" onClick={handleClose} aria-label="关闭结果浮窗">×</button>
        </div>
        <div className="quickbar-result-body">
          {error ? (
            <p className="quickbar-result-error">{error}</p>
          ) : !payload || payload.status === 'loading' ? (
            <div className="quickbar-result-spinner" aria-label="能力调用中">
              <svg viewBox="0 0 24 24" width="28" height="28">
                <circle className="quickbar-result-spinner-track" cx="12" cy="12" r="10" fill="none" strokeWidth="3" />
                <circle className="quickbar-result-spinner-ring" cx="12" cy="12" r="10" fill="none" strokeWidth="3" strokeDasharray="40 60" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                </circle>
              </svg>
              <p>能力调用中...</p>
            </div>
          ) : payload.status === 'error' ? (
            <p className="quickbar-result-error">{payload.errorText || '能力调用失败'}</p>
          ) : (
            <pre className="quickbar-result-text">{payload.text || '（无返回内容）'}</pre>
          )}
        </div>
      </section>
    </main>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}
