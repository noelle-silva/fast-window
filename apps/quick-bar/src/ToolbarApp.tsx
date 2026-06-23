import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createDirectClient } from './directClient'
import { fetchRegistryButtons } from './registryClient'
import { ButtonIconGlyph } from './buttonIcons'
import type { RegistryButton, ToolbarButtonClickResult, ToolbarPayload } from './types'

const appWindow = getCurrentWindow()

export function ToolbarApp() {
  const [payload, setPayload] = React.useState<ToolbarPayload | null>(null)
  const [toolbarVisible, setToolbarVisible] = React.useState(false)
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
    let unlistenSelection: (() => void) | null = null
    let unlistenVisibility: (() => void) | null = null
    void invoke<ToolbarPayload | null>('quick_bar_toolbar_payload')
      .then(next => {
        if (!cancelled) {
          setPayload(next)
          setToolbarVisible(Boolean(next))
        }
      })
      .catch(e => {
        if (!cancelled) setToolbarPayloadError(`读取划词上下文失败: ${errorMessage(e, '未知错误')}`)
      })
    void listen<ToolbarPayload>('quick-bar-selection', event => {
      setToolbarPayloadError(null)
      setToolbarVisible(true)
      setPayload(event.payload)
      void refreshButtons()
    })
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlistenSelection = nextUnlisten
      })
      .catch(e => {
        if (!cancelled) setToolbarPayloadError(`订阅划词选区失败: ${errorMessage(e, '未知错误')}`)
      })
    void listen<{ visible: boolean }>('quick-bar-toolbar-visibility', event => {
      setToolbarVisible(event.payload.visible)
    })
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlistenVisibility = nextUnlisten
      })
    return () => {
      cancelled = true
      unlistenSelection?.()
      unlistenVisibility?.()
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
    const text = payload?.selectedText?.trim()
    if (!text) {
      setToolbarPayloadError('当前没有可用的划词内容，无法调用能力')
      return
    }
    let client: Awaited<ReturnType<typeof createDirectClient>> | null = null
    try {
      await invoke('show_quick_bar_result_popup', { title: button.title })
      try {
        client = await createDirectClient()
        const response = await client.request<ToolbarButtonClickResult>('quickBar.toolbar.buttonClick', {
          buttonId: button.id,
          selectedText: text,
        })
        if (typeof response.title !== 'string' || typeof response.text !== 'string') {
          throw new Error('能力调用结果格式不正确')
        }
        await invoke('update_quick_bar_result_popup', {
          payload: { title: response.title, status: 'done', text: response.text },
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
    <main
      ref={shellRef}
      className={`quickbar-toolbar-shell${toolbarVisible ? '' : ' quickbar-toolbar-shell--hidden'}`}
      aria-hidden={!toolbarVisible}
      aria-label="Quick Bar 浮动工具条"
    >
      {toolbarContent}
    </main>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

