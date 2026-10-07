import * as React from 'react'
import { Box, Checkbox, IconButton, Tooltip, Typography } from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import ImageSearchRoundedIcon from '@mui/icons-material/ImageSearchRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import { type AssetEntry } from '../assetTypes'
import { pickAssetDisplayName } from '../assetDisplayName'
import { buildAssetMarker } from '../assetMarker'
import { canAssetHaveThumbnail } from '../assetThumbnailCapabilities'
import { getAssetPreviewDescriptor, isAssetOpenableInTab } from './assetPreview/registry'
import { EntityIcon } from './entity-icon/EntityIcon'
import type { HyperCortexGateway } from '../gateway'
import { assetToneFromKind, toneChipSx } from './uiTones'

/* ------------------------------------------------------------------ */
/*  工具函数                                                           */
/* ------------------------------------------------------------------ */

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* ------------------------------------------------------------------ */
/*  组件                                                               */
/* ------------------------------------------------------------------ */

export function canHaveThumbnail(asset: Pick<AssetEntry, 'kind' | 'ext'>): boolean {
  return canAssetHaveThumbnail(asset)
}

export function AssetCard({
  gateway,
  asset,
  selectionMode,
  selected,
  picked,
  onPick,
  onDelete,
  onToggleSelected,
  onRebuildThumbnail,
  onThumbnailLoadError,
  onOpenAsset,
}: {
  gateway: HyperCortexGateway
  asset: AssetEntry
  selectionMode: boolean
  selected: boolean
  picked: boolean
  onPick?: (asset: AssetEntry) => void
  onDelete: (asset: AssetEntry) => void
  onToggleSelected: (asset: AssetEntry) => void
  onRebuildThumbnail: (asset: AssetEntry) => void
  onThumbnailLoadError: (asset: AssetEntry, message: string) => void
  onOpenAsset?: (asset: AssetEntry) => void
}) {
  const titleLabel = pickAssetDisplayName({ indexName: asset.displayName, sourceName: asset.sourceName, ext: asset.ext })
  const preview = React.useMemo(() => getAssetPreviewDescriptor(asset), [asset])
  const tone = assetToneFromKind(asset.kind)
  const canOpenPreview = isAssetOpenableInTab(asset)
  const interactive = selectionMode || picked ? false : Boolean(onPick) || canOpenPreview
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
      role={selectionMode ? 'checkbox' : onPick && !picked ? 'button' : canOpenPreview ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={selectionMode ? `${selected ? '取消选择' : '选择'}附件：${titleLabel}` : onPick ? `添加附件：${titleLabel}` : canOpenPreview ? `打开附件：${titleLabel}` : undefined}
      aria-checked={selectionMode ? selected : undefined}
      onClick={() => {
        if (selectionMode) {
          onToggleSelected(asset)
          return
        }
        if (picked) return
        if (onPick) {
          onPick(asset)
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
        if (onPick) {
          onPick(asset)
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
        opacity: picked ? 0.55 : 1,
        '&:hover': {
          bgcolor: 'var(--hc-surface-soft)',
          boxShadow: '0 6px 16px rgba(0,0,0,.08)',
          transform: 'translateY(-1px)',
        },
        '&:focus-visible': interactive ? { boxShadow: selectedInMode ? '0 0 0 2px var(--hc-primary), 0 10px 24px var(--hc-shadow)' : '0 10px 24px var(--hc-shadow)' } : undefined,
        '&:hover .hc-asset-card-actions': selectionMode || onPick ? undefined : { opacity: 1 },
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

      {picked ? (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
            px: 0.8,
            py: 0.3,
            borderRadius: 999,
            bgcolor: 'var(--hc-surface)',
            boxShadow: '0 1px 4px rgba(0,0,0,.08)',
          }}
        >
          <Typography sx={{ fontSize: 11, lineHeight: 1, fontWeight: 800, color: 'var(--hc-text-subtle)' }}>已添加</Typography>
        </Box>
      ) : null}

      {!selectionMode && !onPick ? (
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
        {asset.thumbnailUrl ? (
          <Box
            component="img"
            src={asset.thumbnailUrl}
            alt=""
            onError={() => onThumbnailLoadError(asset, '缩略图图片加载失败：生成的数据无法被浏览器作为图片渲染')}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : asset.thumbnailError ? (
          <Tooltip title={asset.thumbnailError} placement="top">
            <Box
              sx={{
                width: '100%',
                height: '100%',
                px: 1.5,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.75,
                color: 'var(--hc-danger)',
                bgcolor: 'var(--hc-danger-soft)',
                textAlign: 'center',
              }}
            >
              <ErrorOutlineRoundedIcon sx={{ fontSize: 24 }} />
              <Typography sx={{ fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>
                缩略图生成失败
              </Typography>
              <Typography sx={{ fontSize: 9.5, fontWeight: 700, lineHeight: 1.3, color: 'rgba(127,29,29,.72)', maxWidth: 230 }}>
                {asset.thumbnailError}
              </Typography>
            </Box>
          </Tooltip>
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
            <EntityIcon icon={asset.icon} fallback={<Icon fontSize="medium" />} targetKind="asset" targetRef={asset.assetId} size={40} />
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
