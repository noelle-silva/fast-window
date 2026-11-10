import * as React from 'react'
import { Box, Collapse, InputAdornment, List, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { CustomScrollArea } from '../CustomScrollArea'
import { SOFT_POPOVER_LIST_SX } from '../../softPopoverStyles'

// 会话收藏夹的内容主体：搜索框 + 收藏夹树。
// 弹窗与侧边栏共用这一份，外壳（标题栏、关闭按钮、位置）由各自的调用方决定。
export type FavoriteFoldersPanelProps = {
  favoriteFolders: any[]
  renderFavoriteFolderTree: (parentId?: string, depth?: number) => React.ReactNode
  collapseAllFavoriteFolders: () => void
  openCreateFavoriteFolder: (parentId?: string) => void
  favoriteSearchOpen: boolean
  setFavoriteSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  favoriteSearchText: string
  setFavoriteSearchText: React.Dispatch<React.SetStateAction<string>>
  favoriteSearchInputRef: React.MutableRefObject<HTMLInputElement | null>
}

export function FavoriteFoldersPanel(props: FavoriteFoldersPanelProps) {
  const {
    favoriteFolders,
    renderFavoriteFolderTree,
    favoriteSearchOpen,
    setFavoriteSearchOpen,
    favoriteSearchText,
    setFavoriteSearchText,
    favoriteSearchInputRef,
  } = props

  return (
    <>
      <Collapse in={favoriteSearchOpen}>
        <Box sx={{ px: 2, pb: 1 }}>
          <TextField
            inputRef={favoriteSearchInputRef}
            fullWidth
            size="small"
            placeholder="搜索收藏夹…"
            value={String(favoriteSearchText || '')}
            onChange={(event) => setFavoriteSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setFavoriteSearchOpen(false)
                setFavoriteSearchText('')
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        </Box>
      </Collapse>

      {!favoriteFolders.length ? (
        <Box sx={{ p: 2.5 }}>
          <Typography variant="body2" color="text.secondary">
            还没有收藏夹，点击加号新建。
          </Typography>
        </Box>
      ) : (
        <CustomScrollArea
          hostSx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}
          scrollSx={{ flex: '1 1 auto', minHeight: 0 }}
        >
          <List dense sx={SOFT_POPOVER_LIST_SX}>
            {renderFavoriteFolderTree('', 0)}
          </List>
        </CustomScrollArea>
      )}
    </>
  )
}
