import * as React from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'

import type { VaultScope } from '../../core'
import type { AssetEntry } from '../../assetTypes'
import type { HyperCortexGateway } from '../../gateway'
import { pickAssetDisplayName } from '../../assetDisplayName'
import { AssetPreviewSurface } from '../assetPreview/AssetPreviewSurface'
import { getAssetPreviewDescriptor } from '../assetPreview/registry'
import type { ImageViewController } from '../preview/useImageViewerController'

/** 预览专用的空图片查看器：预览不打开大图浮层，不产生任何现场副作用。 */
const NOOP_IMAGE_CONTROLLER: ImageViewController = {
  toast: () => {},
  actions: {
    closeModal: () => {},
    openImageViewer: () => {},
    imagePrev: () => {},
    imageNext: () => {},
    imageSetScale: () => {},
  },
}

/** 附件预览面：只读加载附件并渲染与附件标签页同源的预览视窗。 */
export function AssetPreviewPane(props: {
  gateway: HyperCortexGateway
  scope: VaultScope
  asset: AssetEntry
}): React.ReactNode {
  const { gateway, scope, asset } = props
  const [blobUrl, setBlobUrl] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [toolbarHost, setToolbarHost] = React.useState<HTMLDivElement | null>(null)
  const toolbarHostRef = React.useRef<HTMLDivElement | null>(null)
  const title = React.useMemo(
    () => pickAssetDisplayName({ explicitName: asset.displayName, indexName: asset.sourceName || asset.fileName, ext: asset.ext }),
    [asset.displayName, asset.ext, asset.fileName, asset.sourceName],
  )
  const preview = React.useMemo(() => getAssetPreviewDescriptor(asset), [asset])
  const showToolbarSlot = preview.toolbarSlot === 'header'
  // 元素替换检测：渲染后对比引用，仅在真实挂载/卸载时同步状态。
  React.useEffect(() => {
    const node = toolbarHostRef.current
    if (node !== toolbarHost) setToolbarHost(node)
  })

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setBlobUrl('')
    void gateway.assets
      .getAssetBlobUrl(scope, asset.assetId, asset.ext)
      .then(url => {
        if (!cancelled) setBlobUrl(url)
      })
      .catch((e: any) => {
        if (!cancelled) setError(String(e?.message || e || '加载附件失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [asset.assetId, asset.ext, gateway, scope])

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={22} />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Typography color="error" sx={{ fontSize: 13 }}>{error}</Typography>
      </Box>
    )
  }

  if (!preview.canOpenInTab || !blobUrl) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Typography sx={{ fontSize: 13, color: 'var(--hc-text-muted)' }}>暂不支持预览该类型附件。</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {showToolbarSlot ? (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', px: 1, py: 0.5 }}>
          <Box ref={toolbarHostRef} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0, flex: 1 }} />
        </Box>
      ) : null}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', bgcolor: 'rgba(0,0,0,.03)' }}>
        <AssetPreviewSurface asset={asset} blobUrl={blobUrl} title={title} previewController={NOOP_IMAGE_CONTROLLER} toolbarHost={toolbarHost} />
      </Box>
    </Box>
  )
}
