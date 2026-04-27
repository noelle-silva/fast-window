import { useEffect, useMemo, useRef } from 'react'
import { createPluginContext } from './pluginApi'
import { toBridgeError } from './pluginBridge'
import type { PluginApiVersion, PluginCapability } from './pluginContract'
import { dispatchPluginMethod } from './pluginMethods'
import type { PluginRuntimeProfile } from './pluginProfiles'
import { buildPluginShellSrcDoc } from './pluginSandbox'

export type PluginFrameViewProps = {
  pluginId: string
  pluginCode: string
  apiVersion: PluginApiVersion
  requires?: PluginCapability[]
  runtime: 'ui' | 'background'
  runtimeProfile: PluginRuntimeProfile
  buildSdkCode: (token: string) => string
  assetBaseUrl?: string
  onBack?: () => void
  title?: string
  hidden?: boolean
}

function createFrameToken() {
  try {
    const a = new Uint32Array(4)
    crypto.getRandomValues(a)
    return Array.from(a).join('-')
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

const visibleFrameStyle = { display: 'block', width: '100%', height: '100%', border: '0' } as const
const hiddenFrameStyle = { position: 'fixed', width: 0, height: 0, border: 0, opacity: 0, pointerEvents: 'none' } as const

function hashPluginCode(code: string) {
  let h = 2166136261
  for (let i = 0; i < code.length; i += 1) {
    h ^= code.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export default function PluginFrameView(props: PluginFrameViewProps) {
  const { pluginId, pluginCode, apiVersion, requires, runtime, runtimeProfile, buildSdkCode, assetBaseUrl, onBack, title, hidden } = props
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const ctx = useMemo(() => createPluginContext(pluginId, apiVersion, requires ?? []), [apiVersion, pluginId, requires])
  const portRef = useRef<MessagePort | null>(null)
  const bootTimerRef = useRef<number | null>(null)
  const tokenRef = useRef<string>('')

  if (!tokenRef.current) tokenRef.current = createFrameToken()

  const srcDoc = useMemo(() => buildPluginShellSrcDoc(assetBaseUrl), [assetBaseUrl])

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
      console.error(`[plugin-shell] boot timeout for "${pluginId}"`)
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
          .then(() => dispatchPluginMethod(ctx, String(method), args, { runtime, rpcProfile: runtimeProfile.rpcProfile, onBack, postStream }))
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
          console.error(`[plugin-shell] boot-error for "${pluginId}":`, msg.message)
          if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current)
          bootTimerRef.current = null
        }
      }
    }

    iframeWin.postMessage(
      { __fastWindowInitPort: true, pluginId, runtime, token: tokenRef.current },
      '*',
      [ch.port2],
    )

    port.postMessage({ __fastWindowBoot: true, token: tokenRef.current, sdkCode: buildSdkCode(tokenRef.current), pluginCode })
  }

  return (
    <iframe
      ref={iframeRef}
      title={title ?? pluginId}
      srcDoc={srcDoc}
      onLoad={onLoad}
      key={`${pluginId}-${runtime}-v${apiVersion}-${hashPluginCode(pluginCode)}`}
      style={hidden ? hiddenFrameStyle : visibleFrameStyle}
    />
  )
}
