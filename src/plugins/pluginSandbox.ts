import { PLUGIN_API_VERSION } from './pluginContract'

export type PluginRuntime = 'ui' | 'background'

export function buildPluginSdkCode(opts: {
  pluginId: string
  token: string
  runtime: PluginRuntime
}) {
  const { pluginId, token, runtime } = opts

  const sendExpr = `(() => {
  const p = globalThis.__fastWindowPort;
  if (!p || typeof p.postMessage !== 'function') throw new Error('fastWindow MessagePort is not ready');
  return (payload) => p.postMessage(payload);
})()`

  const listenExpr = `(() => {
  const handler = (msg) => onMsg(msg);
  try {
    const p = globalThis.__fastWindowPort;
    if (p) {
      p.onmessage = (e) => handler(e && e.data);
    }
  } catch {}
})()`

  return `
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

  const streams = new Map();
  const pendingStreamEvents = new Map();
  const canceledStreamIds = new Set();

  function enqueueStreamEvent(streamId, event) {
    if (!streamId) return;
    if (canceledStreamIds.has(streamId)) return;
    const st = streams.get(streamId);
    if (st) return st._push(event);

    const list = pendingStreamEvents.get(streamId) || [];
    if (list.length < 256) list.push(event);
    pendingStreamEvents.set(streamId, list);
  }

  function createStream(streamId, cancelMethod) {
    if (!streamId) throw new Error('streamId is required');
    canceledStreamIds.delete(streamId);
    if (streams.has(streamId)) return streams.get(streamId);

    const cm = cancelMethod ? String(cancelMethod) : 'tauri.streamCancel';

    const st = {
      streamId,
      queue: [],
      waiters: [],
      closed: false,
      error: null,
      _push(event) {
        if (this.closed) return;
        const type = event && event.type;
        if (type === 'error') {
          this.error = new Error(event && event.message ? String(event.message) : 'Stream error');
          this.closed = true;
          streams.delete(streamId);
          pendingStreamEvents.delete(streamId);
          while (this.waiters.length) this.waiters.shift().reject(this.error);
          return;
        }
        if (type === 'end') {
          this.closed = true;
          streams.delete(streamId);
          pendingStreamEvents.delete(streamId);
          while (this.waiters.length) this.waiters.shift().resolve({ value: undefined, done: true });
          return;
        }

        this.queue.push(event);
        if (this.waiters.length) this.waiters.shift().resolve({ value: this.queue.shift(), done: false });
      },
      cancel() {
        this.closed = true;
        streams.delete(streamId);
        pendingStreamEvents.delete(streamId);
        canceledStreamIds.add(streamId);
        return call(cm, [streamId]).catch(() => {});
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (this.error) return Promise.reject(this.error);
        if (this.queue.length) return Promise.resolve({ value: this.queue.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
      return() {
        this.cancel();
        return Promise.resolve({ value: undefined, done: true });
      },
    };

    streams.set(streamId, st);
    const list = pendingStreamEvents.get(streamId) || [];
    pendingStreamEvents.delete(streamId);
    for (const ev of list) st._push(ev);
    return st;
  }

  function resolveTimeoutMs(method, args) {
    try {
      if (method === 'tauri.invoke' || method === 'tauri.streamOpen') {
        const spec = args && args[0];
        const command = spec && spec.command ? String(spec.command) : '';

        const t0 = spec && typeof spec.timeoutMs === 'number' ? spec.timeoutMs : 0;
        if (t0 > 0) return Math.max(DEFAULT_TIMEOUT_MS, Math.min(t0, 5 * 60 * 1000));

        const payload = spec && spec.payload && typeof spec.payload === 'object' ? spec.payload : null;
        if (payload) {
          let inferred = 0;
          try {
            if (command === 'http_request' || command === 'http_request_base64' || command === 'http_request_stream') {
              const req = payload.req && typeof payload.req === 'object' ? payload.req : null;
              const t1 = req && typeof req.timeoutMs === 'number' ? req.timeoutMs : 0;
              if (t1 > 0) inferred = t1;
            }
            if (!inferred) {
              const t2 = typeof payload.timeoutMs === 'number' ? payload.timeoutMs : 0;
              if (t2 > 0) inferred = t2;
            }
          } catch {}
          if (inferred > 0) return Math.max(DEFAULT_TIMEOUT_MS, Math.min(inferred, LONG_TIMEOUT_MS));
        }

        if (command.startsWith('plugin:dialog|')) return LONG_TIMEOUT_MS;
        if (command.startsWith('plugin:store|')) return 30 * 1000;
      }
    } catch {}
    return DEFAULT_TIMEOUT_MS;
  }

  function ensureSpecTimeoutMs(spec) {
    try {
      const s = spec && typeof spec === 'object' ? spec : null;
      if (!s) return spec;
      const command = s.command ? String(s.command) : '';
      if (!command) return spec;

      const t0 = typeof s.timeoutMs === 'number' ? s.timeoutMs : 0;
      if (t0 > 0) return spec;

      const payload = s.payload && typeof s.payload === 'object' ? s.payload : null;
      if (!payload) return spec;

      let inferred = 0;
      if (command === 'http_request' || command === 'http_request_base64' || command === 'http_request_stream') {
        const req = payload.req && typeof payload.req === 'object' ? payload.req : null;
        const t1 = req && typeof req.timeoutMs === 'number' ? req.timeoutMs : 0;
        if (t1 > 0) inferred = t1;
      }
      if (!inferred) {
        const t2 = typeof payload.timeoutMs === 'number' ? payload.timeoutMs : 0;
        if (t2 > 0) inferred = t2;
      }

      if (inferred <= 0) return spec;
      return { ...s, timeoutMs: inferred };
    } catch {
      return spec;
    }
  }

  const send = ${sendExpr};

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
      send({ __fastWindowRequest: true, pluginId, apiVersion, token, id, method, args });
    });
  }

  function onMsg(msg) {
    if (msg && msg.__fastWindowStream === true) {
      if (msg.pluginId !== pluginId) return;
      if (msg.token !== token) return;
      enqueueStreamEvent(String(msg.streamId || ''), msg.event);
      return;
    }
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
  }

  ${listenExpr};

  window.fastWindow = {
    __meta: { pluginId, apiVersion, runtime },
    host: {
      back: () => call('host.back', []),
    },
    tauri: {
      invoke: (spec) => call('tauri.invoke', [ensureSpecTimeoutMs(spec)]),
      streamOpen: (spec) => call('tauri.streamOpen', [ensureSpecTimeoutMs(spec)]),
      streamCancel: (streamId) => call('tauri.streamCancel', [streamId]),
      stream: async (spec) => {
        const r = await call('tauri.streamOpen', [ensureSpecTimeoutMs(spec)]);
        const streamId = r && r.streamId ? String(r.streamId) : '';
        return createStream(streamId, 'tauri.streamCancel');
      },
    },
  };
})();`
}

export function buildPluginShellSrcDoc() {
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
    <script>
      (() => {
        let port = null;
        let expected = null;

        function postStatus(type, payload) {
          try {
            if (port) port.postMessage({ __fastWindowShell: true, type, ...payload });
          } catch {}
        }

        async function loadCodeAsScript(code, label) {
          const blob = new Blob([String(code || '') + '\\n//# sourceURL=' + String(label || 'plugin') + '\\n'], {
            type: 'text/javascript',
          });
          const url = URL.createObjectURL(blob);
          try {
            await new Promise((resolve, reject) => {
              const s = document.createElement('script');
              s.src = url;
              s.async = false;
              s.onload = () => resolve(null);
              s.onerror = () => reject(new Error('Failed to load ' + String(label || 'script')));
              document.head.appendChild(s);
            });
          } finally {
            URL.revokeObjectURL(url);
          }
        }

        function onInitMessage(event) {
          const msg = event && event.data;
          if (!msg || msg.__fastWindowInitPort !== true) return;
          if (port) return;

          const p = event && event.ports && event.ports[0];
          if (!p) return;
          port = p;
          expected = {
            token: String(msg.token || ''),
            pluginId: String(msg.pluginId || ''),
            runtime: String(msg.runtime || ''),
          };

          globalThis.__fastWindowPort = port;
          try {
            if (!globalThis.fastWindow) globalThis.fastWindow = {};
            const m = (globalThis.fastWindow.__meta && typeof globalThis.fastWindow.__meta === 'object') ? globalThis.fastWindow.__meta : {};
            globalThis.fastWindow.__meta = { ...m, pluginId: expected.pluginId, runtime: expected.runtime };
          } catch {}

          port.onmessage = async (e) => {
            const data = e && e.data;
            if (!data || data.__fastWindowBoot !== true) return;
            if (!expected || String(data.token || '') !== expected.token) return;

            try {
              await loadCodeAsScript(String(data.sdkCode || ''), 'fast-window-sdk.js');
              await loadCodeAsScript(String(data.pluginCode || ''), expected.pluginId ? (expected.pluginId + '.js') : 'plugin.js');
              postStatus('boot-ok', { pluginId: expected.pluginId, runtime: expected.runtime });
            } catch (err) {
              postStatus('boot-error', { message: String(err && err.message ? err.message : err) });
              throw err;
            }
          };

          postStatus('port-ready', { pluginId: expected.pluginId, runtime: expected.runtime });
        }

        window.addEventListener('message', onInitMessage);
      })();
    </script>
  </body>
</html>`
}
