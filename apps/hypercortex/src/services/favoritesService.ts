import type { BackgroundClient } from '../gateway/backgroundClient'
import type { FavoritesService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createFavoritesService(background: BackgroundClient): FavoritesService {
  return {
    ensureFavorites: scope => background.invoke(HyperCortexRpc.favorites.ensure, { scope }),
    tryLoadFavorites: scope => background.invoke(HyperCortexRpc.favorites.tryLoad, { scope }),
    saveFavorites: (scope, doc) => background.invoke(HyperCortexRpc.favorites.save, { scope, doc }),
  }
}
