import type { ClipboardGateway } from './types'
import type { V2HostAdapter } from './v2HostAdapter'

export function createClipboardGateway(adapter: V2HostAdapter): ClipboardGateway {
  return {
    writeText: (text) => adapter.clipboard.writeText(text),
    writeImage: (dataUrl) => adapter.clipboard.writeImage(dataUrl),
  }
}
