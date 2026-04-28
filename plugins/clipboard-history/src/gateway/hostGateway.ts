import type { HostGateway } from './types'
import type { V2HostAdapter } from './v2HostAdapter'

export function createHostGateway(adapter: V2HostAdapter): HostGateway {
  return {
    toast: (message) => adapter.host.toast(message),
    back: () => adapter.host.back(),
    startDragging: () => adapter.host.startDragging(),
  }
}
