import * as React from 'react'
import { Box, Button, CircularProgress, TextField, Typography } from '@mui/material'
import type { VaultScope } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import type { AssetEntry } from '../assetTypes'
import { assetRefKey } from '../assetTypes'
import { buildAssetEntry } from '../assetEntryModel'
import type { HyperCortexGateway } from '../gateway'
import { revokeAssetBlobUrl } from '../assetBlobUrl'
import { AssetPreviewSurface } from './assetPreview/AssetPreviewSurface'
import { getAssetPreviewDescriptor } from './assetPreview/registry'
import { ImageDialog } from './preview/ImageDialog'
import { usePreviewController } from './preview/usePreviewController'

export function AssetDetailSession({
  gateway,
  scope,
  asset,
  visible,
  onAssetUpdated,
}: {
  gateway: HyperCortexGateway
  scope: VaultScope
  asset: AssetEntry
  visible: boolean
  onAssetUpdated?: (asset: AssetEntry) => void
}) {
  const title = React.useMemo(() => pickAssetDisplayName({ explicitName: asset.displayName, indexName: asset.sourceName || asset.fileName, ext: asset.ext }), [asset.displayName, asset.ext, asset.fileName, asset.sourceName])
  const refText = React.useMemo(() => assetRefKey(asset), [asset.assetId, asset.ext])

  const [blobUrl, setBlobUrl] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [savingMetadata, setSavingMetadata] = React.useState(false)
  const [editDisplayName, setEditDisplayName] = React.useState(asset.displayName || '')
  const [editRemark, setEditRemark] = React.useState(asset.remark || '')
  const [editTags, setEditTags] = React.useState((asset.tags || []).join(', '))
  const preview = React.useMemo(() => getAssetPreviewDescriptor(asset), [asset])
  const imagePreview = usePreviewController({ toast: gateway.host.toast })

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = await gateway.assets.getAssetBlobUrl(scope, asset.assetId, asset.ext)
      setBlobUrl(url)
    } catch (e: any) {
      setError(String(e?.message || e || '加载失败'))
    } finally {
      setLoading(false)
    }
  }, [gateway, asset.assetId, asset.ext, scope])

  React.useEffect(() => {
    if (!visible) return
    void load()
  }, [load, visible])

  React.useEffect(() => {
    return () => revokeAssetBlobUrl(asset.assetId, asset.ext)
  }, [asset.assetId, asset.ext])

  React.useEffect(() => {
    setEditDisplayName(asset.displayName || '')
    setEditRemark(asset.remark || '')
    setEditTags((asset.tags || []).join(', '))
  }, [asset.assetId, asset.displayName, asset.ext, asset.remark, asset.tags])

  const metadataDirty = editDisplayName !== (asset.displayName || '') || editRemark !== (asset.remark || '') || editTags !== (asset.tags || []).join(', ')

  const saveMetadata = React.useCallback(async () => {
    if (savingMetadata) return
    setSavingMetadata(true)
    try {
      const updated = await gateway.assets.updateAssetMetadata(scope, asset.assetId, asset.ext, {
        displayName: editDisplayName,
        remark: editRemark,
        tags: editTags.split(/[，,]/g).map(tag => tag.trim()).filter(Boolean),
      })
      onAssetUpdated?.(buildAssetEntry(updated))
      void gateway.host.toast('附件信息已保存')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '保存附件信息失败'))
    } finally {
      setSavingMetadata(false)
    }
  }, [asset.assetId, asset.ext, editDisplayName, editRemark, editTags, gateway, onAssetUpdated, savingMetadata, scope])

  const Icon = preview.icon

  return (
    <>
      <Box
        sx={{
          display: visible ? 'flex' : 'none',
          flex: 1,
          minHeight: 0,
          flexDirection: 'column',
          gap: 1.25,
          p: 2,
          boxSizing: 'border-box',
          overflow: 'auto',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box sx={{ color: preview.color, display: 'inline-flex', alignItems: 'center' }}><Icon fontSize="small" /></Box>
            <Typography noWrap sx={{ fontSize: 18, fontWeight: 900, color: '#111', minWidth: 0 }}>
              {title}
            </Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={() => void load()} disabled={loading} sx={{ borderRadius: 2, textTransform: 'none' }}>
            刷新
          </Button>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 340px) 1fr' }, gap: 1.5, minHeight: 0 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.25, borderRadius: 3, bgcolor: 'rgba(255,255,255,.72)', border: '1px solid rgba(15,23,42,.08)' }}>
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{refText}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
              <MetaPill label="大小" value={humanAssetSize(asset.size)} />
              <MetaPill label="上传" value={formatAssetDate(asset.uploadedAtMs)} />
              <MetaPill label="类型" value={asset.mime || asset.kind || '未知'} />
              <MetaPill label="修改" value={formatAssetDate(asset.modifiedMs)} />
            </Box>
            <TextField label="显示名" size="small" value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} inputProps={{ maxLength: 180 }} />
            <TextField label="备注" multiline minRows={4} value={editRemark} onChange={e => setEditRemark(e.target.value)} inputProps={{ maxLength: 2000 }} />
            <TextField label="标签" size="small" value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="用逗号分隔" />
            <Button variant="contained" size="small" onClick={() => void saveMetadata()} disabled={!metadataDirty || savingMetadata} sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 900 }}>
              {savingMetadata ? '保存中...' : '保存附件信息'}
            </Button>
          </Box>

          <Box
            sx={{
              minHeight: 360,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 3,
              bgcolor: 'rgba(0,0,0,.03)',
              overflow: 'hidden',
            }}
          >
            {error ? (
              <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                <Typography color="error" sx={{ fontSize: 13 }}>
                  {error}
                </Typography>
                <Button variant="contained" size="small" onClick={() => void load()} sx={{ borderRadius: 2, textTransform: 'none' }}>
                  重试
                </Button>
              </Box>
            ) : loading && !blobUrl ? (
              <CircularProgress size={20} />
            ) : preview.canOpenInTab && blobUrl ? (
              <AssetPreviewSurface asset={asset} blobUrl={blobUrl} title={title} previewController={imagePreview.controller} />
            ) : (
              <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>暂不支持预览该类型附件。</Typography>
            )}
          </Box>
        </Box>
      </Box>
      <ImageDialog open={imagePreview.modal === 'image'} controller={imagePreview.controller} viewer={imagePreview.imageViewer} />
    </>
  )
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ px: 1, py: 0.75, borderRadius: 2, bgcolor: 'rgba(15,23,42,.04)' }}>
      <Typography sx={{ fontSize: 10, color: 'rgba(15,23,42,.45)', fontWeight: 800 }}>{label}</Typography>
      <Typography sx={{ mt: 0.25, fontSize: 12, color: '#0f172a', fontWeight: 900, wordBreak: 'break-word' }}>{value}</Typography>
    </Box>
  )
}

function humanAssetSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatAssetDate(ms: number | undefined): string {
  const n = Number(ms || 0)
  if (!Number.isFinite(n) || n <= 0) return '未知'
  return new Date(n).toLocaleString()
}
