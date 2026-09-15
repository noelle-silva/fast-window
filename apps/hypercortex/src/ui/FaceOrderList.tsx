import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import { moveListItem } from '../facePreferences'

type FaceOrderListProps = {
  order: readonly string[]
  labelOf: (id: string) => string
  onReorder: (next: string[]) => void
  disabled?: boolean
}

/** 面顺序列表：上下移动调整顺序，供全局面顺序与笔记级面顺序共用。 */
export function FaceOrderList(props: FaceOrderListProps) {
  const { order, labelOf, onReorder, disabled } = props

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {order.map((id, index) => (
        <Box
          key={id}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: 1.25,
            py: 0.75,
            borderRadius: 2,
            bgcolor: 'var(--hc-surface-soft)',
          }}
        >
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--hc-text)' }}>
            {labelOf(id)}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Tooltip title="上移">
              <span>
                <IconButton
                  size="small"
                  aria-label={`将 ${labelOf(id)} 上移`}
                  disabled={disabled || index === 0}
                  onClick={() => onReorder(moveListItem(order, index, -1))}
                >
                  <ArrowUpwardRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="下移">
              <span>
                <IconButton
                  size="small"
                  aria-label={`将 ${labelOf(id)} 下移`}
                  disabled={disabled || index === order.length - 1}
                  onClick={() => onReorder(moveListItem(order, index, 1))}
                >
                  <ArrowDownwardRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
