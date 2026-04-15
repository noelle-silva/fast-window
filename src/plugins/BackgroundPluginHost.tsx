import { useEffect, useMemo, useRef } from 'react'
import { createPluginContext } from './pluginApi'
import { PluginCapability } from './pluginContract'
import { buildPluginSdkCode, buildPluginShellSrcDoc } from './pluginSandbox'
import { dispatchPluginMethod } from './pluginMethods'
import { toBridgeError } from './pluginBridge'

type Props = {
  pluginId: string
  pluginCode: string
  requires?: PluginCapability[]
}

export default function BackgroundPluginHost(props: Props) {
  const { pluginId, pluginCode, requires } = props
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const ctx = useMemo(() => createPluginContext(pluginId, requires ?? []), [pluginId, requires])
  const portRef = useRef<MessagePort | null>(null)
  const bootTimerRef = useRef<number | null>(null)

  const tokenRef = useRef<string>('')
  if (!tokenRef.current) {
    try {
      const a = new Uint32Array(4)
      crypto.getRandomValues(a)
      tokenRef.current = Array.from(a).join('-')
    } catch {
      tokenRef.current = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
  }

  const srcDoc = useMemo(() => buildPluginShellSrcDoc(), [])

  useEffect(() => {
    // v2-only：宿主不再处理 window.postMessage RPC（只走 MessagePort 专线）。
    return
  }, [ctx, pluginId])

  useEffect(() => {
    return () => {
      try {
        portRef.current?.close()
      } catch {}
      portRef.current = null

      if (bootTimerRef.current) {
        window.clearTimeout(bootTimerRef.current)
        bootTimerRef.current = null
      }
    }
  }, [])

  const onLoad = () => {
    const iframeWin = iframeRef.current?.contentWindow
    if (!iframeWin) return

    try {
      portRef.current?.close()
    } catch {}
    portRef.current = null

    const ch = new MessageChannel()
    const port = ch.port1
    portRef.current = port

    if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current)
    bootTimerRef.current = window.setTimeout(() => {
      console.error(`[plugin-shell] bg boot timeout for "${pluginId}" (v2-only)`)
    }, 4000)

    port.onmessage = (event: MessageEvent) => {
      const msg: any = (event as any).data
      if (!msg) return

      if (msg.__fastWindowRequest === true) {
        if (msg.pluginId !== pluginId) return
        if (msg.token !== tokenRef.current) return

        const { id, method, args } = msg
        const reply = (payload: any) => {
          port.postMessage({ __fastWindowResponse: true, pluginId, token: tokenRef.current, id, ...payload })
        }
        const postStream = (payload: any) => {
          port.postMessage({ __fastWindowStream: true, pluginId, token: tokenRef.current, ...payload })
        }

        Promise.resolve()
          .then(() => dispatchPluginMethod(ctx, String(method), args, { runtime: 'background', postStream }))
          .then(result => reply({ ok: true, result }))
          .catch(err => {
            const e = toBridgeError(err)
            reply({ ok: false, error: e.message, code: e.code, data: e.data })
          })
        return
      }

      if (msg.__fastWindowShell === true) {
        if (msg.type === 'boot-ok') {
          if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current)
          bootTimerRef.current = null
          return
        }
        if (msg.type === 'boot-error') {
          console.error(`[plugin-shell] boot-error for "${pluginId}" (v2-only):`, msg.message)
          if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current)
          bootTimerRef.current = null
          // v2-only：不回退到 v1，让你更快发现 v2 壳/通道问题。
        }
        return
      }
    }

    iframeWin.postMessage(
      { __fastWindowInitPort: true, pluginId, runtime: 'background', token: tokenRef.current },
      '*',
      [ch.port2],
    )

    const sdkCode = buildPluginSdkCode({ pluginId, token: tokenRef.current, runtime: 'background' })
    port.postMessage({ __fastWindowBoot: true, token: tokenRef.current, sdkCode, pluginCode })
  }

  return (
    <iframe
      ref={iframeRef}
      title={`bg-${pluginId}`}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      onLoad={onLoad}
      key={`${pluginId}-v2-${pluginCode.length}`}
      style={{ position: 'fixed', width: 0, height: 0, border: 0, opacity: 0, pointerEvents: 'none' }}
    />
  )
}
