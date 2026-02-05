import { useEffect, useMemo, useRef } from 'react'
import { createPluginContext } from './pluginApi'
import { PLUGIN_API_VERSION, PluginCapability } from './pluginContract'

type Props = {
  pluginId: string
  pluginCode: string
  requires?: PluginCapability[]
  onBack: () => void
}

function buildSrcDoc(pluginId: string, pluginCode: string, token: string) {
  const sdk = `
(() => {
  const pluginId = ${JSON.stringify(pluginId)};
  const apiVersion = ${PLUGIN_API_VERSION};
  const token = ${JSON.stringify(token)};

  let seq = 0;
  const pending = new Map();
  const MAX_PENDING = 128;
  const DEFAULT_TIMEOUT_MS = 8000;

  function call(method, args) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      if (pending.size >= MAX_PENDING) {
        reject(new Error('Too many in-flight requests'));
        return;
      }

      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Request timeout'));
      }, DEFAULT_TIMEOUT_MS);

      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ __fastWindowRequest: true, pluginId, apiVersion, token, id, method, args }, '*');
    });
  }

  window.addEventListener('message', (e) => {
    const msg = e && e.data;
    if (!msg || msg.__fastWindowResponse !== true) return;
    if (msg.pluginId !== pluginId) return;
    if (msg.token !== token) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
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
    files: {
      getOutputDir: () => call('files.getOutputDir', []),
      pickOutputDir: () => call('files.pickOutputDir', []),
      openOutputDir: () => call('files.openOutputDir', []),
      saveImageBase64: (dataUrlOrBase64) => call('files.saveImageBase64', [dataUrlOrBase64]),
    },
    ui: {
      showToast: (message) => call('ui.showToast', [message]),
      openUrl: (url) => call('ui.openUrl', [url]),
      back: () => call('host.back', []),
    },
    net: {
      request: (req) => call('net.request', [req]),
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

  const tokenRef = useRef<string>('')
  if (!tokenRef.current) {
    tokenRef.current = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  const handlers = useMemo(() => {
    return {
      'clipboard.readText': ctx.api.clipboard.readText,
      'clipboard.writeText': ctx.api.clipboard.writeText,
      'clipboard.readImage': ctx.api.clipboard.readImage,
      'clipboard.writeImage': ctx.api.clipboard.writeImage,
      'storage.get': ctx.api.storage.get,
      'storage.set': ctx.api.storage.set,
      'storage.remove': ctx.api.storage.remove,
      'storage.getAll': ctx.api.storage.getAll,
      'storage.setAll': ctx.api.storage.setAll,
      'files.getOutputDir': (ctx.api as any).files?.getOutputDir,
      'files.pickOutputDir': (ctx.api as any).files?.pickOutputDir,
      'files.openOutputDir': (ctx.api as any).files?.openOutputDir,
      'files.saveImageBase64': (ctx.api as any).files?.saveImageBase64,
      'ui.showToast': ctx.api.ui.showToast,
      'ui.openUrl': ctx.api.ui.openUrl,
      'net.request': (ctx.api as any).net?.request,
    } as const
  }, [ctx.api])

  const srcDoc = useMemo(
    () => buildSrcDoc(pluginId, pluginCode, tokenRef.current),
    [pluginId, pluginCode],
  )

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

      if (method === 'host.back') {
        onBack()
        reply({ ok: true, result: null })
        return
      }

      const key = String(method)
      const handler = (handlers as any)[key]
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
  }, [handlers, onBack, pluginId])

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
