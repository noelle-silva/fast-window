import * as React from 'react'
import { Box, Button, CircularProgress, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ImageSearchRoundedIcon from '@mui/icons-material/ImageSearchRounded'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import { type VaultScope, kindFromMime, mimeFromExt } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import { buildAssetMarker } from '../assetMarker'
import type { AssetEntry } from '../assetTypes'
import { getAssetPreviewDescriptor, isAssetOpenableInTab } from './assetPreview/registry'
import type { HyperCortexGateway } from '../gateway'
import { startPickedLocalAssetUploadTask } from '../services/localAssetUpload'
import { AssetUploadTaskPanel } from './AssetUploadTaskPanel'
import { type AssetUploadTaskView, isActiveUploadTask } from './assetUploadTasks'
import { useAssetUploadTasks } from './useAssetUploadTasks'

/* ------------------------------------------------------------------ */
/*  类型                                                               */
/* ------------------------------------------------------------------ */

type AssetCategory = 'image' | 'video' | 'document'

type Props = {
  gateway: HyperCortexGateway
  scope: VaultScope
  onOpenAsset?: (asset: AssetEntry) => void
}

/* ------------------------------------------------------------------ */
/*  工具函数                                                           */
/* ------------------------------------------------------------------ */

function parseAssetFileName(name: string): { assetId: string; ext: string } {
  const s = String(name || '').trim()
  const dotIdx = s.lastIndexOf('.')
  if (dotIdx <= 0) return { assetId: s, ext: '' }
  return { assetId: s.slice(0, dotIdx), ext: s.slice(dotIdx + 1).toLowerCase() }
}

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

/* ------------------------------------------------------------------ */
/*  组件                                                               */
/* ------------------------------------------------------------------ */

function canHaveThumbnail(asset: Pick<AssetEntry, 'kind'>): boolean {
  return asset.kind === 'image' || asset.kind === 'video'
}

function AssetCard({
  gateway,
  asset,
  onDelete,
  onRebuildThumbnail,
  onOpenAsset,
}: {
  gateway: HyperCortexGateway
  asset: AssetEntry
  onDelete: (asset: AssetEntry) => void
  onRebuildThumbnail: (asset: AssetEntry) => void
  onOpenAsset?: (asset: AssetEntry) => void
}) {
  const titleLabel = pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext })
  const preview = React.useMemo(() => getAssetPreviewDescriptor(asset), [asset])
  const canOpenPreview = isAssetOpenableInTab(asset)
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
      role={canOpenPreview ? 'button' : undefined}
      tabIndex={canOpenPreview ? 0 : -1}
      aria-label={canOpenPreview ? `打开附件：${titleLabel}` : undefined}
      onClick={() => {
        if (!canOpenPreview) return
        onOpenAsset?.(asset)
      }}
      onKeyDown={e => {
        if (!canOpenPreview) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onOpenAsset?.(asset)
      }}
      sx={{
        position: 'relative',
        minHeight: 180,
        px: 1.5,
        py: 1.5,
        borderRadius: 3,
        bgcolor: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
        outline: 'none',
        '&:hover': {
          bgcolor: 'rgba(0,0,0,.02)',
          boxShadow: '0 6px 16px rgba(0,0,0,.08)',
          transform: 'translateY(-1px)',
        },
        '&:focus-visible': canOpenPreview ? { boxShadow: '0 0 0 2px rgba(25,118,210,.32), 0 6px 16px rgba(0,0,0,.08)' } : undefined,
        '&:hover .hc-asset-card-actions': { opacity: 1 },
        cursor: canOpenPreview ? 'pointer' : 'default',
      }}
    >
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
              '&:hover': { bgcolor: 'rgba(0,0,0,.1)', color: '#1976d2' },
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
                '&:hover': { bgcolor: 'rgba(0,0,0,.1)', color: '#1976d2' },
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
              '&:hover': { bgcolor: 'rgba(0,0,0,.1)', color: '#d32f2f' },
            }}
          >
            <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

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
              bgcolor: 'rgba(0,0,0,.03)',
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
            color: '#111',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
          title={titleLabel}
        >
          {titleLabel}
        </Typography>
        <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.38)', flexShrink: 0 }}>
          {humanSize(asset.size)}
        </Typography>
      </Box>

      <Typography
        sx={{
          mt: 0.25,
          fontSize: 11,
          color: 'rgba(0,0,0,.42)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'monospace',
        }}
        title={asset.assetId}
      >
        {asset.assetId.slice(0, 12)}…
      </Typography>
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
  const uploadButtonRef = React.useRef<HTMLButtonElement | null>(null)

  /* ---- 加载资源列表 ---- */
  const loadAssets = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await gateway.assets.listAssets(scope)
      const entries: AssetEntry[] = items
        .map(item => {
          const { assetId, ext } = parseAssetFileName(item.name)
          const mime = mimeFromExt(ext)
          const kind = mime ? kindFromMime(mime) : 'document'
          return {
            relPath: item.relPath,
            fileName: item.name,
            displayName: item.displayName,
            assetId,
            ext,
            kind,
            size: item.size,
            modifiedMs: item.modifiedMs,
          }
        })
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

  const {
    tasks: uploadTaskSnapshots,
    upsertTask: upsertUploadTask,
    pauseTask: pauseUploadTask,
    resumeTask: resumeUploadTask,
    cancelTask: cancelUploadTask,
  } = useAssetUploadTasks({ gateway, onTasksSettled: loadAssets })
  const thumbnailTargets = React.useMemo(() => visibleAssets.filter(canHaveThumbnail), [visibleAssets])
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
  const handleDelete = React.useCallback(async (asset: AssetEntry) => {
    try {
      await gateway.assets.deleteAsset(scope, asset.assetId, asset.ext)
      gateway.host.toast('已删除')
      setAssets(prev => prev.filter(a => !(a.assetId === asset.assetId && a.ext === asset.ext)))
    } catch (err: any) {
      gateway.host.toast(`删除失败：${String(err?.message || err || '未知错误')}`)
    }
  }, [gateway, scope])

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* 标题栏 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>
          附件
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
          <Tooltip title="上传任务" placement="bottom">
            <IconButton
              ref={uploadButtonRef}
              size="small"
              aria-label="上传任务"
              onClick={() => setUploadPanelOpen(open => !open)}
              sx={{ color: activeUploadCount ? '#4f46e5' : 'rgba(0,0,0,.58)', '&:hover': { bgcolor: 'rgba(79,70,229,.08)', color: '#4f46e5' } }}
            >
              <CloudUploadRoundedIcon fontSize="small" />
              {activeUploadCount ? (
                <Box sx={{ position: 'absolute', top: 2, right: 2, minWidth: 14, height: 14, px: 0.25, borderRadius: 999, bgcolor: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 900, lineHeight: '14px', textAlign: 'center' }}>
                  {activeUploadCount > 9 ? '9+' : activeUploadCount}
                </Box>
              ) : null}
            </IconButton>
          </Tooltip>
          <AssetUploadTaskPanel
            anchorEl={uploadButtonRef.current}
            open={uploadPanelOpen}
            tasks={uploadTaskSnapshots}
            view={uploadTaskView}
            onViewChange={setUploadTaskView}
            onClose={() => setUploadPanelOpen(false)}
            onPause={taskId => void handlePauseUploadTask(taskId)}
            onResume={taskId => void handleResumeUploadTask(taskId)}
            onCancel={taskId => void handleCancelUploadTask(taskId)}
          />
          <Tooltip title="刷新" placement="bottom">
            <IconButton
              size="small"
              aria-label="刷新"
              onClick={() => void loadAssets()}
              disabled={loading}
              sx={{ color: 'rgba(0,0,0,.58)', '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' } }}
            >
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {category !== 'document' ? (
            <Tooltip title="重建当前分类缩略图缓存" placement="bottom">
              <span>
                <IconButton
                  size="small"
                  aria-label="重建当前分类缩略图缓存"
                  onClick={() => void handleRebuildVisibleThumbnails()}
                  disabled={rebuildingThumbnails || thumbnailTargets.length === 0}
                  sx={{ color: 'rgba(0,0,0,.58)', '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' } }}
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
                disabled={rebuildingThumbnails || assets.filter(canHaveThumbnail).length === 0}
                onClick={() => void handleRebuildAllThumbnails()}
                sx={{ minWidth: 0, px: 1, borderRadius: 2, textTransform: 'none', color: 'rgba(0,0,0,.58)', fontWeight: 800 }}
              >
                全部重建
              </Button>
            </span>
          </Tooltip>

          <Button
            variant="outlined"
            size="small"
            startIcon={startingUpload ? <CircularProgress size={16} /> : <AddRoundedIcon />}
            disabled={startingUpload}
            onClick={() => void handleStartUploadTask()}
            sx={{
              textTransform: 'none',
              borderRadius: 2,
              borderColor: 'rgba(0,0,0,.16)',
              color: '#333',
              '&:hover': { borderColor: 'rgba(0,0,0,.32)', bgcolor: 'rgba(0,0,0,.02)' },
            }}
          >
            {startingUpload ? '启动中...' : '添加文件'}
          </Button>
        </Box>
      </Box>

      {/* 分类切换栏 */}
      <Tabs
        value={category}
        onChange={(_, v) => setCategory(v as AssetCategory)}
        aria-label="附件分类切换"
        sx={{
          minHeight: 36,
          bgcolor: 'rgba(0,0,0,.04)',
          borderRadius: 2,
          px: 0.5,
          '& .MuiTabs-indicator': { height: 0 },
          '& .MuiTab-root': {
            minHeight: 36,
            textTransform: 'none',
            fontSize: 13,
            fontWeight: 700,
            color: 'rgba(0,0,0,.55)',
            borderRadius: 1.5,
            px: 2,
          },
          '& .MuiTab-root.Mui-selected': {
            bgcolor: '#fff',
            color: '#111',
            boxShadow: '0 1px 2px rgba(0,0,0,.06)',
          },
        }}
      >
        <Tab value="image" label={`图片 (${statsByCategory.counts.image})`} />
        <Tab value="video" label={`视频 (${statsByCategory.counts.video})`} />
        <Tab value="document" label={`文档 (${statsByCategory.counts.document})`} />
      </Tabs>

      {/* 概览 */}
      {!loading && assets.length > 0 ? (
        <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.38)' }}>
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
                onDelete={a => void handleDelete(a)}
                onRebuildThumbnail={a => void handleRebuildThumbnail(a)}
                onOpenAsset={onOpenAsset}
              />
            ))}
          </Box>
        ) : (
          <Typography color="text.secondary">这个分类里还没有附件。</Typography>
        )
      ) : null}
    </Box>
  )
}
