import { createDirectBackgroundGateway } from './directBackgroundGateway'
import type { ClipboardHistoryGateway } from './types'

export async function createClipboardHistoryGateway(endpoint: any): Promise<ClipboardHistoryGateway> {
  const background = await createDirectBackgroundGateway(endpoint)
  return {
    state: background.state,
    collections: background.collections,
    clipboard: background.clipboard,
    images: background.images,
    legacy: background.legacy,
    onSnapshot: background.onSnapshot,
    close: background.close,
  }
}
