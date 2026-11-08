// 提示词仓库的放置规则：把「这一条能不能放到那一层」收敛成纯函数。
// 侧边栏列表、面包屑下拉共用同一份判断，组件里不再各自复述树规则。

import {
  collectPromptFolderSubtreeIds,
  type PromptEntryKind,
  type PromptFolder,
  type PromptFolderLibrary,
} from './promptLibrary'

/** 放置层级：空串表示根层级（收藏夹树的最外层）。 */
export type PromptPlacementLayerId = string

/** 被拖动的对象：一条提示词，或一个收藏夹。 */
export type PromptPlacementPayload = { kind: PromptEntryKind; id: string }

/**
 * 放置动作：直接对应客户端原子动作。
 * 收藏夹移动到同一父级是无效操作，因此这里不出现 add / remove 组合。
 */
export type PromptPlacementMove = {
  actionName: 'movePromptToFolder' | 'movePromptFolder'
  id: string
  fromFolderId: string
  toFolderId: string
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function promptFolderById(library: PromptFolderLibrary, folderId: string): PromptFolder | undefined {
  const id = text(folderId)
  if (!id) return undefined
  return library.folders.find((folder) => folder.id === id)
}

/** 目标层是否已经收录了这条内容；根层级只认自己直接持有的部分。 */
function layerCollectsEntry(library: PromptFolderLibrary, layerId: string, payload: PromptPlacementPayload): boolean {
  const id = text(layerId)
  if (!id) {
    if (payload.kind === 'folder') return library.rootFolderIds.includes(payload.id)
    // 根层直属提示词＝没有被任何收藏夹收录。
    return library.folders.every((folder) => !folder.promptIds.includes(payload.id))
  }
  const folder = promptFolderById(library, id)
  if (!folder) return false
  return payload.kind === 'folder' ? folder.folderIds.includes(payload.id) : folder.promptIds.includes(payload.id)
}

/**
 * 能否把 payload 从 fromFolderId 放到 toFolderId。
 * 这是拖拽高亮与松手动作共用的唯一判定，两处不会出现分歧。
 */
export function canPlacePromptEntry(params: {
  library: PromptFolderLibrary
  payload: PromptPlacementPayload
  fromFolderId: string
  toFolderId: string
}): boolean {
  const { library, payload, fromFolderId, toFolderId } = params
  const id = text(payload.id)
  if (!id) return false
  const from = text(fromFolderId)
  const to = text(toFolderId)
  if (from === to) return false
  if (to && !promptFolderById(library, to)) return false

  if (payload.kind === 'folder') {
    if (id === to) return false
    // 收藏夹不能塞进自己的子树：子树内包含自己与全部后代。
    if (to && collectPromptFolderSubtreeIds(library, id).includes(to)) return false
    return !layerCollectsEntry(library, to, payload)
  }

  // 提示词：搬到根层级＝从当前收藏夹摘回；搬到收藏夹＝换归属。
  if (!to) return from !== '' && layerCollectsEntry(library, from, payload)
  return !layerCollectsEntry(library, to, payload)
}

/** 松手后应执行的原子动作；不可放置时返回 null。 */
export function planPromptPlacementMove(params: {
  library: PromptFolderLibrary
  payload: PromptPlacementPayload
  fromFolderId: string
  toFolderId: string
}): PromptPlacementMove | null {
  if (!canPlacePromptEntry(params)) return null
  return {
    actionName: params.payload.kind === 'folder' ? 'movePromptFolder' : 'movePromptToFolder',
    id: params.payload.id,
    fromFolderId: text(params.fromFolderId),
    toFolderId: text(params.toFolderId),
  }
}
