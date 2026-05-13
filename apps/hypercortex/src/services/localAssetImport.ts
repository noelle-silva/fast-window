import type { VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { HyperCortexNoteResourceRef } from '../noteSchema'
import { pickLocalAssetFiles } from './localAssetFilePicker'

export async function importPickedLocalAssets(
  gateway: HyperCortexGateway,
  scope: VaultScope,
): Promise<HyperCortexNoteResourceRef[]> {
  const files = await pickLocalAssetFiles()
  if (!files.length) return []
  return gateway.assets.importLocalFiles(scope, files)
}
