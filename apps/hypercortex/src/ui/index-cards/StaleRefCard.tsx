import * as React from 'react'
import { Box, Typography } from '@mui/material'
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded'
import type { FavoriteItemRef } from '../../favorites'
import { CardFrame } from './CardFrame'

type Props = {
  ref: FavoriteItemRef
  disabled?: boolean
  compact?: boolean
  onClickRemove: (refId: string) => void
}

export function StaleRefCard(props: Props): React.ReactNode {
  const { ref, disabled, compact = false, onClickRemove } = props

  return (
    <CardFrame
      danger
      icon={<LinkOffRoundedIcon fontSize="small" />}
      title="已失效的引用"
      subtitle={`目标 ${ref.kind} 已不存在，建议尽快清理这张卡片。`}
      meta="失效"
      onClick={disabled ? undefined : () => onClickRemove(ref.id)}
    >
      {compact ? null : (
        <Box sx={{ px: 1, py: 0.7, borderRadius: 2.5, bgcolor: 'var(--hc-danger-soft)' }}>
          <Typography sx={{ fontSize: 12, lineHeight: 1.5, fontWeight: 700, color: 'var(--hc-danger)' }}>点击卡片即可从当前收藏夹中移除这条引用。</Typography>
        </Box>
      )}
    </CardFrame>
  )
}
