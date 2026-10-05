import * as React from 'react'
import { Box, Button, CircularProgress, IconButton, Tooltip } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ImageSearchRoundedIcon from '@mui/icons-material/ImageSearchRounded'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import type { AssetUploadTaskSnapshot } from '../gateway/types'
import { AssetUploadTaskPanel } from './AssetUploadTaskPanel'
import { type AssetUploadTaskView } from './assetUploadTasks'
import { softButtonSx } from './pluginUiStyles'
import { FEATURE_TONES, toneEmphasisButtonSx, toneFgVar, toneHoverActionSx, type HyperCortexToneId } from './uiTones'

export function AssetGlobalToolbar({
  activeUploadCount,
  unseenFailedUploadCount,
  uploadPanelOpen,
  uploadTasks,
  uploadTaskView,
  loading,
  rebuildingThumbnails,
  startingUpload,
  showVisibleThumbnailAction,
  thumbnailTargetsCount,
  hasAnyThumbnailTargets,
  activeCategoryTone,
  onToggleUploadPanel,
  onUploadTaskViewChange,
  onCloseUploadPanel,
  onPauseUploadTask,
  onResumeUploadTask,
  onCancelUploadTask,
  onRefresh,
  onRebuildVisibleThumbnails,
  onRebuildAllThumbnails,
  onStartUploadTask,
}: {
  activeUploadCount: number
  unseenFailedUploadCount: number
  uploadPanelOpen: boolean
  uploadTasks: AssetUploadTaskSnapshot[]
  uploadTaskView: AssetUploadTaskView
  loading: boolean
  rebuildingThumbnails: boolean
  startingUpload: boolean
  showVisibleThumbnailAction: boolean
  thumbnailTargetsCount: number
  hasAnyThumbnailTargets: boolean
  activeCategoryTone: HyperCortexToneId
  onToggleUploadPanel: () => void
  onUploadTaskViewChange: (view: AssetUploadTaskView) => void
  onCloseUploadPanel: () => void
  onPauseUploadTask: (taskId: string) => void
  onResumeUploadTask: (taskId: string) => void
  onCancelUploadTask: (taskId: string) => void
  onRefresh: () => void
  onRebuildVisibleThumbnails: () => void
  onRebuildAllThumbnails: () => void
  onStartUploadTask: () => void
}) {
  const uploadButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const uploadBadgeCount = unseenFailedUploadCount > 0 ? unseenFailedUploadCount : activeUploadCount
  const uploadButtonLabel = unseenFailedUploadCount > 0
    ? `上传任务，${unseenFailedUploadCount} 个失败任务未查看`
    : activeUploadCount > 0
      ? `上传任务，${activeUploadCount} 个任务上传中`
      : '上传任务'

  return (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <Tooltip title="上传任务" placement="bottom">
        <IconButton
          ref={uploadButtonRef}
          size="small"
          aria-label={uploadButtonLabel}
          onClick={onToggleUploadPanel}
          sx={{ color: uploadBadgeCount ? toneFgVar(FEATURE_TONES.assets) : 'var(--hc-text-muted)', ...toneHoverActionSx(FEATURE_TONES.assets) }}
        >
          <CloudUploadRoundedIcon fontSize="small" />
          {uploadBadgeCount ? (
            <Box sx={{ position: 'absolute', top: 2, right: 2, minWidth: 14, height: 14, px: 0.25, borderRadius: 999, bgcolor: unseenFailedUploadCount > 0 ? 'var(--hc-danger)' : 'var(--hc-primary)', color: 'var(--hc-surface)', fontSize: 9, fontWeight: 900, lineHeight: '14px', textAlign: 'center' }}>
              {uploadBadgeCount > 9 ? '9+' : uploadBadgeCount}
            </Box>
          ) : null}
        </IconButton>
      </Tooltip>
      <AssetUploadTaskPanel
        anchorEl={uploadButtonRef.current}
        open={uploadPanelOpen}
        tasks={uploadTasks}
        view={uploadTaskView}
        unseenFailedTaskCount={unseenFailedUploadCount}
        onViewChange={onUploadTaskViewChange}
        onClose={onCloseUploadPanel}
        onPause={onPauseUploadTask}
        onResume={onResumeUploadTask}
        onCancel={onCancelUploadTask}
      />
      <Tooltip title="刷新" placement="bottom">
        <IconButton
          size="small"
          aria-label="刷新"
          onClick={onRefresh}
          disabled={loading}
          sx={{ color: 'var(--hc-text-muted)', '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' } }}
        >
          <RefreshRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {showVisibleThumbnailAction ? (
        <Tooltip title="重建当前分类缩略图缓存" placement="bottom">
          <span>
            <IconButton
              size="small"
              aria-label="重建当前分类缩略图缓存"
              onClick={onRebuildVisibleThumbnails}
              disabled={rebuildingThumbnails || thumbnailTargetsCount === 0}
              sx={{ color: 'var(--hc-text-muted)', ...toneHoverActionSx(activeCategoryTone) }}
            >
              {rebuildingThumbnails ? <CircularProgress size={18} /> : <ImageSearchRoundedIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      ) : null}

      <Tooltip title="重建全部支持类型缩略图缓存" placement="bottom">
        <span>
          <Button
            variant="text"
            size="small"
            startIcon={rebuildingThumbnails ? <CircularProgress size={14} /> : <ImageSearchRoundedIcon sx={{ fontSize: 16 }} />}
            disabled={rebuildingThumbnails || !hasAnyThumbnailTargets}
            onClick={onRebuildAllThumbnails}
            sx={{ minWidth: 0, px: 1, borderRadius: 2, textTransform: 'none', color: 'var(--hc-text-muted)', fontWeight: 800, ...toneHoverActionSx(FEATURE_TONES.assets) }}
          >
            全部重建
          </Button>
        </span>
      </Tooltip>

      <Button
        variant="text"
        size="small"
        startIcon={startingUpload ? <CircularProgress size={16} /> : <AddRoundedIcon />}
        disabled={startingUpload}
        onClick={onStartUploadTask}
        sx={{
          ...softButtonSx,
          borderRadius: 2,
          ...toneEmphasisButtonSx(FEATURE_TONES.assets),
        }}
      >
        {startingUpload ? '启动中...' : '添加文件'}
      </Button>
    </Box>
  )
}
