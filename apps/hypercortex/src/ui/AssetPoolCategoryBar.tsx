import * as React from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import { toneTabSx, type HyperCortexToneId } from './uiTones'

export type AssetCategory = 'image' | 'video' | 'document'

export function AssetCategoryBar({
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
