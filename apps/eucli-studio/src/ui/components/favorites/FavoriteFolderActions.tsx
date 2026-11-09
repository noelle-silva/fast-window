import * as React from 'react'
import { IconButton, Tooltip } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'
import type { FavoriteFoldersPanelProps } from './FavoriteFoldersPanel'

// 会话收藏夹的三个工具动作：搜索开关 / 折叠全部 / 新建文件夹。
// 弹窗把它们放进标题栏右侧，侧边栏把它们放在内容顶部右侧；动作语义只在这里写一份。
export type FavoriteFolderActionsProps = Pick<
  FavoriteFoldersPanelProps,
  | 'favoriteFolders'
  | 'collapseAllFavoriteFolders'
  | 'openCreateFavoriteFolder'
  | 'favoriteSearchOpen'
  | 'setFavoriteSearchOpen'
  | 'setFavoriteSearchText'
>

export function FavoriteFolderActions(props: FavoriteFolderActionsProps) {
  const {
    favoriteFolders,
    collapseAllFavoriteFolders,
    openCreateFavoriteFolder,
    favoriteSearchOpen,
    setFavoriteSearchOpen,
    setFavoriteSearchText,
  } = props

  return (
    <>
      <Tooltip title={favoriteSearchOpen ? '关闭搜索' : '搜索'}>
        <IconButton
          size="small"
          aria-label={favoriteSearchOpen ? '关闭搜索' : '搜索收藏夹'}
          onClick={() => {
            setFavoriteSearchOpen((prev) => !prev)
            if (favoriteSearchOpen) setFavoriteSearchText('')
          }}
        >
          {favoriteSearchOpen ? <CloseIcon fontSize="inherit" /> : <SearchIcon fontSize="inherit" />}
        </IconButton>
      </Tooltip>

      <Tooltip title="折叠全部">
        <span>
          <IconButton size="small" aria-label="折叠全部" onClick={collapseAllFavoriteFolders} disabled={!favoriteFolders.length}>
            <UnfoldLessIcon fontSize="inherit" />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="新建文件夹">
        <IconButton size="small" aria-label="新建文件夹" onClick={() => openCreateFavoriteFolder('')}>
          <AddIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
    </>
  )
}
