import * as React from 'react'
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import type { VaultScope } from '../core'
import { pickAssetDisplayName } from '../assetDisplayName'
import type { AssetEntry } from '../assetTypes'
import { buildAssetEntry } from '../assetEntryModel'
import type { HyperCortexGateway } from '../gateway'
import { revokeAssetBlobUrl } from '../assetBlobUrl'
import { AssetPreviewSurface } from './assetPreview/AssetPreviewSurface'
import { getAssetPreviewDescriptor } from './assetPreview/registry'
import { ImageDialog } from './preview/ImageDialog'
import { usePreviewController } from './preview/usePreviewController'
import { AssetInfoSidebar } from './AssetInfoSidebar'

export function AssetDetailSession({
  gateway,
  scope,
  asset,
  visible,
  onAssetUpdated,
  onPlayingChange,
}: {
  gateway: HyperCortexGateway
  scope: VaultScope
  asset: AssetEntry
  visible: boolean
  onAssetUpdated?: (asset: AssetEntry) => void
  onPlayingChange?: (playing: boolean) => void
}) {
  const title = React.useMemo(() => pickAssetDisplayName({ explicitName: asset.displayName, indexName: asset.sourceName || asset.fileName, ext: asset.ext }), [asset.displayName, asset.ext, asset.fileName, asset.sourceName])

  const [blobUrl, setBlobUrl] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [infoSidebarVisible, setInfoSidebarVisible] = React.useState(false)
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
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Button variant="outlined" size="small" onClick={() => void load()} disabled={loading} sx={{ borderRadius: 2, textTransform: 'none' }}>
              刷新
            </Button>
            <Tooltip title={infoSidebarVisible ? '隐藏信息侧栏' : '显示信息侧栏'} placement="bottom-end">
              <IconButton
                size="small"
                aria-label="附件信息"
                onClick={() => setInfoSidebarVisible(prev => !prev)}
                sx={{
                  color: infoSidebarVisible ? '#111' : 'rgba(0,0,0,.58)',
                  bgcolor: infoSidebarVisible ? 'rgba(0,0,0,.06)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
                }}
              >
                <InfoRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0, gap: 2, alignItems: 'stretch' }}>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
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
              <AssetPreviewSurface asset={asset} blobUrl={blobUrl} title={title} previewController={imagePreview.controller} onPlayingChange={onPlayingChange} />
            ) : (
              <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>暂不支持预览该类型附件。</Typography>
            )}
          </Box>

          {infoSidebarVisible ? (
            <Box sx={{ flex: '0 0 280px', width: 280, minWidth: 280, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>
              <AssetInfoSidebar
                asset={asset}
                displayName={editDisplayName}
                remark={editRemark}
                tagsText={editTags}
                saving={savingMetadata}
                dirty={metadataDirty}
                onDisplayNameChange={setEditDisplayName}
                onRemarkChange={setEditRemark}
                onTagsTextChange={setEditTags}
                onSave={() => void saveMetadata()}
              />
            </Box>
          ) : null}
        </Box>
      </Box>
      <ImageDialog open={imagePreview.modal === 'image'} controller={imagePreview.controller} viewer={imagePreview.imageViewer} />
    </>
  )
}
