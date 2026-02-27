import { useEffect, useMemo, useRef } from 'react'
import { createPluginContext } from './pluginApi'
import { PluginCapability } from './pluginContract'
import { buildPluginSrcDoc } from './pluginSandbox'
import { dispatchPluginMethod } from './pluginMethods'
import { toBridgeError } from './pluginBridge'

type Props = {
  pluginId: string
  pluginCode: string
  requires?: PluginCapability[]
  onBack: () => void
}

export default function IframePluginView(props: Props) {
  const { pluginId, pluginCode, requires, onBack } = props
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const ctx = useMemo(() => createPluginContext(pluginId, requires ?? []), [pluginId, requires])

  const tokenRef = useRef<string>('')
  if (!tokenRef.current) {
    tokenRef.current = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  const srcDoc = useMemo(() => buildPluginSrcDoc({ pluginId, pluginCode, token: tokenRef.current, runtime: 'ui' }), [
    pluginId,
    pluginCode,
  ])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const iframeWin = iframeRef.current?.contentWindow
      if (!iframeWin || event.source !== iframeWin) return

      const msg: any = event.data
      if (!msg || msg.__fastWindowRequest !== true) return
      if (msg.pluginId !== pluginId) return
      if (msg.token !== tokenRef.current) return

      const { id, method, args } = msg

      const reply = (payload: any) => {
        iframeWin.postMessage({ __fastWindowResponse: true, pluginId, token: tokenRef.current, id, ...payload }, '*')
      }
      const postStream = (payload: any) => {
        iframeWin.postMessage({ __fastWindowStream: true, pluginId, token: tokenRef.current, ...payload }, '*')
      }

      Promise.resolve()
        .then(() => dispatchPluginMethod(ctx, String(method), args, { onBack, postStream }))
        .then(result => reply({ ok: true, result }))
        .catch(err => {
          const e = toBridgeError(err)
          reply({ ok: false, error: e.message, code: e.code, data: e.data })
        })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [ctx, onBack, pluginId])

  return (
    <iframe
      ref={iframeRef}
      title={pluginId}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ display: 'block', width: '100%', height: '100%', border: '0' }}
    />
  )
}
