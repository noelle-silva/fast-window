import type { Api } from '../core'
import { ensureMetadata, saveMetadata, tryLoadMetadata } from '../core'
import type { MetadataService } from '../gateway/types'

export function createMetadataService(api: Api): MetadataService {
  return {
    tryLoadMetadata: () => tryLoadMetadata(api),
    ensureMetadata: () => ensureMetadata(api),
    saveMetadata: meta => saveMetadata(api, meta),
  }
}
