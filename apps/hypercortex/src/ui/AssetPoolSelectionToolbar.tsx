import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import { FEATURE_TONES, toneHoverActionSx, type HyperCortexToneId } from './uiTones'

export function AssetSelectionToolbar({
  selectedCount,
  selectedVisibleCount,
  hasVisibleAssets,
  allVisibleAssetsSelected,
  activeCategoryTone,
  onSelectVisible,
  onClearSelection,
  onCopySelectedMarkers,
  onDeleteSelected,
  onToggleSelectionMode,
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
  onToggleSelectionMode: () => void
}) {
  const hasSelectedAssets = selectedCount > 0
  const selectionSummaryLabel = selectedVisibleCount ? `已选 ${selectedCount}，当前分类 ${selectedVisibleCount}` : `已选 ${selectedCount}`

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75, flexWrap: 'wrap' }}>
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
        onClick={onToggleSelectionMode}
        sx={{ minWidth: 0, px: 1, borderRadius: 2, textTransform: 'none', color: 'var(--hc-text)', fontWeight: 900, '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' } }}
      >
        取消多选
      </Button>
    </Box>
  )
}
