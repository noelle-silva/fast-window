import { createDirectBackgroundGateway } from './directBackgroundGateway'
import { createHostGateway } from './hostGateway'
import type { ClipboardHistoryGateway } from './types'

export async function createClipboardHistoryGateway(endpoint: any): Promise<ClipboardHistoryGateway> {
  const background = await createDirectBackgroundGateway(endpoint)
  const host = createHostGateway()
  return {
    host,
    state: background.state,
    collections: background.collections,
    clipboard: background.clipboard,
    images: background.images,
    legacy: background.legacy,
    onSnapshot: background.onSnapshot,
    close: background.close,
  }
}
