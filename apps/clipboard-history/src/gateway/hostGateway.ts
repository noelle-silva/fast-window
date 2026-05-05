import type { HostGateway } from './types'

export function createHostGateway(baseApi: any): HostGateway {
  return {
    toast: async (message) => baseApi?.host?.toast?.(String(message || '')),
    back: async () => baseApi?.host?.back?.(),
    startDragging: async () => baseApi?.host?.startDragging?.(),
  }
}
