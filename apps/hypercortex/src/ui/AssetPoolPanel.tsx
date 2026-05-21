import * as React from 'react'
import { Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ImageSearchRoundedIcon from '@mui/icons-material/ImageSearchRounded'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import { type VaultScope } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import { buildAssetMarker } from '../assetMarker'
import type { AssetEntry } from '../assetTypes'
import { buildAssetEntries } from '../assetEntryModel'
import { getAssetPreviewDescriptor, isAssetOpenableInTab } from './assetPreview/registry'
import type { HyperCortexGateway } from '../gateway'
import type { AssetUploadTaskSnapshot } from '../gateway/types'
import { startPickedLocalAssetUploadTask } from '../services/localAssetUpload'
import { AssetUploadTaskPanel } from './AssetUploadTaskPanel'
import { type AssetUploadTaskView, isActiveUploadTask } from './assetUploadTasks'
import { useAssetUploadTasks } from './useAssetUploadTasks'
import { softButtonSx } from './pluginUiStyles'
import { assetToneFromKind, FEATURE_TONES, toneChipSx, toneEmphasisButtonSx, toneFgVar, toneHoverActionSx, toneTabSx, type HyperCortexToneId } from './uiTones'

/* ------------------------------------------------------------------ */
/*  类型                                                               */
/* ------------------------------------------------------------------ */

type AssetCategory = 'image' | 'video' | 'document'
type AssetInteractionMode = 'browse' | 'select'

type Props = {
  gateway: HyperCortexGateway
  scope: VaultScope
  onOpenAsset?: (asset: AssetEntry) => void
}

/* ------------------------------------------------------------------ */
/*  工具函数                                                           */
/* ------------------------------------------------------------------ */

function categoryFromKind(kind: string): AssetCategory {
  if (kind === 'image') return 'image'
  if (kind === 'video') return 'video'
  return 'document'
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function assetSelectionKey(asset: Pick<AssetEntry, 'assetId' | 'ext'>): string {
  return asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
}

/* ------------------------------------------------------------------ */
/*  组件                                                               */
/* ------------------------------------------------------------------ */

function canHaveThumbnail(asset: Pick<AssetEntry, 'kind'>): boolean {
  return asset.kind === 'image' || asset.kind === 'video'
}

function AssetCard({
  gateway,
  asset,
  selectionMode,
  selected,
  onDelete,
  onToggleSelected,
  onRebuildThumbnail,
  onOpenAsset,
}: {
  gateway: HyperCortexGateway
  asset: AssetEntry
  selectionMode: boolean
  selected: boolean
  onDelete: (asset: AssetEntry) => void
  onToggleSelected: (asset: AssetEntry) => void
  onRebuildThumbnail: (asset: AssetEntry) => void
  onOpenAsset?: (asset: AssetEntry) => void
}) {
  const titleLabel = pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext })
  const preview = React.useMemo(() => getAssetPreviewDescriptor(asset), [asset])
  const tone = assetToneFromKind(asset.kind)
  const canOpenPreview = isAssetOpenableInTab(asset)
  const interactive = selectionMode || canOpenPreview
  const selectedInMode = selectionMode && selected
  const Icon = preview.icon
  const handleCopy = React.useCallback(() => {
    const marker = buildAssetMarker(asset)
    gateway.clipboard.writeText(marker).then(
      () => gateway.host.toast('已复制'),
      () => gateway.host.toast('复制失败'),
    )
  }, [gateway, asset])

  return (
    <Box
      role={selectionMode ? 'checkbox' : canOpenPreview ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={selectionMode ? `${selected ? '取消选择' : '选择'}附件：${titleLabel}` : canOpenPreview ? `打开附件：${titleLabel}` : undefined}
      aria-checked={selectionMode ? selected : undefined}
      onClick={() => {
        if (selectionMode) {
          onToggleSelected(asset)
          return
        }
        if (!canOpenPreview) return
        onOpenAsset?.(asset)
      }}
      onKeyDown={e => {
        if (!interactive) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (selectionMode) {
          onToggleSelected(asset)
          return
        }
        onOpenAsset?.(asset)
      }}
      sx={{
        position: 'relative',
        minHeight: 180,
        px: 1.5,
        py: 1.5,
        borderRadius: 3,
        bgcolor: selectedInMode ? 'var(--hc-primary-soft)' : 'var(--hc-surface)',
        boxShadow: selectedInMode ? '0 0 0 2px var(--hc-primary), 0 8px 18px rgba(0,0,0,.08)' : '0 1px 2px rgba(0,0,0,.04)',
        transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
        outline: 'none',
        '&:hover': {
          bgcolor: 'var(--hc-surface-soft)',
          boxShadow: '0 6px 16px rgba(0,0,0,.08)',
          transform: 'translateY(-1px)',
        },
        '&:focus-visible': interactive ? { boxShadow: selectedInMode ? '0 0 0 2px var(--hc-primary), 0 10px 24px var(--hc-shadow)' : '0 10px 24px var(--hc-shadow)' } : undefined,
        '&:hover .hc-asset-card-actions': selectionMode ? undefined : { opacity: 1 },
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      {selectionMode ? (
        <Checkbox
          checked={selected}
          aria-label={`选择附件：${titleLabel}`}
          tabIndex={-1}
          inputProps={{ 'aria-hidden': true, tabIndex: -1 }}
          sx={{
            position: 'absolute',
            top: 6,
            left: 6,
            zIndex: 2,
            pointerEvents: 'none',
            width: 30,
            height: 30,
            p: 0,
            borderRadius: 1.5,
            bgcolor: selected ? 'var(--hc-surface)' : 'rgba(255,255,255,.82)',
            color: selected ? 'var(--hc-primary)' : 'rgba(0,0,0,.38)',
            boxShadow: '0 1px 6px rgba(0,0,0,.10)',
            '&:hover': { bgcolor: 'var(--hc-surface)', color: 'var(--hc-primary)' },
            '& .MuiSvgIcon-root': { fontSize: 20 },
          }}
        />
      ) : null}

      {!selectionMode ? (
        <Box
          className="hc-asset-card-actions"
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            gap: 0.25,
            opacity: 0,
            transition: 'opacity .15s',
            zIndex: 2,
          }}
        >
          <Tooltip title="复制引用标记" placement="bottom">
            <IconButton
              size="small"
              aria-label="复制引用标记"
              onClick={e => {
                e.stopPropagation()
                handleCopy()
              }}
              sx={{
                width: 28,
                height: 28,
                bgcolor: 'rgba(0,0,0,.05)',
                color: 'rgba(0,0,0,.45)',
                '&:hover': { bgcolor: 'var(--hc-primary-soft)', color: 'var(--hc-primary)' },
              }}
            >
              <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>

          {canHaveThumbnail(asset) ? (
            <Tooltip title="重建缩略图" placement="bottom">
              <IconButton
                size="small"
                aria-label="重建缩略图"
                onClick={e => {
                  e.stopPropagation()
                  onRebuildThumbnail(asset)
                }}
                sx={{
                  width: 28,
                  height: 28,
                  bgcolor: 'rgba(0,0,0,.05)',
                  color: 'rgba(0,0,0,.45)',
                  '&:hover': { bgcolor: 'var(--hc-primary-soft)', color: 'var(--hc-primary)' },
                }}
              >
                <ImageSearchRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          ) : null}

          <Tooltip title="删除" placement="bottom">
            <IconButton
              size="small"
              aria-label="删除"
              onClick={e => {
                e.stopPropagation()
                onDelete(asset)
              }}
              sx={{
                width: 28,
                height: 28,
                bgcolor: 'rgba(0,0,0,.05)',
                color: 'rgba(0,0,0,.45)',
                '&:hover': { bgcolor: 'var(--hc-danger-soft)', color: 'var(--hc-danger)' },
              }}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}

      <Box
        sx={{
          height: 108,
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'rgba(0,0,0,.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {(asset.kind === 'image' || asset.kind === 'video') && asset.thumbnailUrl ? (
          <Box
            component="img"
            src={asset.thumbnailUrl}
            alt=""
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'var(--hc-surface)',
              color: preview.color,
            }}
          >
            <Icon fontSize="medium" />
          </Box>
        )}
      </Box>

      <Box sx={{ mt: 1, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--hc-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
          title={titleLabel}
        >
          {titleLabel}
        </Typography>
        <Typography sx={{ fontSize: 11, color: 'var(--hc-text-subtle)', flexShrink: 0 }}>
          {humanSize(asset.size)}
        </Typography>
      </Box>

      <Typography
        sx={{
          mt: 0.25,
          fontSize: 11,
          color: 'var(--hc-text-subtle)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'monospace',
        }}
        title={asset.assetId}
      >
        {asset.assetId.slice(0, 12)}…
      </Typography>
      {asset.remark ? (
        <Typography
          sx={{
            mt: 0.5,
            fontSize: 11,
            color: 'var(--hc-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={asset.remark}
        >
          {asset.remark}
        </Typography>
      ) : null}
      {asset.tags?.length ? (
        <Box sx={{ mt: 0.5, display: 'flex', gap: 0.35, flexWrap: 'wrap' }}>
          {asset.tags.slice(0, 3).map(tag => (
            <Box key={tag} sx={{ px: 0.65, py: 0.2, borderRadius: 999, ...toneChipSx(tone), fontSize: 10, fontWeight: 800 }}>
              {tag}
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

function AssetSelectionToolbar({
  selectedCount,
  selectedVisibleCount,
  hasVisibleAssets,
  allVisibleAssetsSelected,
  activeCategoryTone,
  onSelectVisible,
  onClearSelection,
  onCopySelectedMarkers,
  onDeleteSelected,
  onExitSelectionMode,
}: {
  selectedCount: number
  selectedVisibleCount: number
  hasVisibleAssets: boolean
  allVisibleAssetsSelected: boolean
  activeCategoryTone: HyperCortexToneId
  onSelectVisible: () => void
  onClearSelection: () => void
  onCopySelectedMarkers: () => void
  onDeleteSelected: () => void
  onExitSelectionMode: () => void
}) {
  const hasSelectedAssets = selectedCount > 0
  const selectionSummaryLabel = selectedVisibleCount ? `已选 ${selectedCount}，当前分类 ${selectedVisibleCount}` : `已选 ${selectedCount}`

  return (
    <>
      <Typography sx={{ fontSize: 12, fontWeight: 900, color: hasSelectedAssets ? 'var(--hc-text)' : 'var(--hc-text-subtle)', px: 0.5 }}>
        {selectionSummaryLabel}
      </Typography>
      <Button
        variant="text"
        size="small"
        onClick={onSelectVisible}
        disabled={!hasVisibleAssets || allVisibleAssetsSelected}
        sx={{ minWidth: 0, px: 1, borderRadius: 2, textTransform: 'none', color: 'var(--hc-text-muted)', fontWeight: 800, ...toneHoverActionSx(activeCategoryTone) }}
      >
        全选当前分类
      </Button>
      <Button
        variant="text"
        size="small"
        onClick={onClearSelection}
        disabled={!hasSelectedAssets}
        sx={{ minWidth: 0, px: 1, borderRadius: 2, textTransform: 'none', color: 'var(--hc-text-muted)', fontWeight: 800, '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' } }}
      >
        清空
      </Button>
      <Button
        variant="text"
        size="small"
        onClick={onExitSelectionMode}
        sx={{ minWidth: 0, px: 1, borderRadius: 2, textTransform: 'none', color: 'var(--hc-text-muted)', fontWeight: 800, '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' } }}
      >
        退出多选
      </Button>
      <Tooltip title="复制所选附件的引用标记（一行一个）" placement="bottom">
        <span>
          <IconButton
            size="small"
            aria-label="复制所选附件的引用标记"
            onClick={onCopySelectedMarkers}
            disabled={!hasSelectedAssets}
            sx={{ color: 'var(--hc-text-muted)', ...toneHoverActionSx(FEATURE_TONES.assets) }}
          >
            <ContentCopyRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="删除所选附件" placement="bottom">
        <span>
          <IconButton
            size="small"
            aria-label="删除所选附件"
            onClick={onDeleteSelected}
            disabled={!hasSelectedAssets}
            sx={{ color: 'var(--hc-text-muted)', '&:hover': { bgcolor: 'var(--hc-danger-soft)', color: 'var(--hc-danger)' } }}
          >
            <DeleteOutlineRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </>
  )
}

function AssetCategoryBar({
  category,
  counts,
  imageTone,
  videoTone,
  documentTone,
  actionSlot,
  onCategoryChange,
}: {
  category: AssetCategory
  counts: Record<AssetCategory, number>
  imageTone: HyperCortexToneId
  videoTone: HyperCortexToneId
  documentTone: HyperCortexToneId
  actionSlot?: React.ReactNode
  onCategoryChange: (category: AssetCategory) => void
}) {
  return (
    <Box
      sx={{
        minHeight: 36,
        display: 'flex',
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        flexDirection: { xs: 'column', sm: 'row' },
        gap: { xs: 0.5, sm: 1 },
        bgcolor: 'var(--hc-surface-soft)',
        borderRadius: 2,
        px: 0.5,
        py: { xs: 0.5, sm: 0 },
      }}
    >
      <Tabs
        value={category}
        onChange={(_, v) => onCategoryChange(v as AssetCategory)}
        aria-label="附件分类切换"
        sx={{
          minHeight: 36,
          flexShrink: 0,
          '& .MuiTabs-indicator': { height: 0 },
          '& .MuiTab-root': {
            minHeight: 36,
            textTransform: 'none',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--hc-text-muted)',
            borderRadius: 1.5,
            px: 2,
          },
          '& .MuiTab-root.Mui-selected': {
            bgcolor: 'var(--hc-surface)',
            color: 'var(--hc-text)',
            boxShadow: '0 1px 2px rgba(0,0,0,.06)',
          },
        }}
      >
        <Tab value="image" label={`图片 (${counts.image})`} sx={toneTabSx(imageTone)} />
        <Tab value="video" label={`视频 (${counts.video})`} sx={toneTabSx(videoTone)} />
        <Tab value="document" label={`文档 (${counts.document})`} sx={toneTabSx(documentTone)} />
      </Tabs>
      {actionSlot ? (
        <Box
          sx={{
            minHeight: 36,
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: { xs: 'flex-start', sm: 'flex-end' },
            gap: 0.75,
            flexWrap: 'wrap',
            px: { xs: 0.75, sm: 1 },
          }}
        >
          {actionSlot}
        </Box>
      ) : null}
    </Box>
  )
}

function AssetGlobalToolbar({
  activeUploadCount,
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

  return (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <Tooltip title="上传任务" placement="bottom">
        <IconButton
          ref={uploadButtonRef}
          size="small"
          aria-label="上传任务"
          onClick={onToggleUploadPanel}
          sx={{ color: activeUploadCount ? toneFgVar(FEATURE_TONES.assets) : 'var(--hc-text-muted)', ...toneHoverActionSx(FEATURE_TONES.assets) }}
        >
          <CloudUploadRoundedIcon fontSize="small" />
          {activeUploadCount ? (
            <Box sx={{ position: 'absolute', top: 2, right: 2, minWidth: 14, height: 14, px: 0.25, borderRadius: 999, bgcolor: 'var(--hc-danger)', color: 'var(--hc-surface)', fontSize: 9, fontWeight: 900, lineHeight: '14px', textAlign: 'center' }}>
              {activeUploadCount > 9 ? '9+' : activeUploadCount}
            </Box>
          ) : null}
        </IconButton>
      </Tooltip>
      <AssetUploadTaskPanel
        anchorEl={uploadButtonRef.current}
        open={uploadPanelOpen}
        tasks={uploadTasks}
        view={uploadTaskView}
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

      <Tooltip title="重建全部图片/视频缩略图缓存" placement="bottom">
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

export function AssetPoolPanel({ gateway, scope, onOpenAsset }: Props) {
  const [assets, setAssets] = React.useState<AssetEntry[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [startingUpload, setStartingUpload] = React.useState(false)
  const [rebuildingThumbnails, setRebuildingThumbnails] = React.useState(false)
  const [category, setCategory] = React.useState<AssetCategory>('image')
  const [thumbLoadTick, setThumbLoadTick] = React.useState(0)
  const [uploadPanelOpen, setUploadPanelOpen] = React.useState(false)
  const [uploadTaskView, setUploadTaskView] = React.useState<AssetUploadTaskView>('active')
  const [interactionMode, setInteractionMode] = React.useState<AssetInteractionMode>('browse')
  const [selectedAssetKeys, setSelectedAssetKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const [deleteTargets, setDeleteTargets] = React.useState<AssetEntry[]>([])
  const [deleting, setDeleting] = React.useState(false)
  const selectionMode = interactionMode === 'select'

  /* ---- 加载资源列表 ---- */
  const loadAssets = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await gateway.assets.listAssets(scope)
      const entries: AssetEntry[] = buildAssetEntries(items)
        .sort((a, b) => b.modifiedMs - a.modifiedMs)
      setAssets(entries)
      setThumbLoadTick(t => t + 1)
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'))
    } finally {
      setLoading(false)
    }
  }, [gateway, scope])

  React.useEffect(() => { void loadAssets() }, [loadAssets])

  const visibleAssets = React.useMemo(() => {
    return assets.filter(a => categoryFromKind(a.kind) === category)
  }, [assets, category])

  const selectedAssets = React.useMemo(() => {
    return assets.filter(asset => selectedAssetKeys.has(assetSelectionKey(asset)))
  }, [assets, selectedAssetKeys])

  const selectedVisibleCount = React.useMemo(() => {
    return visibleAssets.filter(asset => selectedAssetKeys.has(assetSelectionKey(asset))).length
  }, [visibleAssets, selectedAssetKeys])

  React.useEffect(() => {
    setSelectedAssetKeys(prev => {
      if (!prev.size) return prev
      const liveKeys = new Set(assets.map(assetSelectionKey))
      const next = new Set(Array.from(prev).filter(key => liveKeys.has(key)))
      return next.size === prev.size ? prev : next
    })
    if (!assets.length) setInteractionMode('browse')
  }, [assets])

  const {
    tasks: uploadTaskSnapshots,
    upsertTask: upsertUploadTask,
    pauseTask: pauseUploadTask,
    resumeTask: resumeUploadTask,
    cancelTask: cancelUploadTask,
  } = useAssetUploadTasks({ gateway, onTasksSettled: loadAssets })
  const thumbnailTargets = React.useMemo(() => visibleAssets.filter(canHaveThumbnail), [visibleAssets])
  const hasAnyThumbnailTargets = React.useMemo(() => assets.some(canHaveThumbnail), [assets])
  const activeUploadCount = React.useMemo(() => uploadTaskSnapshots.filter(isActiveUploadTask).length, [uploadTaskSnapshots])

  /* ---- 加载图片/视频缩略图（后端统一缓存，按需增量生成） ---- */
  React.useEffect(() => {
    let cancelled = false
    const candidates = assets.filter(a => canHaveThumbnail(a) && !a.thumbnailUrl && categoryFromKind(a.kind) === category).slice(0, category === 'video' ? 8 : 20)
    if (!candidates.length) return
    ;(async () => {
      for (const asset of candidates) {
        if (cancelled) break
        try {
          const result = await gateway.assets.getThumbnail(scope, asset.assetId, asset.ext, 320, 180)
          if (cancelled) break
          setAssets(prev =>
            prev.map(a => (a.assetId === asset.assetId && a.ext === asset.ext ? { ...a, thumbnailUrl: String(result.dataUrl || '') } : a)),
          )
        } catch (e: any) {
          if (asset.kind === 'video') {
            const hostMsg = String(e?.message || e || 'unknown error')
            console.warn('[HyperCortex][thumb] cached thumbnail failed:', { asset: `${asset.assetId}.${asset.ext}`, relPath: asset.relPath, hostMsg })
            gateway.host.toast(`生成缩略图失败：${hostMsg}`)
            break
          }
        }
      }
    })()
    return () => { cancelled = true }
  }, [gateway, scope, thumbLoadTick, category, assets.length])

  /* ---- 文件选择 & 上传任务 ---- */
  const handleStartUploadTask = React.useCallback(async () => {
    if (startingUpload) return
    setStartingUpload(true)
    try {
      const task = await startPickedLocalAssetUploadTask(gateway, scope)
      if (!task) return
      upsertUploadTask(task)
      setUploadTaskView('active')
      setUploadPanelOpen(true)
      gateway.host.toast('上传任务已开始')
    } catch (err: any) {
      gateway.host.toast(`上传失败：${String(err?.message || err || '未知错误')}`)
    } finally {
      setStartingUpload(false)
    }
  }, [gateway, scope, startingUpload, upsertUploadTask])

  const handlePauseUploadTask = React.useCallback(async (taskId: string) => {
    try {
      await pauseUploadTask(taskId)
    } catch (err: any) {
      gateway.host.toast(`暂停失败：${String(err?.message || err || '未知错误')}`)
    }
  }, [gateway, pauseUploadTask])

  const handleResumeUploadTask = React.useCallback(async (taskId: string) => {
    try {
      await resumeUploadTask(taskId)
    } catch (err: any) {
      gateway.host.toast(`继续失败：${String(err?.message || err || '未知错误')}`)
    }
  }, [gateway, resumeUploadTask])

  const handleCancelUploadTask = React.useCallback(async (taskId: string) => {
    try {
      await cancelUploadTask(taskId)
    } catch (err: any) {
      gateway.host.toast(`取消失败：${String(err?.message || err || '未知错误')}`)
    }
  }, [gateway, cancelUploadTask])

  /* ---- 删除资源 ---- */
  const requestDelete = React.useCallback((asset: AssetEntry) => {
    setDeleteTargets([asset])
  }, [])

  const requestDeleteSelected = React.useCallback(() => {
    if (!selectedAssets.length) return
    setDeleteTargets(selectedAssets)
  }, [selectedAssets])

  const closeDeleteDialog = React.useCallback(() => {
    if (deleting) return
    setDeleteTargets([])
  }, [deleting])

  const confirmDelete = React.useCallback(async () => {
    const targets = deleteTargets
    if (!targets.length || deleting) return
    setDeleting(true)
    const deletedKeys: string[] = []
    let failed = 0
    try {
      for (const asset of targets) {
        try {
          await gateway.trash.moveAssetToTrash(scope, asset.assetId, asset.ext)
          deletedKeys.push(assetSelectionKey(asset))
        } catch {
          failed += 1
        }
      }
      if (deletedKeys.length) {
        const deletedKeySet = new Set(deletedKeys)
        setAssets(prev => prev.filter(asset => !deletedKeySet.has(assetSelectionKey(asset))))
        setSelectedAssetKeys(prev => new Set(Array.from(prev).filter(key => !deletedKeySet.has(key))))
      }
      gateway.host.toast(failed ? `已移入回收站 ${deletedKeys.length} 个，失败 ${failed} 个` : `已移入回收站 ${deletedKeys.length} 个附件`)
    } catch (err: any) {
      gateway.host.toast(`删除失败：${String(err?.message || err || '未知错误')}`)
    } finally {
      setDeleting(false)
      setDeleteTargets([])
    }
  }, [deleteTargets, deleting, gateway, scope])

  const handleToggleSelected = React.useCallback((asset: AssetEntry) => {
    const key = assetSelectionKey(asset)
    setSelectedAssetKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleSelectVisibleAssets = React.useCallback(() => {
    setSelectedAssetKeys(prev => {
      const next = new Set(prev)
      for (const asset of visibleAssets) next.add(assetSelectionKey(asset))
      return next
    })
  }, [visibleAssets])

  const handleClearSelection = React.useCallback(() => {
    setSelectedAssetKeys(new Set())
  }, [])

  const handleEnterSelectionMode = React.useCallback(() => {
    setInteractionMode('select')
  }, [])

  const handleExitSelectionMode = React.useCallback(() => {
    setInteractionMode('browse')
    setSelectedAssetKeys(new Set())
  }, [])

  const handleCopySelectedMarkers = React.useCallback(() => {
    if (!selectedAssets.length) return
    const markers = selectedAssets.map(buildAssetMarker).join('\n')
    gateway.clipboard.writeText(markers).then(
      () => gateway.host.toast(`已复制 ${selectedAssets.length} 个引用标记`),
      () => gateway.host.toast('复制失败'),
    )
  }, [gateway, selectedAssets])

  const handleRebuildThumbnail = React.useCallback(async (asset: AssetEntry) => {
    if (!canHaveThumbnail(asset)) return
    try {
      const result = await gateway.assets.rebuildThumbnail(scope, asset.assetId, asset.ext, 320, 180)
      setAssets(prev => prev.map(a => (a.assetId === asset.assetId && a.ext === asset.ext ? { ...a, thumbnailUrl: String(result.dataUrl || '') } : a)))
      gateway.host.toast('缩略图已重建')
    } catch (err: any) {
      gateway.host.toast(`重建缩略图失败：${String(err?.message || err || '未知错误')}`)
    }
  }, [gateway, scope])

  const handleRebuildVisibleThumbnails = React.useCallback(async () => {
    const targets = thumbnailTargets
    if (!targets.length || rebuildingThumbnails) return
    setRebuildingThumbnails(true)
    try {
      const nextByKey = new Map<string, string>()
      let failed = 0
      for (const asset of targets) {
        try {
          const result = await gateway.assets.rebuildThumbnail(scope, asset.assetId, asset.ext, 320, 180)
          nextByKey.set(`${asset.assetId}.${asset.ext}`, String(result.dataUrl || ''))
        } catch {
          failed += 1
        }
      }
      if (nextByKey.size) {
        setAssets(prev => prev.map(asset => {
          const hit = nextByKey.get(`${asset.assetId}.${asset.ext}`)
          return hit ? { ...asset, thumbnailUrl: hit } : asset
        }))
      }
      gateway.host.toast(failed ? `缩略图重建完成，失败 ${failed} 个` : `已重建 ${nextByKey.size} 个缩略图`)
    } finally {
      setRebuildingThumbnails(false)
    }
  }, [gateway, rebuildingThumbnails, scope, thumbnailTargets])

  const handleRebuildAllThumbnails = React.useCallback(async () => {
    if (rebuildingThumbnails) return
    setRebuildingThumbnails(true)
    try {
      const report = await gateway.assets.rebuildAllThumbnails(scope, 320, 180)
      setAssets(prev => prev.map(asset => (canHaveThumbnail(asset) ? { ...asset, thumbnailUrl: undefined } : asset)))
      setThumbLoadTick(t => t + 1)
      gateway.host.toast(report.failed ? `全部缩略图重建完成，失败 ${report.failed} 个` : `已重建 ${report.rebuilt} 个缩略图`)
    } catch (err: any) {
      gateway.host.toast(`全部重建失败：${String(err?.message || err || '未知错误')}`)
    } finally {
      setRebuildingThumbnails(false)
    }
  }, [gateway, rebuildingThumbnails, scope])

  /* ---- 渲染 ---- */

  const statsByCategory = React.useMemo(() => {
    const counts: Record<AssetCategory, number> = { image: 0, video: 0, document: 0 }
    const sizes: Record<AssetCategory, number> = { image: 0, video: 0, document: 0 }
    for (const a of assets) {
      const c = categoryFromKind(a.kind)
      counts[c] += 1
      sizes[c] += a.size || 0
    }
    return { counts, sizes, totalSize: assets.reduce((s, a) => s + (a.size || 0), 0) }
  }, [assets])
  const imageTone = assetToneFromKind('image')
  const videoTone = assetToneFromKind('video')
  const documentTone = assetToneFromKind('document')
  const activeCategoryTone = assetToneFromKind(category)
  const allVisibleAssetsSelected = visibleAssets.length > 0 && selectedVisibleCount === visibleAssets.length
  const canUseSelectionMode = !loading && !error && assets.length > 0
  const selectionActionSlot = canUseSelectionMode
    ? selectionMode
      ? (
          <AssetSelectionToolbar
            selectedCount={selectedAssets.length}
            selectedVisibleCount={selectedVisibleCount}
            hasVisibleAssets={visibleAssets.length > 0}
            allVisibleAssetsSelected={allVisibleAssetsSelected}
            activeCategoryTone={activeCategoryTone}
            onSelectVisible={handleSelectVisibleAssets}
            onClearSelection={handleClearSelection}
            onCopySelectedMarkers={handleCopySelectedMarkers}
            onDeleteSelected={requestDeleteSelected}
            onExitSelectionMode={handleExitSelectionMode}
          />
        )
      : (
          <Button
            variant="text"
            size="small"
            onClick={handleEnterSelectionMode}
            sx={{ minWidth: 0, px: 1, borderRadius: 2, textTransform: 'none', color: 'var(--hc-text-muted)', fontWeight: 800, ...toneHoverActionSx(activeCategoryTone) }}
          >
            多选
          </Button>
        )
    : null
  const globalToolbar = (
    <AssetGlobalToolbar
      activeUploadCount={activeUploadCount}
      uploadPanelOpen={uploadPanelOpen}
      uploadTasks={uploadTaskSnapshots}
      uploadTaskView={uploadTaskView}
      loading={loading}
      rebuildingThumbnails={rebuildingThumbnails}
      startingUpload={startingUpload}
      showVisibleThumbnailAction={category !== 'document'}
      thumbnailTargetsCount={thumbnailTargets.length}
      hasAnyThumbnailTargets={hasAnyThumbnailTargets}
      activeCategoryTone={activeCategoryTone}
      onToggleUploadPanel={() => setUploadPanelOpen(open => !open)}
      onUploadTaskViewChange={setUploadTaskView}
      onCloseUploadPanel={() => setUploadPanelOpen(false)}
      onPauseUploadTask={taskId => void handlePauseUploadTask(taskId)}
      onResumeUploadTask={taskId => void handleResumeUploadTask(taskId)}
      onCancelUploadTask={taskId => void handleCancelUploadTask(taskId)}
      onRefresh={() => void loadAssets()}
      onRebuildVisibleThumbnails={() => void handleRebuildVisibleThumbnails()}
      onRebuildAllThumbnails={() => void handleRebuildAllThumbnails()}
      onStartUploadTask={() => void handleStartUploadTask()}
    />
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* 标题栏 */}
      <Box sx={{ display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
        <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>
          附件
        </Typography>
        {globalToolbar}
      </Box>

      {/* 分类切换栏 */}
      <AssetCategoryBar
        category={category}
        counts={statsByCategory.counts}
        imageTone={imageTone}
        videoTone={videoTone}
        documentTone={documentTone}
        actionSlot={selectionActionSlot}
        onCategoryChange={setCategory}
      />

      {/* 概览 */}
      {!loading && assets.length > 0 ? (
        <Typography sx={{ fontSize: 12, color: 'var(--hc-text-subtle)' }}>
          当前分类 {visibleAssets.length} 个，共 {assets.length} 个，{humanSize(statsByCategory.totalSize)}
        </Typography>
      ) : null}

      {/* 状态提示 */}
      {loading ? <Typography color="text.secondary">正在加载附件...</Typography> : null}
      {!loading && error ? <Typography color="error">{error}</Typography> : null}
      {!loading && !error && assets.length === 0 ? <Typography color="text.secondary">还没有任何附件。</Typography> : null}

      {/* 资源列表 */}
      {!loading && !error && assets.length > 0 ? (
        visibleAssets.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(3, minmax(0, 1fr))',
                md: 'repeat(4, minmax(0, 1fr))',
              },
              gap: 1,
            }}
          >
            {visibleAssets.map(asset => (
              <AssetCard
                key={`${asset.assetId}.${asset.ext}`}
                gateway={gateway}
                asset={asset}
                selectionMode={selectionMode}
                selected={selectedAssetKeys.has(assetSelectionKey(asset))}
                onDelete={requestDelete}
                onToggleSelected={handleToggleSelected}
                onRebuildThumbnail={a => void handleRebuildThumbnail(a)}
                onOpenAsset={onOpenAsset}
              />
            ))}
          </Box>
        ) : (
          <Typography color="text.secondary">这个分类里还没有附件。</Typography>
        )
      ) : null}

      <Dialog open={deleteTargets.length > 0} onClose={closeDeleteDialog} maxWidth="xs" fullWidth>
        <DialogTitle>移入回收站</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
            {deleteTargets.length > 1
              ? `确定将已选的 ${deleteTargets.length} 个附件移入回收站吗？`
              : `确定将附件「${deleteTargets[0] ? pickAssetDisplayName({ indexName: deleteTargets[0].displayName, ext: deleteTargets[0].ext }) : '未命名附件'}」移入回收站吗？`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog} disabled={deleting}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmDelete()} disabled={deleting}>
            {deleting ? '处理中...' : '移入回收站'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
