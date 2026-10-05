import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { type VaultScope } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import { buildAssetMarker } from '../assetMarker'
import { assetRefKey, type AssetEntry } from '../assetTypes'
import { loadAssetThumbnail } from '../assetThumbnailProvider'
import { applyAssetThumbnailResults, mergeAssetThumbnailState, updateAssetThumbnailState } from '../assetThumbnailState'
import { buildAssetEntries } from '../assetEntryModel'
import type { HyperCortexGateway } from '../gateway'
import { startPickedLocalAssetUploadTask } from '../services/localAssetUpload'
import { startPastedAssetUploadTask } from '../services/pastedAssetUpload'
import { type AssetUploadTaskView, isActiveUploadTask, isFailedUploadTask } from './assetUploadTasks'
import { useClipboardFilesPaste } from './useClipboardFilesPaste'
import { useAssetUploadTasks } from './useAssetUploadTasks'
import { useAssetThumbnailLoader } from './useAssetThumbnailLoader'
import { assetToneFromKind, toneHoverActionSx } from './uiTones'
import { useWorkspaceVisible } from './workspaceVisibility'
import { AssetCard, canHaveThumbnail, humanSize } from './AssetPoolAssetCard'
import { AssetSelectionToolbar } from './AssetPoolSelectionToolbar'
import { AssetCategoryBar, type AssetCategory } from './AssetPoolCategoryBar'
import { AssetGlobalToolbar } from './AssetPoolGlobalToolbar'

/* ------------------------------------------------------------------ */
/*  类型                                                               */
/* ------------------------------------------------------------------ */

type AssetInteractionMode = 'browse' | 'select'

type Props = {
  gateway: HyperCortexGateway
  scope: VaultScope
  // 当前仓库标识：用于把上传任务面板限制在当前仓库。
  activeRepoId: string
  onOpenAsset?: (asset: AssetEntry) => void
  filterText?: string
  picker?: {
    alreadyKeys: ReadonlySet<string>
    onPick: (asset: AssetEntry) => void
  }
}

/* ------------------------------------------------------------------ */
/*  工具函数                                                           */
/* ------------------------------------------------------------------ */

function categoryFromKind(kind: string): AssetCategory {
  if (kind === 'image') return 'image'
  if (kind === 'video') return 'video'
  return 'document'
}

/* ------------------------------------------------------------------ */
/*  组件                                                               */
/* ------------------------------------------------------------------ */

export function AssetPoolPanel({ gateway, scope, activeRepoId, onOpenAsset, filterText = '', picker }: Props) {
  const workspaceVisible = useWorkspaceVisible()
  const [assets, setAssets] = React.useState<AssetEntry[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [startingUpload, setStartingUpload] = React.useState(false)
  const [startingPastedUpload, setStartingPastedUpload] = React.useState(false)
  const [rebuildingThumbnails, setRebuildingThumbnails] = React.useState(false)
  const [category, setCategory] = React.useState<AssetCategory>('image')
  const [assetListRevision, setAssetListRevision] = React.useState(0)
  const [uploadPanelOpen, setUploadPanelOpen] = React.useState(false)
  const [uploadTaskView, setUploadTaskView] = React.useState<AssetUploadTaskView>('active')
  const [seenFailedUploadTaskIds, setSeenFailedUploadTaskIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [interactionMode, setInteractionMode] = React.useState<AssetInteractionMode>('browse')
  const [selectedAssetKeys, setSelectedAssetKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const [deleteTargets, setDeleteTargets] = React.useState<AssetEntry[]>([])
  const [deleting, setDeleting] = React.useState(false)
  const uploadLaunchPendingRef = React.useRef(false)
  const selectionMode = interactionMode === 'select'

  /* ---- 加载资源列表 ---- */
  const loadAssets = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await gateway.assets.listAssets(scope)
      const entries: AssetEntry[] = buildAssetEntries(items)
        .sort((a, b) => b.modifiedMs - a.modifiedMs)
      setAssets(prev => mergeAssetThumbnailState(entries, prev))
      setAssetListRevision(revision => revision + 1)
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'))
    } finally {
      setLoading(false)
    }
  }, [gateway, scope])

  React.useEffect(() => { void loadAssets() }, [loadAssets])

  const visibleAssets = React.useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return assets.filter(a => {
      if (categoryFromKind(a.kind) !== category) return false
      if (!q) return true
      return [
        assetRefKey(a),
        String(a.displayName || ''),
        String(a.sourceName || ''),
        String(a.fileName || ''),
        String(a.remark || ''),
        (a.tags || []).join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [assets, category, filterText])

  const selectedAssets = React.useMemo(() => {
    return assets.filter(asset => selectedAssetKeys.has(assetRefKey(asset)))
  }, [assets, selectedAssetKeys])

  const selectedVisibleCount = React.useMemo(() => {
    return visibleAssets.filter(asset => selectedAssetKeys.has(assetRefKey(asset))).length
  }, [visibleAssets, selectedAssetKeys])

  React.useEffect(() => {
    setSelectedAssetKeys(prev => {
      if (!prev.size) return prev
      const liveKeys = new Set(assets.map(assetRefKey))
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
  } = useAssetUploadTasks({ gateway, activeRepoId, onTasksSettled: loadAssets })
  const thumbnailTargets = React.useMemo(() => visibleAssets.filter(canHaveThumbnail), [visibleAssets])
  const hasAnyThumbnailTargets = React.useMemo(() => assets.some(canHaveThumbnail), [assets])
  const activeUploadCount = React.useMemo(() => uploadTaskSnapshots.filter(isActiveUploadTask).length, [uploadTaskSnapshots])
  const failedUploadTasks = React.useMemo(() => uploadTaskSnapshots.filter(isFailedUploadTask), [uploadTaskSnapshots])
  const unseenFailedUploadCount = React.useMemo(() => failedUploadTasks.filter(task => !seenFailedUploadTaskIds.has(task.id)).length, [failedUploadTasks, seenFailedUploadTaskIds])
  const uploadLaunchPending = startingUpload || startingPastedUpload

  const markFailedUploadTasksSeen = React.useCallback(() => {
    if (!failedUploadTasks.length) return
    setSeenFailedUploadTaskIds(prev => {
      const next = new Set(prev)
      let changed = false
      for (const task of failedUploadTasks) {
        if (next.has(task.id)) continue
        next.add(task.id)
        changed = true
      }
      return changed ? next : prev
    })
  }, [failedUploadTasks])

  React.useEffect(() => {
    setSeenFailedUploadTaskIds(prev => {
      if (!prev.size) return prev
      const failedIds = new Set(failedUploadTasks.map(task => task.id))
      const next = new Set(Array.from(prev).filter(id => failedIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [failedUploadTasks])

  React.useEffect(() => {
    if (!uploadPanelOpen || uploadTaskView !== 'failed') return
    markFailedUploadTasksSeen()
  }, [markFailedUploadTasksSeen, uploadPanelOpen, uploadTaskView])

  const handleToggleUploadPanel = React.useCallback(() => {
    if (!uploadPanelOpen && unseenFailedUploadCount > 0) setUploadTaskView('failed')
    setUploadPanelOpen(open => !open)
  }, [unseenFailedUploadCount, uploadPanelOpen])

  useAssetThumbnailLoader({ gateway, scope, assets: visibleAssets, setAssets, revision: assetListRevision })

  /* ---- 文件选择 & 上传任务 ---- */
  const handleStartUploadTask = React.useCallback(async () => {
    if (uploadLaunchPending || uploadLaunchPendingRef.current) return
    uploadLaunchPendingRef.current = true
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
      uploadLaunchPendingRef.current = false
      setStartingUpload(false)
    }
  }, [gateway, scope, uploadLaunchPending, upsertUploadTask])

  const handleStartPastedUploadTask = React.useCallback(async (files: File[]) => {
    if (uploadLaunchPending || uploadLaunchPendingRef.current) {
      gateway.host.toast('正在处理粘贴的附件，请稍后再试')
      return
    }
    uploadLaunchPendingRef.current = true
    setStartingPastedUpload(true)
    try {
      const task = await startPastedAssetUploadTask(gateway, scope, files)
      if (!task) return
      upsertUploadTask(task)
      setUploadTaskView('active')
      setUploadPanelOpen(true)
      gateway.host.toast(files.length > 1 ? `已开始上传 ${files.length} 个粘贴附件` : '已开始上传粘贴附件')
    } catch (err: any) {
      gateway.host.toast(`粘贴附件失败：${String(err?.message || err || '未知错误')}`)
    } finally {
      uploadLaunchPendingRef.current = false
      setStartingPastedUpload(false)
    }
  }, [gateway, scope, uploadLaunchPending, upsertUploadTask])

  useClipboardFilesPaste({ enabled: deleteTargets.length === 0, onPasteFiles: handleStartPastedUploadTask })

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
          deletedKeys.push(assetRefKey(asset))
        } catch {
          failed += 1
        }
      }
      if (deletedKeys.length) {
        const deletedKeySet = new Set(deletedKeys)
        setAssets(prev => prev.filter(asset => !deletedKeySet.has(assetRefKey(asset))))
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
    const key = assetRefKey(asset)
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
      for (const asset of visibleAssets) next.add(assetRefKey(asset))
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
      const thumbnailUrl = await loadAssetThumbnail({ gateway, scope, asset, width: 320, height: 180, force: true })
      setAssets(prev => updateAssetThumbnailState(prev, asset, { thumbnailUrl, thumbnailError: undefined }))
      gateway.host.toast('缩略图已重建')
    } catch (err: any) {
      const message = String(err?.message || err || '未知错误')
      setAssets(prev => updateAssetThumbnailState(prev, asset, { thumbnailUrl: undefined, thumbnailError: message }))
      gateway.host.toast(`重建缩略图失败：${message}`)
    }
  }, [gateway, scope])

  const handleThumbnailLoadError = React.useCallback((asset: AssetEntry, message: string) => {
    console.warn('[HyperCortex][thumb] image load failed:', { asset: assetRefKey(asset), relPath: asset.relPath, message })
    setAssets(prev => updateAssetThumbnailState(prev, asset, { thumbnailUrl: undefined, thumbnailError: message }))
  }, [])

  const handleRebuildVisibleThumbnails = React.useCallback(async () => {
    const targets = thumbnailTargets
    if (!targets.length || rebuildingThumbnails) return
    setRebuildingThumbnails(true)
    try {
      const thumbnailUrlsByKey = new Map<string, string>()
      const thumbnailErrorsByKey = new Map<string, string>()
      let failed = 0
      for (const asset of targets) {
        try {
          const thumbnailUrl = await loadAssetThumbnail({ gateway, scope, asset, width: 320, height: 180, force: true })
          thumbnailUrlsByKey.set(assetRefKey(asset), thumbnailUrl)
        } catch (err: any) {
          failed += 1
          thumbnailErrorsByKey.set(assetRefKey(asset), String(err?.message || err || '未知错误'))
        }
      }
      if (thumbnailUrlsByKey.size || thumbnailErrorsByKey.size) {
        setAssets(prev => applyAssetThumbnailResults(prev, { thumbnailUrlsByKey, thumbnailErrorsByKey }))
      }
      gateway.host.toast(failed ? `缩略图重建完成，失败 ${failed} 个` : `已重建 ${thumbnailUrlsByKey.size} 个缩略图`)
    } finally {
      setRebuildingThumbnails(false)
    }
  }, [gateway, rebuildingThumbnails, scope, thumbnailTargets])

  const handleRebuildAllThumbnails = React.useCallback(async () => {
    if (rebuildingThumbnails) return
    setRebuildingThumbnails(true)
    try {
      const targets = assets.filter(canHaveThumbnail)
      const thumbnailUrlsByKey = new Map<string, string>()
      const thumbnailErrorsByKey = new Map<string, string>()
      for (const asset of targets) {
        const key = assetRefKey(asset)
        try {
          const thumbnailUrl = await loadAssetThumbnail({ gateway, scope, asset, width: 320, height: 180, force: true })
          thumbnailUrlsByKey.set(key, thumbnailUrl)
        } catch (err: any) {
          thumbnailErrorsByKey.set(key, String(err?.message || err || '缩略图生成失败'))
        }
      }
      setAssets(prev => applyAssetThumbnailResults(prev, { thumbnailUrlsByKey, thumbnailErrorsByKey }))
      gateway.host.toast(thumbnailErrorsByKey.size ? `全部支持类型缩略图重建完成，失败 ${thumbnailErrorsByKey.size} 个` : `已重建 ${thumbnailUrlsByKey.size} 个缩略图`)
    } catch (err: any) {
      gateway.host.toast(`全部重建失败：${String(err?.message || err || '未知错误')}`)
    } finally {
      setRebuildingThumbnails(false)
    }
  }, [assets, gateway, rebuildingThumbnails, scope])

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
  const selectionActionSlot = !picker && canUseSelectionMode
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
            onToggleSelectionMode={handleExitSelectionMode}
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
      unseenFailedUploadCount={unseenFailedUploadCount}
      uploadPanelOpen={uploadPanelOpen}
      uploadTasks={uploadTaskSnapshots}
      uploadTaskView={uploadTaskView}
      loading={loading}
      rebuildingThumbnails={rebuildingThumbnails}
      startingUpload={uploadLaunchPending}
      showVisibleThumbnailAction
      thumbnailTargetsCount={thumbnailTargets.length}
      hasAnyThumbnailTargets={hasAnyThumbnailTargets}
      activeCategoryTone={activeCategoryTone}
      onToggleUploadPanel={handleToggleUploadPanel}
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
      {!picker ? (
        <Box sx={{ display: 'flex', alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
          <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>
            附件
          </Typography>
          {globalToolbar}
        </Box>
      ) : null}

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
      {!picker && !loading ? (
        <Typography sx={{ fontSize: 12, color: 'var(--hc-text-subtle)' }}>
          {assets.length > 0
            ? `当前分类 ${visibleAssets.length} 个，共 ${assets.length} 个，${humanSize(statsByCategory.totalSize)} · 可直接 Ctrl+V 粘贴图片或文件`
            : '可直接 Ctrl+V 粘贴图片或文件，也可以点击“添加文件”。'}
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
                key={assetRefKey(asset)}
                gateway={gateway}
                asset={asset}
                selectionMode={selectionMode}
                selected={selectedAssetKeys.has(assetRefKey(asset))}
                picked={picker ? picker.alreadyKeys.has(assetRefKey(asset)) : false}
                onPick={picker?.onPick}
                onDelete={requestDelete}
                onToggleSelected={handleToggleSelected}
                onRebuildThumbnail={a => void handleRebuildThumbnail(a)}
                onThumbnailLoadError={handleThumbnailLoadError}
                onOpenAsset={onOpenAsset}
              />
            ))}
          </Box>
        ) : (
          <Typography color="text.secondary">这个分类里还没有附件。</Typography>
        )
      ) : null}

      <Dialog open={workspaceVisible && deleteTargets.length > 0} onClose={closeDeleteDialog} maxWidth="xs" fullWidth>
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
