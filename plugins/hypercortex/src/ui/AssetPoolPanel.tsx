import * as React from 'react'
import { Box, Button, CircularProgress, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import AudioFileRoundedIcon from '@mui/icons-material/AudioFileRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import { PLUGIN_ID, type Api, type VaultScope, acceptString, kindFromMime, mimeFromExt } from '../core'
import { deleteAssetFromPool, importFilesToAssetPool, listAssetsInPool, readAssetAsDataUrl } from '../assetPool'
import { pickAssetDisplayName } from '../assetDisplayName'
import type { AssetEntry } from '../assetTypes'
import { readFileAsDataUrl } from './fileDataUrl'

/* ------------------------------------------------------------------ */
/*  类型                                                               */
/* ------------------------------------------------------------------ */

type AssetCategory = 'image' | 'video' | 'document'

type Props = {
  api: Api
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

function kindIcon(kind: string, fontSize: 'small' | 'medium' = 'small') {
  if (kind === 'image') return <ImageRoundedIcon fontSize={fontSize} />
  if (kind === 'audio') return <AudioFileRoundedIcon fontSize={fontSize} />
  if (kind === 'video') return <VideoFileRoundedIcon fontSize={fontSize} />
  return <InsertDriveFileRoundedIcon fontSize={fontSize} />
}

function kindColor(kind: string): string {
  if (kind === 'image') return '#1976d2'
  if (kind === 'audio') return '#e65100'
  if (kind === 'video') return '#7b1fa2'
  return '#546e7a'
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

function buildAssetMarker(asset: Pick<AssetEntry, 'assetId' | 'ext' | 'kind'>): string {
  const ref = asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
  const defaultWidth = asset.kind === 'image' ? 320 : asset.kind === 'video' ? 480 : 0
  return defaultWidth ? `{{asset:${ref}||${defaultWidth}}}` : `{{asset:${ref}}}`
}

function AssetCard({
  api,
  asset,
  onDelete,
  onOpenAsset,
}: {
  api: Api
  asset: AssetEntry
  onDelete: (asset: AssetEntry) => void
  onOpenAsset?: (asset: AssetEntry) => void
}) {
  const titleLabel = pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext })
  const canOpenPreview = asset.kind === 'image' || asset.kind === 'video'
  const handleCopy = React.useCallback(() => {
    const marker = buildAssetMarker(asset)
    api.clipboard.writeText(marker).then(
      () => api.ui.showToast('已复制'),
      () => api.ui.showToast('复制失败'),
    )
  }, [api, asset])

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
              color: kindColor(asset.kind),
            }}
          >
            {kindIcon(asset.kind, 'medium')}
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

export function AssetPoolPanel({ api, scope, onOpenAsset }: Props) {
  const [assets, setAssets] = React.useState<AssetEntry[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [category, setCategory] = React.useState<AssetCategory>('image')
  const [thumbLoadTick, setThumbLoadTick] = React.useState(0)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  /* ---- 加载资源列表 ---- */
  const loadAssets = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await listAssetsInPool(api, scope)
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
  }, [api, scope])

  React.useEffect(() => { void loadAssets() }, [loadAssets])

  /* ---- 加载图片缩略图（懒加载前几张） ---- */
  React.useEffect(() => {
    let cancelled = false
    const imageAssets = assets.filter(a => a.kind === 'image' && !a.thumbnailUrl).slice(0, 20)
    if (!imageAssets.length) return
    ;(async () => {
      for (const asset of imageAssets) {
        if (cancelled) break
        try {
          const dataUrl = await readAssetAsDataUrl(api, scope, asset.assetId, asset.ext)
          if (cancelled) break
          setAssets(prev =>
            prev.map(a => (a.assetId === asset.assetId ? { ...a, thumbnailUrl: dataUrl } : a)),
          )
        } catch {
          // 缩略图加载失败，静默忽略
        }
      }
    })()
    return () => { cancelled = true }
  }, [api, scope, thumbLoadTick])

  /* ---- 加载视频缩略图（宿主生成；排障期输出详细错误） ---- */
  React.useEffect(() => {
    let cancelled = false
    if (category !== 'video') return
    const candidates = assets.filter(a => a.kind === 'video' && !a.thumbnailUrl).slice(0, 8)
    if (!candidates.length) return

    const tauriInvoke = (api as any)?.tauri?.invoke
    if (typeof tauriInvoke !== 'function') return

    ;(async () => {
      for (const asset of candidates) {
        if (cancelled) break
        try {
          const dataUrl = await tauriInvoke({
            command: 'plugin_files_thumbnail',
            payload: {
              pluginId: PLUGIN_ID,
              req: { scope, path: asset.relPath, width: 320, height: 180 },
            },
          })
          if (cancelled) break
          setAssets(prev =>
            prev.map(a =>
              a.assetId === asset.assetId && a.ext === asset.ext ? { ...a, thumbnailUrl: String(dataUrl || '') } : a,
            ),
          )
        } catch (e: any) {
          const hostMsg = String(e?.message || e || 'unknown error')
          console.warn('[HyperCortex][thumb] host thumbnail failed:', {
            asset: `${asset.assetId}.${asset.ext}`,
            relPath: asset.relPath,
            hostMsg,
          })
          api.ui.showToast(`宿主生成缩略图失败：${hostMsg}`)
          break
        }
      }
    })()

    return () => { cancelled = true }
  }, [api, scope, thumbLoadTick, category, assets.length])

  /* ---- 文件选择 & 导入 ---- */
  const handleFileSelect = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !files.length) return
    setImporting(true)
    try {
      const inputs: { name?: string; dataUrl: string }[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const dataUrl = await readFileAsDataUrl(f)
        inputs.push({ name: f.name, dataUrl })
      }
      await importFilesToAssetPool(api, scope, inputs)
      api.ui.showToast(`已导入 ${inputs.length} 个文件`)
      await loadAssets()
    } catch (err: any) {
      api.ui.showToast(`导入失败：${String(err?.message || err || '未知错误')}`)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [api, scope, loadAssets])

  /* ---- 删除资源 ---- */
  const handleDelete = React.useCallback(async (asset: AssetEntry) => {
    try {
      await deleteAssetFromPool(api, scope, asset.assetId, asset.ext)
      api.ui.showToast('已删除')
      setAssets(prev => prev.filter(a => !(a.assetId === asset.assetId && a.ext === asset.ext)))
    } catch (err: any) {
      api.ui.showToast(`删除失败：${String(err?.message || err || '未知错误')}`)
    }
  }, [api, scope])

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

  const visibleAssets = React.useMemo(() => {
    return assets.filter(a => categoryFromKind(a.kind) === category)
  }, [assets, category])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* 标题栏 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>
          附件
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
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

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptString()}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={importing ? <CircularProgress size={16} /> : <AddRoundedIcon />}
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              textTransform: 'none',
              borderRadius: 2,
              borderColor: 'rgba(0,0,0,.16)',
              color: '#333',
              '&:hover': { borderColor: 'rgba(0,0,0,.32)', bgcolor: 'rgba(0,0,0,.02)' },
            }}
          >
            {importing ? '导入中...' : '添加文件'}
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
                api={api}
                asset={asset}
                onDelete={a => void handleDelete(a)}
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
