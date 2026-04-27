export type BackgroundClient = {
  invoke<T = unknown>(method: string, params?: unknown): Promise<T>
}

export function createBackgroundClient(baseApi: any): BackgroundClient {
  const invoke = baseApi?.background?.invoke
  if (typeof invoke !== 'function') throw new Error('HyperCortex 需要 v4 background.invoke')
  return {
    invoke<T = unknown>(method: string, params?: unknown): Promise<T> {
      return invoke.call(baseApi.background, method, params ?? {}) as Promise<T>
    },
  }
}
