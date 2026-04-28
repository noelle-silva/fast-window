import type { ImageGateway } from './types'
import type { V2HostAdapter } from './v2HostAdapter'

export function createImageGateway(adapter: V2HostAdapter): ImageGateway {
  return {
    readOutputImage: (path) => adapter.images.read({ scope: 'output', path }),
    deleteOutputImage: (path) => adapter.images.delete({ scope: 'output', path }),
  }
}
