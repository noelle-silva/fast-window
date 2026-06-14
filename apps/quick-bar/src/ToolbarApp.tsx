import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createDirectClient } from './directClient'
import { fetchRegistryButtons } from './registryClient'
import { invokeCapability } from './hostCapabilityClient'
import type { RegistryButton, ToolbarPayload } from './types'

export function ToolbarApp() {
  const [payload, setPayload] = React.useState<ToolbarPayload | null>(null)
  const [buttons, setButtons] = React.useState<RegistryButton[] | null>(null)
  const [buttonsError, setButtonsError] = React.useState<string | null>(null)
  const [toolbarPayloadError, setToolbarPayloadError] = React.useState<string | null>(null)
  const mountedRef = React.useRef(true)

  React.useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const refreshButtons = React.useCallback(async () => {
    setButtonsError(null)
    let client: Awaited<ReturnType<typeof createDirectClient>> | null = null
    try {
      client = await createDirectClient()
      const list = await fetchRegistryButtons(client)
      if (mountedRef.current) setButtons(list)
    } catch (e) {
      if (mountedRef.current) setButtonsError(errorMessage(e, '读取按钮列表失败'))
    } finally {
      client?.close()
    }
  }, [])

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
      setToolbarPayloadError(null)
      setPayload(event.payload)
      void refreshButtons()
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
  }, [refreshButtons])

  React.useEffect(() => {
    void refreshButtons()
  }, [refreshButtons])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void invoke('hide_quick_bar_toolbar').catch(() => {})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleButtonClick = React.useCallback(async (button: RegistryButton) => {
    const text = payload?.selectedText?.trim()
    if (!text) return
    let client: Awaited<ReturnType<typeof createDirectClient>> | null = null
    try {
      await invoke('show_quick_bar_result_popup', { title: button.title })
      try {
        client = await createDirectClient()
        const response = await invokeCapability(client, {
          app: button.app,
          capabilityId: button.capabilityId,
          input: text,
          config: button.config,
        })
        const resultText = extractTextFromResponse(response.response)
        await invoke('update_quick_bar_result_popup', {
          payload: { title: button.title, status: 'done', text: resultText },
        })
      } catch (e) {
        await invoke('update_quick_bar_result_popup', {
          payload: { title: button.title, status: 'error', errorText: errorMessage(e, '能力调用失败') },
        }).catch(() => {})
      } finally {
        client?.close()
      }
    } catch (e) {
      setToolbarPayloadError(errorMessage(e, '打开结果浮窗失败'))
    }
  }, [payload])

  if (buttonsError) {
    return (
      <main className="quickbar-toolbar-shell" aria-label="Quick Bar 浮动工具条（加载失败）">
        <div className="quickbar-toolbar-actions" aria-label="按钮加载失败">
          {toolbarPayloadError ? <span className="quickbar-toolbar-error">{toolbarPayloadError}</span> : null}
          <span className="quickbar-toolbar-error">{buttonsError}</span>
        </div>
      </main>
    )
  }

  if (!buttons) {
    return (
      <main className="quickbar-toolbar-shell" aria-label="Quick Bar 浮动工具条（加载中）">
        <div className="quickbar-toolbar-actions" aria-label="按钮加载中">
          {toolbarPayloadError ? <span className="quickbar-toolbar-error">{toolbarPayloadError}</span> : null}
          <span className="quickbar-toolbar-loading">加载中...</span>
        </div>
      </main>
    )
  }

  return (
    <main className="quickbar-toolbar-shell" aria-label="Quick Bar 浮动工具条">
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
