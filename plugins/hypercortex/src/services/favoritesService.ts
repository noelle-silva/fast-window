import type { Api } from '../core'
import { ensureFavorites, saveFavorites, tryLoadFavorites } from '../favorites'
import type { FavoritesService } from '../gateway/types'

export function createFavoritesService(api: Api): FavoritesService {
  return {
    ensureFavorites: () => ensureFavorites(api),
    tryLoadFavorites: () => tryLoadFavorites(api),
    saveFavorites: doc => saveFavorites(api, doc),
  }
}
