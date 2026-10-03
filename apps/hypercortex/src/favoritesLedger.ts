import type { VaultScope } from './core'
import type { HyperCortexGateway } from './gateway'
import { stripDraftNoteRefs, type HyperCortexFavoritesDocV1 } from './favorites'

// 账本管理员：收藏夹文档的唯一读写入口。
// - 读：从后端装载（后端是唯一规范化权威），进内存整理一次，之后由消费方直接取用。
// - 写：内存态 → 磁盘态由这里统一转换（剔除草稿引用），经后端唯一存盘通道落盘。
// - 草稿只留内存：磁盘态与上次基线一致时不写盘，转正后才向后端正式登记。

export type FavoritesLedger = {
  /** 从后端装载文档并建立磁盘态基线；返回内存态文档（保留草稿引用）。 */
  load: () => Promise<HyperCortexFavoritesDocV1>
  /** 提交内存态变更：统一转换磁盘态，与基线一致则不写盘。 */
  commit: (next: HyperCortexFavoritesDocV1) => void
}

// 磁盘态语义指纹：忽略会随任意内存操作刷新的 updatedAtMs，
// 只比较结构（收藏夹身份/标题/说明、条目身份/目标/布局）。
// 这样仅草稿引用变化时磁盘态视为未变，不会触发后端写入。
function diskFormFingerprint(doc: HyperCortexFavoritesDocV1): string {
  const folders = Object.keys(doc.folders)
    .sort()
    .map(id => {
      const folder = doc.folders[id]
      return [id, folder.title, folder.description, folder.createdAtMs]
    })
  const refs = Object.keys(doc.refsByFolderId)
    .sort()
    .map(folderId => {
      const list = Array.isArray(doc.refsByFolderId[folderId]) ? doc.refsByFolderId[folderId] : []
      return [folderId, list.map(ref => [ref.id, ref.folderId, ref.kind, ref.targetId, ref.layout.x, ref.layout.y, ref.layout.w, ref.layout.h])]
    })
  return JSON.stringify([doc.rootFolderId, folders, refs])
}

export function createFavoritesLedger(gateway: HyperCortexGateway, scope: VaultScope): FavoritesLedger {
  let baseline: string | null = null

  const load = async (): Promise<HyperCortexFavoritesDocV1> => {
    const doc = await gateway.favorites.ensureFavorites(scope)
    baseline = diskFormFingerprint(stripDraftNoteRefs(doc))
    return doc
  }

  const commit = (next: HyperCortexFavoritesDocV1): void => {
    const disk = stripDraftNoteRefs(next)
    const fingerprint = diskFormFingerprint(disk)
    if (baseline !== null && fingerprint === baseline) return
    baseline = fingerprint
    void gateway.favorites.saveFavorites(scope, disk).catch(() => {})
  }

  return { load, commit }
}
