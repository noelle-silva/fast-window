import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createDirectClient } from './directClient'
import { fetchRegistryButtons } from './registryClient'
import { invokeCapability } from './hostCapabilityClient'
import type { RegistryButton, ToolbarPayload } from './types'

type ToolbarResult = {
  button: RegistryButton
  status: 'loading' | 'done' | 'error'
  text?: string
  errorText?: string
}

export function ToolbarApp() {
  const [payload, setPayload] = React.useState<ToolbarPayload | null>(null)
  const [buttons, setButtons] = React.useState<RegistryButton[] | null>(null)
  const [buttonsError, setButtonsError] = React.useState<string | null>(null)
  const [toolbarPayloadError, setToolbarPayloadError] = React.useState<string | null>(null)
  const [activeResult, setActiveResult] = React.useState<ToolbarResult | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null
    void invoke<ToolbarPayload | null>('quick_bar_toolbar_payload')
      .then(next => {
        if (!cancelled) setPayload(next)
      })
      .catch(e => {
        if (!cancelled) setToolbarPayloadError(`读取划词上下文失败: ${errorMessage(e, '未知错误')}`)
      })
    void listen<ToolbarPayload>('quick-bar-selection', event => {
      setPayload(event.payload)
    })
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch(e => {
        if (!cancelled) setToolbarPayloadError(`订阅划词选区失败: ${errorMessage(e, '未知错误')}`)
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      let client: Awaited<ReturnType<typeof createDirectClient>> | null = null
      try {
        client = await createDirectClient()
        if (cancelled) return
        const list = await fetchRegistryButtons(client)
        if (!cancelled) setButtons(list)
      } catch (e) {
        if (!cancelled) setButtonsError(errorMessage(e, '读取按钮列表失败'))
      } finally {
        client?.close()
      }
    })()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeResult) setActiveResult(null)
        void invoke('hide_quick_bar_toolbar').catch(() => {})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeResult])

  const handleButtonClick = React.useCallback(async (button: RegistryButton) => {
    const text = payload?.selectedText?.trim()
    if (!text) return
    setActiveResult({ button, status: 'loading' })
    try {
      await invoke('show_quick_bar_result_popup')
      const client = await createDirectClient()
      try {
        const response = await invokeCapability(client, {
          app: button.app,
          capabilityId: button.capabilityId,
          input: text,
          config: button.config,
        })
        const resultText = extractTextFromResponse(response.response)
        setActiveResult({ button, status: 'done', text: resultText })
      } finally {
        client.close()
      }
    } catch (e) {
      setActiveResult({ button, status: 'error', errorText: errorMessage(e, '能力调用失败') })
    }
  }, [payload])

  const handleCloseResult = React.useCallback(() => {
    setActiveResult(null)
    void invoke('hide_quick_bar_toolbar').catch(() => {})
  }, [])

  if (activeResult) {
    return (
      <main className="quickbar-toolbar-shell quickbar-toolbar-shell-result" aria-label="Quick Bar 结果浮窗">
        <div className="quickbar-selection-chip" title={payload?.selectedText || ''}>
          {payload?.selectedText?.trim() || '已选中文字'}
        </div>
        <div className="quickbar-result-popup" aria-live="polite">
          <div className="quickbar-result-header">
            <span className="quickbar-result-title">{activeResult.button.title}</span>
            <button type="button" className="quickbar-result-close" onClick={handleCloseResult} aria-label="关闭结果浮窗">×</button>
          </div>
          <div className="quickbar-result-body">
            {activeResult.status === 'loading' ? (
              <div className="quickbar-result-spinner" aria-label="能力调用中">
                <svg viewBox="0 0 24 24" width="28" height="28">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
                  <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.78)" strokeWidth="3" strokeDasharray="40 60" strokeLinecap="round">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                  </circle>
                </svg>
                <p>能力调用中...</p>
              </div>
            ) : activeResult.status === 'error' ? (
              <p className="quickbar-result-error">{activeResult.errorText}</p>
            ) : (
              <pre className="quickbar-result-text">{activeResult.text || '（无返回内容）'}</pre>
            )}
          </div>
        </div>
      </main>
    )
  }

  if (buttonsError) {
    const text = payload?.selectedText?.trim() || '已选中文字'
    return (
      <main className="quickbar-toolbar-shell" aria-label="Quick Bar 浮动工具条（加载失败）">
        <div className="quickbar-selection-chip" title={text}>{text}</div>
        <div className="quickbar-toolbar-actions" aria-label="按钮加载失败">
          {toolbarPayloadError ? <span className="quickbar-toolbar-error">{toolbarPayloadError}</span> : null}
          <span className="quickbar-toolbar-error">{buttonsError}</span>
        </div>
      </main>
    )
  }

  if (!buttons) {
    const text = payload?.selectedText?.trim() || '已选中文字'
    return (
      <main className="quickbar-toolbar-shell" aria-label="Quick Bar 浮动工具条（加载中）">
        <div className="quickbar-selection-chip" title={text}>{text}</div>
        <div className="quickbar-toolbar-actions" aria-label="按钮加载中">
          {toolbarPayloadError ? <span className="quickbar-toolbar-error">{toolbarPayloadError}</span> : null}
          <span className="quickbar-toolbar-loading">加载中...</span>
        </div>
      </main>
    )
  }

  const text = payload?.selectedText?.trim() || '已选中文字'
  return (
    <main className="quickbar-toolbar-shell" aria-label="Quick Bar 浮动工具条">
      <div className="quickbar-selection-chip" title={text}>{text}</div>
      <div className="quickbar-toolbar-actions" aria-label="已注册能力按钮">
        {toolbarPayloadError ? <span className="quickbar-toolbar-error">{toolbarPayloadError}</span> : null}
        {buttons.length === 0 ? (
          <span className="quickbar-toolbar-empty">暂无已注册按钮。请在 Quick Bar 主页注册能力。</span>
        ) : (
          buttons.map(button => (
            <button
              key={button.id}
              type="button"
              title={`${button.title}（来源：${button.appId}）`}
              onClick={() => handleButtonClick(button)}
            >
              {button.title}
            </button>
          ))
        )}
      </div>
    </main>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

function extractTextFromResponse(response: unknown): string {
  if (response === null || response === undefined) return ''
  if (typeof response === 'string') return response
  if (typeof response === 'object') {
    const obj = response as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.result === 'string') return obj.result
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.message === 'string') return obj.message
    return JSON.stringify(response, null, 2)
  }
  return String(response)
}
