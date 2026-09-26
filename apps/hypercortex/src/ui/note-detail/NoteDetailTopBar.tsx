import * as React from 'react'
import { Box, IconButton, Menu, MenuItem, Tooltip } from '@mui/material'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import WysiwygRoundedIcon from '@mui/icons-material/WysiwygRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PlaylistAddCheckRoundedIcon from '@mui/icons-material/PlaylistAddCheckRounded'

import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import { resolveFaceLabel, type FaceDeclaration, type FaceToolbarProps, type FaceViewContext } from '../../facePlugins'
import { menuDangerItemSx, menuPaperSx } from '../pluginUiStyles'
import { useWorkspaceVisible } from '../workspaceVisibility'

/**
 * 笔记详情顶栏：左侧通用动作、右侧菜单与面标签条。
 * 纯展示组件：状态与动作全部由会话注入，顶栏自身不持有业务状态。
 */
export type NoteDetailTopBarProps = {
  loading: boolean
  loadError: string | null
  loaded: boolean
  editing: boolean
  saving: boolean
  dirty: boolean
  isDraft: boolean
  /** 打包目录可用（已保存的正式笔记）。 */
  packageAvailable: boolean
  faceEditing: boolean
  onToggleMode: () => void
  onSave: () => void
  onSaveAllFaces: () => void
  onDiscard: () => void
  FaceToolbarLeft: React.ComponentType<FaceToolbarProps> | null
  FaceToolbarRight: React.ComponentType<FaceToolbarProps> | null
  faceViewState: Record<string, unknown>
  onFaceViewStateChange: (patch: Record<string, unknown>) => void
  faceViewContext: FaceViewContext
  moreMenuOpen: boolean
  moreMenuAnchorEl: HTMLElement | null
  onMoreMenuOpen: (anchor: HTMLElement) => void
  onMoreMenuClose: () => void
  onOpenNoteDir: () => void
  onOpenVersionHistory: () => void
  onOpenNoteSettings: () => void
  canFavorite: boolean
  onOpenFavorites: () => void
  onRequestDeleteNote: () => void
  deletableFaceIds: string[]
  deleteFaceMenuOpen: boolean
  deleteFaceMenuAnchorEl: HTMLElement | null
  onDeleteFaceMenuOpen: (anchor: HTMLElement) => void
  onDeleteFaceMenuClose: () => void
  onRequestDeleteFace: (faceId: string) => void
  onCopyNoteRef: () => void
  infoSidebarVisible: boolean
  onToggleInfoSidebar: () => void
  addFaceSelectorVisible: boolean
  onToggleAddFaceSelector: () => void
  creatableFaceDeclarations: readonly FaceDeclaration[]
  pendingAddFace: string | null
  onPickAddFace: (kind: string) => void
  onConfirmAddFace: () => void
  face: string
  faces: string[]
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  onSelectFace: (faceId: string) => void
  onCopyFaceRef: (faceId: string) => void
}

export function NoteDetailTopBar(props: NoteDetailTopBarProps): React.ReactNode {
  const {
    loading,
    loadError,
    loaded,
    editing,
    saving,
    dirty,
    isDraft,
    packageAvailable,
    faceEditing,
    onToggleMode,
    onSave,
    onSaveAllFaces,
    onDiscard,
    FaceToolbarLeft,
    FaceToolbarRight,
    faceViewState,
    onFaceViewStateChange,
    faceViewContext,
    moreMenuOpen,
    moreMenuAnchorEl,
    onMoreMenuOpen,
    onMoreMenuClose,
    onOpenNoteDir,
    onOpenVersionHistory,
    onOpenNoteSettings,
    canFavorite,
    onOpenFavorites,
    onRequestDeleteNote,
    deletableFaceIds,
    deleteFaceMenuOpen,
    deleteFaceMenuAnchorEl,
    onDeleteFaceMenuOpen,
    onDeleteFaceMenuClose,
    onRequestDeleteFace,
    onCopyNoteRef,
    infoSidebarVisible,
    onToggleInfoSidebar,
    addFaceSelectorVisible,
    onToggleAddFaceSelector,
    creatableFaceDeclarations,
    pendingAddFace,
    onPickAddFace,
    onConfirmAddFace,
    face,
    faces,
    faceManifests,
    onSelectFace,
    onCopyFaceRef,
  } = props

  const workspaceVisible = useWorkspaceVisible()
  const toolbarReady = !loading && !loadError && loaded

  return (
    <Box sx={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderRadius: 999, px: 0.5 }}>
        {toolbarReady ? (
          <Tooltip title={editing ? '切到阅读模式' : '切到编辑模式'} placement="bottom-start">
            <IconButton
              size="small"
              aria-label={editing ? '切换到阅读模式' : '切换到编辑模式'}
              onClick={onToggleMode}
              disabled={saving}
              sx={{
                color: 'rgba(0,0,0,.58)',
                bgcolor: 'transparent',
                boxShadow: 'none',
                border: 0,
                flex: '0 0 auto',
                '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
              }}
            >
              {editing ? <WysiwygRoundedIcon fontSize="small" /> : <EditRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : null}

        {toolbarReady ? (
          <Tooltip title="保存" placement="bottom-start">
            <IconButton
              size="small"
              aria-label="保存笔记"
              onClick={() => void onSave()}
              disabled={saving || (!dirty && !isDraft)}
              sx={{
                color: 'rgba(0,0,0,.58)',
                bgcolor: 'transparent',
                boxShadow: 'none',
                border: 0,
                flex: '0 0 auto',
                '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
              }}
            >
              <SaveRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}

        {toolbarReady ? (
          <Tooltip title="保存整个笔记所有面" placement="bottom-start">
            <IconButton
              size="small"
              aria-label="保存整个笔记所有面"
              onClick={() => void onSaveAllFaces()}
              disabled={saving || (!dirty && !isDraft)}
              sx={{
                color: 'rgba(0,0,0,.58)',
                bgcolor: 'transparent',
                boxShadow: 'none',
                border: 0,
                flex: '0 0 auto',
                '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
              }}
            >
              <PlaylistAddCheckRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}

        {toolbarReady && dirty ? (
          <Tooltip title="放弃改动（回到已保存状态）" placement="bottom-start">
            <IconButton
              size="small"
              aria-label="放弃未保存改动"
              onClick={onDiscard}
              disabled={saving}
              sx={{
                color: 'rgba(0,0,0,.58)',
                bgcolor: 'transparent',
                boxShadow: 'none',
                border: 0,
                flex: '0 0 auto',
                '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
              }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}

        {toolbarReady && FaceToolbarLeft ? (
          <FaceToolbarLeft editing={faceEditing} disabled={saving} viewState={faceViewState} onViewStateChange={onFaceViewStateChange} context={faceViewContext} />
        ) : null}

        {dirty ? (
          <Tooltip title="有未保存改动" placement="bottom-start">
            <Box
              aria-label="有未保存改动"
              sx={{
                ml: 0.25,
                width: 8,
                height: 8,
                borderRadius: 999,
                bgcolor: '#f59e0b',
                boxShadow: '0 0 0 2px #fff',
                flex: '0 0 auto',
              }}
            />
          </Tooltip>
        ) : null}
      </Box>

      {toolbarReady ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', borderRadius: 999, px: 0.5 }}>
          {FaceToolbarRight ? (
            <FaceToolbarRight editing={faceEditing} disabled={saving} viewState={faceViewState} onViewStateChange={onFaceViewStateChange} context={faceViewContext} />
          ) : null}

          <Tooltip title="版本历史" placement="bottom-end">
            <IconButton
              size="small"
              aria-label="版本历史"
              onClick={onOpenVersionHistory}
              disabled={!packageAvailable}
              sx={{
                color: 'rgba(0,0,0,.58)',
                bgcolor: 'transparent',
                '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
                '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
              }}
            >
              <HistoryRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

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

          <Tooltip title="复制引用占位符" placement="bottom-end">
            <IconButton
              size="small"
              aria-label="复制引用占位符"
              onClick={onCopyNoteRef}
              sx={{
                color: 'rgba(0,0,0,.58)',
                bgcolor: 'transparent',
                '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
              }}
            >
              <ContentCopyRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={infoSidebarVisible ? '隐藏信息侧栏' : '显示信息侧栏'} placement="bottom-end">
            <IconButton
              size="small"
              aria-label="笔记信息"
              onClick={onToggleInfoSidebar}
              sx={{
                color: infoSidebarVisible ? '#111' : 'rgba(0,0,0,.58)',
                bgcolor: infoSidebarVisible ? 'rgba(0,0,0,.06)' : 'transparent',
                '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
              }}
            >
              <InfoRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="新增面" placement="bottom-end">
            <IconButton
              size="small"
              aria-label="新增面"
              onClick={onToggleAddFaceSelector}
              sx={{
                color: 'rgba(0,0,0,.58)',
                bgcolor: 'transparent',
                '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
              }}
            >
              <AddRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {addFaceSelectorVisible ? (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                p: 0.5,
                borderRadius: 999,
                bgcolor: 'rgba(0,0,0,.05)',
                gap: 0.5,
              }}
            >
              {creatableFaceDeclarations
                .filter(declaration => !faces.some(f => faceManifests[f]?.kind === declaration.kind))
                .map(declaration => (
                  <Box
                    key={declaration.kind}
                    role="button"
                    tabIndex={0}
                    onClick={() => onPickAddFace(declaration.kind)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onPickAddFace(declaration.kind)
                      }
                    }}
                    sx={{
                      minWidth: 56,
                      px: 1.5,
                      py: 0.75,
                      borderRadius: 999,
                      bgcolor: pendingAddFace === declaration.kind ? '#111' : 'transparent',
                      color: pendingAddFace === declaration.kind ? '#fff' : '#374151',
                      fontSize: 12,
                      lineHeight: 1,
                      fontWeight: 700,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    {declaration.label}
                  </Box>
                ))}
              <Box
                role="button"
                tabIndex={0}
                onClick={onConfirmAddFace}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onConfirmAddFace()
                  }
                }}
                sx={{
                  minWidth: 56,
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 999,
                  bgcolor: '#fff',
                  color: pendingAddFace ? '#111' : 'rgba(0,0,0,.32)',
                  fontSize: 12,
                  lineHeight: 1,
                  fontWeight: 700,
                  cursor: pendingAddFace ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
              >
                添加
              </Box>
            </Box>
          ) : null}

          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              p: 0.5,
              borderRadius: 999,
              bgcolor: 'rgba(0,0,0,.05)',
              gap: 0.5,
            }}
          >
            {faces.map(f => (
              <Box key={f} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectFace(f)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectFace(f)
                    }
                  }}
                  sx={{
                    minWidth: 56,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: 999,
                    bgcolor: face === f ? '#111' : 'transparent',
                    color: face === f ? '#fff' : '#374151',
                    fontSize: 12,
                    lineHeight: 1,
                    fontWeight: 700,
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {resolveFaceLabel(f, faceManifests)}
                </Box>
                <Tooltip title="复制此面引用" placement="bottom-end">
                  <IconButton
                    size="small"
                    aria-label={`复制 ${resolveFaceLabel(f, faceManifests)} 面引用`}
                    onClick={() => onCopyFaceRef(f)}
                    sx={{
                      color: 'rgba(0,0,0,.48)',
                      p: 0.4,
                      '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                    }}
                  >
                    <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
