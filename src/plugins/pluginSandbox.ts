import { PLUGIN_API_VERSION } from './pluginContract'

export type PluginRuntime = 'ui' | 'background'

export function buildPluginSrcDoc(opts: { pluginId: string; pluginCode: string; token: string; runtime: PluginRuntime }) {
  const { pluginId, pluginCode, token, runtime } = opts

  const sdk = `
(() => {
  const pluginId = ${JSON.stringify(pluginId)};
  const apiVersion = ${PLUGIN_API_VERSION};
  const token = ${JSON.stringify(token)};
  const runtime = ${JSON.stringify(runtime)};

  let seq = 0;
  const pending = new Map();
  const MAX_PENDING = 128;
  const DEFAULT_TIMEOUT_MS = 8000;
  const LONG_TIMEOUT_MS = 15 * 60 * 1000;

  function resolveTimeoutMs(method, args) {
    try {
      // 文件选择类是“人类交互时长”，不该按普通 RPC 8s 超时算。
      // 统一放宽：避免用户打开选择框后思考几秒就被判定超时。
      if (String(method || '').startsWith('files.pick')) return LONG_TIMEOUT_MS;
      if (method === 'net.request') {
        const req = args && args[0];
        const t = req && typeof req.timeoutMs === 'number' ? req.timeoutMs : 0;
        if (t > 0) return Math.max(DEFAULT_TIMEOUT_MS, Math.min(t + 5000, 5 * 60 * 1000));
      }
    } catch {}
    return DEFAULT_TIMEOUT_MS;
  }

  function call(method, args) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      if (pending.size >= MAX_PENDING) {
        reject(new Error('Too many in-flight requests'));
        return;
      }

      const timeoutMs = resolveTimeoutMs(method, args);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Request timeout'));
      }, timeoutMs);

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
    else {
      const err = new Error(msg.error || 'Unknown error');
      if (msg.code) err.code = msg.code;
      if (msg.data !== undefined) err.data = msg.data;
      entry.reject(err);
    }
  });

  window.fastWindow = {
    __meta: { pluginId, apiVersion, runtime },
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
      pickDir: () => call('files.pickDir', []),
      openOutputDir: () => call('files.openOutputDir', []),
      openDir: (dir) => call('files.openDir', [dir]),
      saveImageBase64: (dataUrlOrBase64) => call('files.saveImageBase64', [dataUrlOrBase64]),
      saveRefImageBase64: (dataUrlOrBase64) => call('files.saveRefImageBase64', [dataUrlOrBase64]),
      listOutputImages: () => call('files.listOutputImages', []),
      readOutputImage: (path) => call('files.readOutputImage', [path]),
      deleteOutputImage: (path) => call('files.deleteOutputImage', [path]),
      listRefImages: () => call('files.listRefImages', []),
      readRefImage: (path) => call('files.readRefImage', [path]),
      deleteRefImage: (path) => call('files.deleteRefImage', [path]),
      pickImages: (maxCount) => call('files.pickImages', [maxCount]),
    },
    ui: {
      showToast: (message) => call('ui.showToast', [message]),
      openUrl: (url) => call('ui.openUrl', [url]),
      openExternal: (uri) => call('ui.openExternal', [uri]),
      openBrowserWindow: (url) => call('ui.openBrowserWindow', [url]),
      back: () => call('host.back', []),
    },
    net: {
      request: (req) => call('net.request', [req]),
      requestBase64: (req) => call('net.requestBase64', [req]),
    },
    task: {
      create: (req) => call('task.create', [req]),
      get: (taskId) => call('task.get', [taskId]),
      list: (limit) => call('task.list', [limit]),
      cancel: (taskId) => call('task.cancel', [taskId]),
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
    ${runtime === 'ui' ? '<div id="app"></div>' : ''}
    <script>;(new Function(${JSON.stringify(sdk)}))();</script>
    <script>;(new Function(${JSON.stringify(pluginCode)}))();</script>
  </body>
</html>`
}
