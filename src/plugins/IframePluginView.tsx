import { useEffect, useMemo, useRef } from 'react'
import { createPluginContext } from './pluginApi'
import { PLUGIN_API_VERSION, PluginCapability } from './pluginContract'

type Props = {
  pluginId: string
  pluginCode: string
  requires?: PluginCapability[]
  onBack: () => void
}

function buildSrcDoc(pluginId: string, pluginCode: string) {
  const sdk = `
(() => {
  const pluginId = ${JSON.stringify(pluginId)};
  const apiVersion = ${PLUGIN_API_VERSION};

  let seq = 0;
  const pending = new Map();

  function call(method, args) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      parent.postMessage({ __fastWindowRequest: true, pluginId, apiVersion, id, method, args }, '*');
    });
  }

  window.addEventListener('message', (e) => {
    const msg = e && e.data;
    if (!msg || msg.__fastWindowResponse !== true) return;
    if (msg.pluginId !== pluginId) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || 'Unknown error'));
  });

  window.fastWindow = {
    __meta: { pluginId, apiVersion },
    clipboard: {
      readText: () => call('clipboard.readText', []),
      writeText: (text) => call('clipboard.writeText', [text]),
      readImage: () => call('clipboard.readImage', []),
      writeImage: (dataUrl) => call('clipboard.writeImage', [dataUrl]),
    },
    storage: {
      get: (key) => call('storage.get', [key]),
      set: (key, value) => call('storage.set', [key, value]),
      remove: (key) => call('storage.remove', [key]),
      getAll: () => call('storage.getAll', []),
      setAll: (data) => call('storage.setAll', [data]),
    },
    ui: {
      showToast: (message) => call('ui.showToast', [message]),
      back: () => call('host.back', []),
    },
  };
})();`

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { height: 100%; }
      body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>;(new Function(${JSON.stringify(sdk)}))();</script>
    <script>;(new Function(${JSON.stringify(pluginCode)}))();</script>
  </body>
</html>`
}

export default function IframePluginView(props: Props) {
  const { pluginId, pluginCode, requires, onBack } = props
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const ctx = useMemo(() => createPluginContext(pluginId, requires), [pluginId, requires])

  const srcDoc = useMemo(() => buildSrcDoc(pluginId, pluginCode), [pluginId, pluginCode])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const iframeWin = iframeRef.current?.contentWindow
      if (!iframeWin || event.source !== iframeWin) return

      const msg: any = event.data
      if (!msg || msg.__fastWindowRequest !== true) return
      if (msg.pluginId !== pluginId) return

      const { id, method, args } = msg

      const reply = (payload: any) => {
        iframeWin.postMessage({ __fastWindowResponse: true, pluginId, id, ...payload }, '*')
      }

      if (method === 'host.back') {
        onBack()
        reply({ ok: true, result: null })
        return
      }

      const [ns, fn] = String(method).split('.', 2)
      const target: any = (ctx.api as any)[ns]
      const handler = target?.[fn]
      if (typeof handler !== 'function') {
        reply({ ok: false, error: `Unknown method: ${String(method)}` })
        return
      }

      Promise.resolve()
        .then(() => handler(...(Array.isArray(args) ? args : [])))
        .then((result) => reply({ ok: true, result }))
        .catch((err) => reply({ ok: false, error: String(err?.message || err) }))
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [ctx.api, onBack, pluginId])

  return (
    <iframe
      ref={iframeRef}
      title={pluginId}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={{ width: '100%', height: '100%', border: '0' }}
    />
  )
}
