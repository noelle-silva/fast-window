import * as React from 'react'
import {
  createFavoriteFolderNav,
  goBackFavoriteFolder,
  navigateFavoriteFolder,
  reconcileFavoriteFolderNav,
  type FavoriteFolderNav,
} from '../../domain/favoriteFolderNavigator'
import { useEvent } from './useEvent'

// 会话收藏夹的层级导航现场：当前层 + 来路。
// 纯逻辑在 domain/favoriteFolderNavigator，这里只负责把状态和 React 生命周期接上，
// 并在收藏夹增删后把失效的层收回来。
export function useFavoriteFolderNavigation(input: { folders: any[] }) {
  const { folders } = input
  const [nav, setNav] = React.useState<FavoriteFolderNav>(createFavoriteFolderNav)

  const existingIds = React.useMemo(
    () => new Set<string>(folders.map((folder: any) => String(folder?.id || '').trim()).filter(Boolean)),
    [folders],
  )

  const reconciled = React.useMemo(() => reconcileFavoriteFolderNav(nav, existingIds), [nav, existingIds])

  React.useEffect(() => {
    if (reconciled !== nav) setNav(reconciled)
  }, [reconciled, nav])

  const navigate = useEvent((folderId: string) => {
    setNav((prev) => navigateFavoriteFolder(reconcileFavoriteFolderNav(prev, existingIds), folderId))
  })

  const back = useEvent(() => setNav((prev) => goBackFavoriteFolder(prev)))

  const currentFolderId = reconciled.currentFolderId

  return {
    currentFolderId,
    canGoBack: reconciled.back.length > 0,
    navigate,
    back,
  }
}
