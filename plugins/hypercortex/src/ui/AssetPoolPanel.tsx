import * as React from 'react'
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import AudioFileRoundedIcon from '@mui/icons-material/AudioFileRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import { type Api, type VaultScope, acceptString, kindFromMime, mimeFromExt } from '../core'
import { importFilesToAssetPool, listAssetsInPool, readAssetAsDataUrl } from '../assetPool'
import type { HyperCortexNoteResourceRef } from '../noteSchema'

/* ------------------------------------------------------------------ */
/*  类型                                                               */
/* ------------------------------------------------------------------ */

type AssetEntry = {
  fileName: string
  assetId: string
  ext: string
  kind: string
  size: number
  modifiedMs: number
  thumbnailUrl?: string
}

type Props = {
  api: Api
  scope: VaultScope
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

function kindIcon(kind: string) {
  if (kind === 'image') return <ImageRoundedIcon fontSize="small" />
  if (kind === 'audio') return <AudioFileRoundedIcon fontSize="small" />
  if (kind === 'video') return <VideoFileRoundedIcon fontSize="small" />
  return <InsertDriveFileRoundedIcon fontSize="small" />
}

function kindColor(kind: string): string {
  if (kind === 'image') return '#1976d2'
  if (kind === 'audio') return '#e65100'
  if (kind === 'video') return '#7b1fa2'
  return '#546e7a'
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/* ------------------------------------------------------------------ */
/*  组件                                                               */
/* ------------------------------------------------------------------ */

export function AssetPoolPanel({ api, scope }: Props) {
  const [assets, setAssets] = React.useState<AssetEntry[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [importing, setImporting] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  /* ---- 加载资源列表 ---- */
  const loadAssets = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const items = await listAssetsInPool(api, scope)
      const entries: AssetEntry[] = items
        .filter(item => item.isFile)
        .map(item => {
          const { assetId, ext } = parseAssetFileName(item.name)
          const mime = mimeFromExt(ext)
          const kind = mime ? kindFromMime(mime) : 'document'
          return { fileName: item.name, assetId, ext, kind, size: item.size, modifiedMs: item.modifiedMs }
        })
        .sort((a, b) => b.modifiedMs - a.modifiedMs)
      setAssets(entries)
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
  }, [api, scope, assets.length])

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
      await api.files.delete({ scope, path: `Assets/${asset.fileName}` })
      api.ui.showToast('已删除')
      setAssets(prev => prev.filter(a => a.assetId !== asset.assetId))
    } catch (err: any) {
      api.ui.showToast(`删除失败：${String(err?.message || err || '未知错误')}`)
    }
  }, [api, scope])

  /* ---- 渲染 ---- */

  const statsByKind = React.useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of assets) {
      map[a.kind] = (map[a.kind] || 0) + 1
    }
    return map
  }, [assets])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* 标题栏 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>
          资源池
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
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
        </Box>
      </Box>

      {/* 统计 */}
      {!loading && assets.length > 0 ? (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {Object.entries(statsByKind).map(([kind, count]) => (
            <Box
              key={kind}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderRadius: 1,
                bgcolor: 'rgba(0,0,0,.04)',
                fontSize: 12,
                color: kindColor(kind),
              }}
            >
              {kindIcon(kind)}
              <span>{kind} {count}</span>
            </Box>
          ))}
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.38)', alignSelf: 'center' }}>
            共 {assets.length} 个资源，{humanSize(assets.reduce((s, a) => s + a.size, 0))}
          </Typography>
        </Box>
      ) : null}

      {/* 添加按钮 */}
      <Box>
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

      {/* 状态提示 */}
      {loading ? <Typography color="text.secondary">正在加载资源池...</Typography> : null}
      {!loading && error ? <Typography color="error">{error}</Typography> : null}
      {!loading && !error && assets.length === 0 ? (
        <Typography color="text.secondary">资源池为空，点击「添加文件」导入第一个资源。</Typography>
      ) : null}

      {/* 资源列表 */}
      {!loading && !error && assets.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {assets.map(asset => (
            <Box
              key={asset.assetId}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 1,
                borderRadius: 2,
                border: '1px solid rgba(0,0,0,.08)',
                transition: 'border-color .16s ease, box-shadow .16s ease',
                '&:hover': {
                  borderColor: 'rgba(0,0,0,.18)',
                  boxShadow: '0 1px 4px rgba(0,0,0,.06)',
                },
              }}
            >
              {/* 缩略图 or 图标 */}
              {asset.kind === 'image' && asset.thumbnailUrl ? (
                <Box
                  component="img"
                  src={asset.thumbnailUrl}
                  alt=""
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1,
                    objectFit: 'cover',
                    flexShrink: 0,
                    bgcolor: 'rgba(0,0,0,.04)',
                  }}
                />
              ) : (
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    bgcolor: 'rgba(0,0,0,.04)',
                    color: kindColor(asset.kind),
                  }}
                >
                  {kindIcon(asset.kind)}
                </Box>
              )}

              {/* 文件信息 */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#222',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {asset.ext ? `.${asset.ext}` : '文件'}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 11,
                    color: 'rgba(0,0,0,.42)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'monospace',
                  }}
                >
                  {asset.assetId.slice(0, 12)}…
                </Typography>
              </Box>

              {/* 大小 */}
              <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.38)', flexShrink: 0 }}>
                {humanSize(asset.size)}
              </Typography>

              {/* 复制引用 */}
              <Tooltip title="复制引用标记" placement="bottom">
                <IconButton
                  size="small"
                  aria-label="复制引用标记"
                  onClick={() => {
                    const ref = asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
                    const defaultWidth = asset.kind === 'image' ? 320 : asset.kind === 'video' ? 480 : 0
                    const marker = defaultWidth
                      ? `{{asset:${ref}||${defaultWidth}}}`
                      : `{{asset:${ref}}}`
                    api.clipboard.writeText(marker).then(
                      () => api.ui.showToast('已复制'),
                      () => api.ui.showToast('复制失败'),
                    )
                  }}
                  sx={{
                    color: 'rgba(0,0,0,.3)',
                    '&:hover': { color: '#1976d2', bgcolor: 'rgba(25,118,210,.06)' },
                  }}
                >
                  <ContentCopyRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>

              {/* 删除 */}
              <Tooltip title="删除" placement="left">
                <IconButton
                  size="small"
                  aria-label="删除"
                  onClick={() => void handleDelete(asset)}
                  sx={{
                    color: 'rgba(0,0,0,.3)',
                    '&:hover': { color: '#d32f2f', bgcolor: 'rgba(211,47,47,.06)' },
                  }}
                >
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
