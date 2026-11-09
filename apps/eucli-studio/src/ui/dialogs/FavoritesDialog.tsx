import * as React from 'react'
import { DialogContent, DialogTitle, IconButton, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { DependableDialog } from '../components/DependableOverlay'
import { FavoriteFolderActions } from '../components/favorites/FavoriteFolderActions'
import { FavoriteFoldersPanel, type FavoriteFoldersPanelProps } from '../components/favorites/FavoriteFoldersPanel'

// 收藏夹独立模态窗：外壳（尺寸、标题栏、关闭按钮）留在这里，
// 工具动作与内容主体分别复用 FavoriteFolderActions / FavoriteFoldersPanel，与侧边栏同源。
export const FavoritesDialog = React.memo(function FavoritesDialog(
  props: FavoriteFoldersPanelProps & {
    open: boolean
    onClose: () => void
  },
) {
  const { open, onClose, ...panel } = props

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
        <FavoriteFolderActions {...panel} />
        <IconButton size="small" aria-label="关闭收藏夹" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, overflow: 'hidden', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FavoriteFoldersPanel {...panel} />
      </DialogContent>
    </DependableDialog>
  )
})
