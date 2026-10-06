import * as React from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import WysiwygRoundedIcon from '@mui/icons-material/WysiwygRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PlaylistAddCheckRoundedIcon from '@mui/icons-material/PlaylistAddCheckRounded'

import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import type { FaceDeclaration, FaceToolbarProps, FaceViewContext } from '../../facePlugins'
import { NoteDetailTopBarAddFaceSelector } from './NoteDetailTopBarAddFaceSelector'
import { NoteDetailTopBarFaceSwitcher } from './NoteDetailTopBarFaceSwitcher'
import { NoteDetailTopBarFileMenu } from './NoteDetailTopBarFileMenu'

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
  /** 本地未保存改动与外部改动冲突：黄点旁再亮一个绿点，绿点本身是按钮。 */
  conflict: boolean
  onOpenConflict: () => void
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
    conflict,
    onOpenConflict,
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

        {dirty && conflict ? (
          <Tooltip title="有外部改动与未保存改动冲突，点击查看" placement="bottom-start">
            <Box
              component="button"
              type="button"
              aria-label="外部改动冲突"
              onClick={onOpenConflict}
              sx={{
                ml: 0.25,
                width: 8,
                height: 8,
                borderRadius: 999,
                bgcolor: '#22c55e',
                boxShadow: '0 0 0 2px #fff',
                border: 0,
                p: 0,
                cursor: 'pointer',
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

          <NoteDetailTopBarFileMenu
            packageAvailable={packageAvailable}
            isDraft={isDraft}
            saving={saving}
            canFavorite={canFavorite}
            deletableFaceIds={deletableFaceIds}
            faceManifests={faceManifests}
            moreMenuOpen={moreMenuOpen}
            moreMenuAnchorEl={moreMenuAnchorEl}
            onMoreMenuOpen={onMoreMenuOpen}
            onMoreMenuClose={onMoreMenuClose}
            onOpenNoteDir={onOpenNoteDir}
            onOpenVersionHistory={onOpenVersionHistory}
            onOpenNoteSettings={onOpenNoteSettings}
            onOpenFavorites={onOpenFavorites}
            onRequestDeleteNote={onRequestDeleteNote}
            deleteFaceMenuOpen={deleteFaceMenuOpen}
            deleteFaceMenuAnchorEl={deleteFaceMenuAnchorEl}
            onDeleteFaceMenuOpen={onDeleteFaceMenuOpen}
            onDeleteFaceMenuClose={onDeleteFaceMenuClose}
            onRequestDeleteFace={onRequestDeleteFace}
          />

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

          <NoteDetailTopBarAddFaceSelector
            addFaceSelectorVisible={addFaceSelectorVisible}
            onToggleAddFaceSelector={onToggleAddFaceSelector}
            creatableFaceDeclarations={creatableFaceDeclarations}
            pendingAddFace={pendingAddFace}
            onPickAddFace={onPickAddFace}
            onConfirmAddFace={onConfirmAddFace}
            faces={faces}
            faceManifests={faceManifests}
          />

          <NoteDetailTopBarFaceSwitcher
            face={face}
            faces={faces}
            faceManifests={faceManifests}
            onSelectFace={onSelectFace}
            onCopyFaceRef={onCopyFaceRef}
          />
        </Box>
      ) : null}
    </Box>
  )
}
