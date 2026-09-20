import { convertFileSrc } from '@tauri-apps/api/core'

/** 数据目录 + 资产 id → asset protocol URL（收藏桌面与顶部栏共用）。 */
export function dataDirAssetUrl(dataDir: string, assetId: string): string {
  const relative = `assets/${assetId}`.split('/').join('\\')
  return convertFileSrc(`${dataDir}\\${relative}`)
}
