import * as React from 'react'
import {
  Box,
  Collapse,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'
import { DependableDialog } from '../components/DependableOverlay'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'

// 收藏夹独立模态窗：面板结构沿用原「聊天记录 → 收藏夹」那一屏，
// 只把外壳从浮层换成弹窗；文件夹树仍由 useFavoriteFolders 的渲染入口提供。
export const FavoritesDialog = React.memo(function FavoritesDialog(props: {
  open: boolean
  onClose: () => void
  favoriteFolders: any[]
  renderFavoriteFolderTree: (parentId?: string, depth?: number) => React.ReactNode
  collapseAllFavoriteFolders: () => void
  openCreateFavoriteFolder: (parentId?: string) => void
  favoriteSearchOpen: boolean
  setFavoriteSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  favoriteSearchText: string
  setFavoriteSearchText: React.Dispatch<React.SetStateAction<string>>
  favoriteSearchInputRef: React.MutableRefObject<HTMLInputElement | null>
}) {
  const {
    open,
    onClose,
    favoriteFolders,
    renderFavoriteFolderTree,
    collapseAllFavoriteFolders,
    openCreateFavoriteFolder,
    favoriteSearchOpen,
    setFavoriteSearchOpen,
    favoriteSearchText,
    setFavoriteSearchText,
    favoriteSearchInputRef,
  } = props

  return (
    <DependableDialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      sx={{
        // 宽度按原来的两倍、高度按原来的 2.5 倍固定下来；小窗口时按视口收。
        '& .MuiDialog-paper': {
          width: 'min(1200px, calc(100vw - 48px))',
          height: 'min(620px, calc(100vh - 48px))',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pr: 1, flexShrink: 0 }}>
        <Typography sx={{ fontWeight: 900, flex: 1, minWidth: 0 }}>收藏夹</Typography>
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
        <IconButton size="small" aria-label="关闭收藏夹" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

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

      <DialogContent sx={{ p: 0, overflow: 'hidden', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {!favoriteFolders.length ? (
          <Box sx={{ p: 2.5 }}>
            <Typography variant="body2" color="text.secondary">
              还没有收藏夹，点击右上角加号新建。
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
      </DialogContent>
    </DependableDialog>
  )
})
