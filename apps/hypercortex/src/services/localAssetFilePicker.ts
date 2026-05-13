import { invoke } from '@tauri-apps/api/core'
import { ACCEPTED_FILE_EXTENSIONS } from '../assetFileTypes'
import type { LocalAssetFile } from '../gateway/types'

type PickedAssetFile = {
  path?: string
  name?: string
}

export async function pickLocalAssetFiles(): Promise<LocalAssetFile[]> {
  const picked = await invoke<PickedAssetFile[]>('pick_asset_files', {
    extensions: [...ACCEPTED_FILE_EXTENSIONS],
  })

  const seen = new Set<string>()
  const files: LocalAssetFile[] = []
  for (const item of Array.isArray(picked) ? picked : []) {
    const path = String(item?.path || '').trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    const displayName = String(item?.name || '').trim()
    files.push({ path, displayName: displayName || undefined })
  }
  return files
}
