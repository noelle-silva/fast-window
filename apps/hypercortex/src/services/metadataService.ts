import type { BackgroundClient } from '../gateway/backgroundClient'
import type { MetadataService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createMetadataService(background: BackgroundClient): MetadataService {
  return {
    tryLoadMetadata: () => background.invoke(HyperCortexRpc.metadata.tryLoad, {}),
    ensureMetadata: () => background.invoke(HyperCortexRpc.metadata.ensure, {}),
    saveMetadata: meta => background.invoke(HyperCortexRpc.metadata.save, { meta }),
  }
}
