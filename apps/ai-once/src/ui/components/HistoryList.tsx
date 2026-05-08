import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import { Box, ButtonBase, Chip, Stack, Typography } from '@mui/material'
import { formatDateTime } from '../../shared/aiOnceDomain'
import type { HistoryEntry } from '../../types'
import type { AiOnceController } from '../hooks/useAiOnceController'

type HistoryListProps = {
  controller: AiOnceController
  limit?: number
}

export function HistoryList(props: HistoryListProps) {
  const { controller, limit = 16 } = props
  const visible = controller.state.history.slice(0, limit)

  if (!visible.length) {
    return (
      <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', color: 'text.secondary', textAlign: 'center' }}>
        <Typography variant="body2">还没有历史记录</Typography>
      </Box>
    )
  }

  return (
    <Stack spacing={0.75}>
      {visible.map(entry => (
        <ButtonBase
          key={entry.id}
          onClick={() => controller.loadHistoryEntry(entry)}
          sx={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            borderRadius: 2,
            p: 1,
            bgcolor: 'background.paper',
            boxShadow: 'inset 0 0 0 1px rgba(100, 116, 139, 0.14)',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.input || `${entry.images.length} 张图片`}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
              <Chip size="small" icon={entry.images.length ? <ImageRoundedIcon fontSize="small" /> : <HistoryRoundedIcon fontSize="small" />} label={entry.model || '未记录模型'} />
              <Typography variant="caption" color={entry.error ? 'error' : 'text.secondary'}>
                {entry.error ? `失败：${entry.error}` : formatDateTime(entry.createdAt)}
              </Typography>
            </Stack>
          </Stack>
        </ButtonBase>
      ))}
    </Stack>
  )
}
