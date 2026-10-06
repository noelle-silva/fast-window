import type { BackgroundClient } from '../gateway/backgroundClient'
import type { FavoritesService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

// 收藏夹服务出口：装载 + 语义写操作。界面只表达意图（建夹/改夹/放入/移出/挪夹/排序/布局/删除），
// 后端在同一把串行锁下读改写，不同来源的并发写天然不互相覆盖；不引入版本保险丝。
export function createFavoritesService(background: BackgroundClient): FavoritesService {
  return {
    ensureFavorites: scope => background.invoke(HyperCortexRpc.favorites.ensure, { scope }),
    tryLoadFavorites: scope => background.invoke(HyperCortexRpc.favorites.tryLoad, { scope }),
    createFolder: (scope, parentId, title, description, id) =>
      background.invoke(HyperCortexRpc.favorites.createFolder, { scope, parentId, title, description, id: id ?? '' }),
    updateFolder: (scope, folderId, patch) => background.invoke(HyperCortexRpc.favorites.updateFolder, { scope, folderId, patch }),
    addItem: (scope, folderId, kind, targetId) => background.invoke(HyperCortexRpc.favorites.addItem, { scope, folderId, kind, targetId }),
    removeItem: (scope, folderId, kind, targetId) => background.invoke(HyperCortexRpc.favorites.removeItem, { scope, folderId, kind, targetId }),
    moveItem: (scope, fromFolderId, toFolderId, kind, targetId) =>
      background.invoke(HyperCortexRpc.favorites.moveItem, { scope, fromFolderId, toFolderId, kind, targetId }),
    reorderItems: (scope, folderId, orderedRefs) => background.invoke(HyperCortexRpc.favorites.reorderItems, { scope, folderId, orderedRefs }),
    updateItemLayout: (scope, folderId, kind, targetId, layout) =>
      background.invoke(HyperCortexRpc.favorites.updateItemLayout, { scope, folderId, kind, targetId, layout }),
    deleteFolder: (scope, folderId) => background.invoke(HyperCortexRpc.favorites.deleteFolder, { scope, folderId }),
  }
}
