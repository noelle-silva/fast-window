import type { Api } from '../core'
import type { LowLevelGateway } from './types'

export function createGatewayApiAdapter(gateway: LowLevelGateway): Api {
  return {
    __meta: { runtime: 'ui' },
    host: {
      back: gateway.host.back,
    },
    ui: {
      showToast: gateway.host.toast,
      back: gateway.host.back,
      startDragging: gateway.host.startDragging,
    },
    clipboard: gateway.clipboard,
    files: gateway.files,
  }
}
