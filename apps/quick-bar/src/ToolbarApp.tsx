import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from './directClient'
import { fetchRegistryButtons } from './registryClient'
import { invokeCapability } from './hostCapabilityClient'
import { ButtonIconGlyph } from './buttonIcons'
import type { RegistryButton, ToolbarPayload } from './types'

const appWindow = getCurrentWindow()

export function ToolbarApp() {
  const [payload, setPayload] = React.useState<ToolbarPayload | null>(null)
  const [buttons, setButtons] = React.useState<RegistryButton[] | null>(null)
  const [buttonsError, setButtonsError] = React.useState<string | null>(null)
  const [toolbarPayloadError, setToolbarPayloadError] = React.useState<string | null>(null)
  const mountedRef = React.useRef(true)
  const shellRef = React.useRef<HTMLElement | null>(null)
  const toolbarLayoutSignatureRef = React.useRef<string | null>(null)

  React.useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const refreshButtons = React.useCallback(async () => {
    setButtonsError(null)
    setButtons(null)
    let client: Awaited<ReturnType<typeof createDirectClient>> | null = null
    try {
      client = await createDirectClient()
      const list = await fetchRegistryButtons(client)
      if (mountedRef.current) setButtons(list.filter(button => button.enabled !== false))
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

  React.useLayoutEffect(() => {
    if (!payload) return
    if (!buttons && !buttonsError && !toolbarPayloadError) return
    const shell = shellRef.current
    if (!shell) return
    const rect = shell.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const layoutSignature = [
      payload.layoutRequestId,
      Math.ceil(rect.width),
      Math.ceil(rect.height),
      buttons?.length ?? 'message',
      buttonsError ?? '',
      toolbarPayloadError ?? '',
    ].join(':')
    if (toolbarLayoutSignatureRef.current === layoutSignature) return
    toolbarLayoutSignatureRef.current = layoutSignature

    let cancelled = false
    void appWindow.scaleFactor()
      .then(scaleFactor => invoke('quick_bar_toolbar_ready', {
        layoutRequestId: payload.layoutRequestId,
        width: Math.ceil(rect.width * scaleFactor),
        height: Math.ceil(rect.height * scaleFactor),
      }))
      .catch(e => {
        if (!cancelled) setToolbarPayloadError(errorMessage(e, '显示浮动条失败'))
      })
    return () => {
      cancelled = true
    }
  }, [buttons, buttonsError, payload, toolbarPayloadError])

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
    let currentPayload = payload
    if (!currentPayload?.selectedText?.trim()) {
      try {
        currentPayload = await invoke<ToolbarPayload | null>('quick_bar_toolbar_payload')
        if (currentPayload && mountedRef.current) setPayload(currentPayload)
      } catch (e) {
        setToolbarPayloadError(`读取划词上下文失败: ${errorMessage(e, '未知错误')}`)
        return
      }
    }
    const text = currentPayload?.selectedText?.trim()
    if (!text) {
      setToolbarPayloadError('当前没有可用的划词内容，无法调用能力')
      return
    }
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

  const toolbarContent = toolbarPayloadError ? (
    <span className="quickbar-toolbar-error">{toolbarPayloadError}</span>
  ) : buttonsError ? (
    <span className="quickbar-toolbar-error">{buttonsError}</span>
  ) : !buttons ? (
    <span className="quickbar-toolbar-loading">加载中...</span>
  ) : buttons.length === 0 ? (
    <span className="quickbar-toolbar-empty">暂无已注册按钮。请在能力浏览页注册能力。</span>
  ) : (
    buttons.map(button => (
      <button
        key={button.id}
        type="button"
        title={button.title}
        onClick={() => handleButtonClick(button)}
      >
        <ButtonIconGlyph className="quickbar-toolbar-icon" iconId={button.icon} seed={`${button.id}:${button.appId}:${button.capabilityId}:${button.title}`} size={20} />
      </button>
    ))
  )

  return (
    <main ref={shellRef} className="quickbar-toolbar-shell" aria-label="Quick Bar 浮动工具条">
      {toolbarContent}
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
