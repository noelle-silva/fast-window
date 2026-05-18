export function createNetApi(tauri: any) {
  return {
    request: async (req: any) => {
      const t0 = (req as any)?.timeoutMs
      const timeoutMs =
        typeof t0 === 'number' && Number.isFinite(t0) ? Math.max(1, Math.floor(t0)) : 120000
      return tauri.invoke({ command: 'http_request', payload: { req }, timeoutMs })
    },
    requestStream: async (req: any) => {
      if (typeof tauri.stream !== 'function') throw new Error('tauri.stream 不可用（请更新宿主网关）')
      const t0 = (req as any)?.timeoutMs
      const timeoutMs =
        typeof t0 === 'number' && Number.isFinite(t0) ? Math.max(1, Math.floor(t0)) : 15 * 60 * 1000
      return tauri.stream({
        command: 'http_request_stream',
        payload: { req },
        timeoutMs,
        detached: true,
        cancel: { command: 'http_request_stream_cancel', idKey: 'streamId' },
      })
    },
  }
}
