import { createAiDrawDirectGateway } from './createAiDrawDirectGateway'
import type { AiDrawGateway } from './types'

function getHost(baseApi: unknown) {
  return (baseApi as any)?.host && typeof (baseApi as any).host === 'object' ? (baseApi as any).host : {}
}

function getBackgroundEndpoint(baseApi: unknown) {
  const background = (baseApi as any)?.background
  if (!background || typeof background.endpoint !== 'function') throw new Error('background.endpoint 不可用：当前宿主不支持 v4.5 direct 后台')
  return background.endpoint()
}

export async function createV45AiDrawGateway(baseApi: unknown): Promise<AiDrawGateway> {
  const hostApi = getHost(baseApi)
  return createAiDrawDirectGateway({
    loadEndpoint: () => getBackgroundEndpoint(baseApi),
    host: {
      back: typeof hostApi.back === 'function' ? () => hostApi.back() : undefined,
      toast: typeof hostApi.toast === 'function' ? (message) => hostApi.toast(String(message || '')) : undefined,
      startDragging: typeof hostApi.startDragging === 'function' ? () => hostApi.startDragging() : undefined,
      clipboard: hostApi.clipboard && typeof hostApi.clipboard === 'object' ? hostApi.clipboard : undefined,
    },
  })
}
