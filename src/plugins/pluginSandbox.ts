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
      if (method === 'tauri.invoke') {
        const spec = args && args[0];
        const command = spec && spec.command ? String(spec.command) : '';
        const t = spec && typeof spec.timeoutMs === 'number' ? spec.timeoutMs : 0;
        // 允许插件明确指定超时；由宿主侧进一步钳制。
        if (t > 0) return Math.max(DEFAULT_TIMEOUT_MS, Math.min(t, 5 * 60 * 1000));
        // 自研“文件/目录选择”命令（rfd 对话框）属于人类交互时长，默认给长超时。
        if (command.startsWith('plugin_pick_')) return LONG_TIMEOUT_MS;
        // 常见交互类命令：对话框类给一个更宽松的前端等待时间。
        if (command.startsWith('plugin:dialog|')) return LONG_TIMEOUT_MS;
        // store 可能读写较大的 JSON（例如聊天历史）；默认 8s 容易误伤。
        if (command.startsWith('plugin:store|')) return 30 * 1000;
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
  });

   window.fastWindow = {
     __meta: { pluginId, apiVersion, runtime },
    host: {
      back: () => call('host.back', []),
    },
    tauri: {
      invoke: (spec) => call('tauri.invoke', [spec]),
      streamOpen: (spec) => call('tauri.streamOpen', [spec]),
      streamCancel: (streamId) => call('tauri.streamCancel', [streamId]),
      stream: async (spec) => {
        const r = await call('tauri.streamOpen', [spec]);
        const streamId = r && r.streamId ? String(r.streamId) : '';
        return createStream(streamId, 'tauri.streamCancel');
      },
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
