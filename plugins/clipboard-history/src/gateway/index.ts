import { createClipboardGateway } from './clipboardGateway'
import { createHostGateway } from './hostGateway'
import { createImageGateway } from './imageGateway'
import { createMonitorGateway } from './monitorGateway'
import { createStorageGateway } from './storageGateway'
import type { ClipboardHistoryGateway } from './types'
import { createV2HostAdapter } from './v2HostAdapter'

export function createClipboardHistoryGateway(baseApi: any): ClipboardHistoryGateway & { runtime: 'ui' | 'background' } {
  const adapter = createV2HostAdapter(baseApi)
  return {
    runtime: adapter.runtime,
    host: createHostGateway(adapter),
    storage: createStorageGateway(adapter),
    monitor: createMonitorGateway(adapter),
    clipboard: createClipboardGateway(adapter),
    images: createImageGateway(adapter),
  }
}
