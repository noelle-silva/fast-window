import type { BackgroundClient } from '../gateway/backgroundClient'
import type { FavoritesService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

export function createFavoritesService(background: BackgroundClient): FavoritesService {
  return {
    ensureFavorites: () => background.invoke(HyperCortexRpc.favorites.ensure, {}),
    tryLoadFavorites: () => background.invoke(HyperCortexRpc.favorites.tryLoad, {}),
    saveFavorites: doc => background.invoke(HyperCortexRpc.favorites.save, { doc }),
  }
}
