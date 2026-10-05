import * as React from 'react'
import { IconButton, Menu, MenuItem, Tooltip } from '@mui/material'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'

import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import { resolveFaceLabel } from '../../facePlugins'
import { menuDangerItemSx, menuPaperSx } from '../pluginUiStyles'
import { useWorkspaceVisible } from '../workspaceVisibility'

/**
 * 笔记详情顶栏的文件菜单：更多操作入口、主菜单与删除面子菜单。
 * 纯展示组件：菜单状态与动作全部由顶栏注入。
 */
export type NoteDetailTopBarFileMenuProps = {
  packageAvailable: boolean
  isDraft: boolean
  saving: boolean
  canFavorite: boolean
  deletableFaceIds: string[]
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  moreMenuOpen: boolean
  moreMenuAnchorEl: HTMLElement | null
  onMoreMenuOpen: (anchor: HTMLElement) => void
  onMoreMenuClose: () => void
  onOpenNoteDir: () => void
  onOpenVersionHistory: () => void
  onOpenNoteSettings: () => void
  onOpenFavorites: () => void
  onRequestDeleteNote: () => void
  deleteFaceMenuOpen: boolean
  deleteFaceMenuAnchorEl: HTMLElement | null
  onDeleteFaceMenuOpen: (anchor: HTMLElement) => void
  onDeleteFaceMenuClose: () => void
  onRequestDeleteFace: (faceId: string) => void
}

export function NoteDetailTopBarFileMenu(props: NoteDetailTopBarFileMenuProps): React.ReactNode {
  const {
    packageAvailable,
    isDraft,
    saving,
    canFavorite,
    deletableFaceIds,
    faceManifests,
    moreMenuOpen,
    moreMenuAnchorEl,
    onMoreMenuOpen,
    onMoreMenuClose,
    onOpenNoteDir,
    onOpenVersionHistory,
    onOpenNoteSettings,
    onOpenFavorites,
    onRequestDeleteNote,
    deleteFaceMenuOpen,
    deleteFaceMenuAnchorEl,
    onDeleteFaceMenuOpen,
    onDeleteFaceMenuClose,
    onRequestDeleteFace,
  } = props

  const workspaceVisible = useWorkspaceVisible()

  return (
    <>
      <Tooltip title="更多操作" placement="bottom-end">
        <IconButton
          size="small"
          aria-label="更多操作"
          onClick={e => onMoreMenuOpen(e.currentTarget)}
          sx={{
            color: 'rgba(0,0,0,.58)',
            bgcolor: 'transparent',
              '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
          }}
        >
          <MoreHorizRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Menu
        open={workspaceVisible && moreMenuOpen}
        onClose={onMoreMenuClose}
        anchorEl={moreMenuAnchorEl}
        PaperProps={{ sx: menuPaperSx }}
      >
        <MenuItem
          onClick={() => void onOpenNoteDir()}
          disabled={!packageAvailable}
        >
          打开当前笔记文件夹
        </MenuItem>
        <MenuItem
          onClick={onOpenVersionHistory}
          disabled={!packageAvailable}
        >
          版本历史…
        </MenuItem>
        <MenuItem
          onClick={() => {
            onMoreMenuClose()
            onOpenNoteSettings()
          }}
          disabled={!packageAvailable}
        >
          笔记设置…
        </MenuItem>
        <MenuItem onClick={onOpenFavorites} disabled={isDraft || !canFavorite}>
          收藏到…
        </MenuItem>
        <MenuItem
          onClick={() => onRequestDeleteNote()}
          disabled={saving}
          sx={menuDangerItemSx}
        >
          删除当前整个笔记…
        </MenuItem>
        {deletableFaceIds.length > 0 ? (
          <>
            <MenuItem
              onClick={e => onDeleteFaceMenuOpen(e.currentTarget as HTMLElement)}
              disabled={saving}
              sx={{ mt: 0.5, bgcolor: 'var(--hc-danger-soft)', color: 'var(--hc-danger)', '&:hover': { bgcolor: 'var(--hc-accent-clay)' } }}
            >
              删除当前笔记的其中面…
            </MenuItem>
          </>
        ) : null}
      </Menu>

      <Menu
        open={workspaceVisible && deleteFaceMenuOpen}
        onClose={onDeleteFaceMenuClose}
        anchorEl={deleteFaceMenuAnchorEl}
        PaperProps={{ sx: menuPaperSx }}
      >
        {deletableFaceIds.map(faceId => (
          <MenuItem key={faceId} onClick={() => onRequestDeleteFace(faceId)} sx={{ color: 'var(--hc-danger)' }}>
            {resolveFaceLabel(faceId, faceManifests)}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
