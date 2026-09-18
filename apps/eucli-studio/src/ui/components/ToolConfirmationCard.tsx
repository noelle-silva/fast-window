import * as React from 'react'
import { Box, Button, Chip, Collapse, Paper, Stack, Typography } from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { ToolConfirmationInfo } from '../../domain/toolConfirmation'
import { CustomScrollArea } from './CustomScrollArea'

type ToolConfirmationCardProps = {
  info: ToolConfirmationInfo
  disabled?: boolean
  submitting?: boolean
  onDecision?: (approved: boolean) => void | Promise<void>
}

export function ToolConfirmationCard(props: ToolConfirmationCardProps) {
  const { info, disabled, submitting, onDecision } = props
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const actionDisabled = !!disabled || !!submitting || !info.pending

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 3,
        overflow: 'hidden',
        borderColor: 'rgba(217,119,6,.34)',
        background: 'rgba(255,251,235,.96)',
      }}
    >
      <Box sx={{ px: 1.35, py: 1.15 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Box
            aria-hidden="true"
            sx={{
              width: 34,
              height: 34,
              borderRadius: '12px',
              display: 'grid',
              placeItems: 'center',
              color: '#b45309',
              bgcolor: 'rgba(245,158,11,.16)',
              fontWeight: 900,
            }}
          >
            ?
          </Box>
          <Stack spacing={0.15} sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 950, color: '#78350f' }} noWrap>
              工具需要确认：{info.toolName}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }} noWrap>
              {info.reason || '该工具被设置为运行前询问。'}
            </Typography>
          </Stack>
          <Chip size="small" label={info.pending ? '等待确认' : '已处理'} color={info.pending ? 'warning' : 'default'} variant="outlined" />
        </Stack>

        <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap' }}>
          <Chip size="small" label={`状态：${info.decisionStatus || info.state || '未知'}`} variant="outlined" />
          <Button
            size="small"
            variant="text"
            endIcon={detailsOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            onClick={() => setDetailsOpen((value) => !value)}
            sx={{ minWidth: 0, borderRadius: 2 }}
          >
            详情
          </Button>
          <Box sx={{ flex: 1, minWidth: 8 }} />
          <Button
            size="small"
            color="inherit"
            variant="outlined"
            startIcon={<BlockOutlinedIcon fontSize="small" />}
            disabled={actionDisabled}
            onClick={() => onDecision?.(false)}
            sx={{ borderRadius: 2 }}
          >
            拒绝
          </Button>
          <Button
            size="small"
            color="warning"
            variant="contained"
            startIcon={<CheckCircleOutlineIcon fontSize="small" />}
            disabled={actionDisabled}
            onClick={() => onDecision?.(true)}
            sx={{ borderRadius: 2, fontWeight: 900 }}
          >
            {submitting ? '提交中' : '同意'}
          </Button>
        </Stack>

        <Collapse in={detailsOpen} timeout={160} unmountOnExit>
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {info.rawText.trim() ? (
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 900, color: '#92400e' }}>
                  原始请求
                </Typography>
                <CustomScrollArea hostSx={{ mt: 0.35, borderRadius: 2, bgcolor: 'rgba(255,255,255,.78)' }}>
                  <Box component="pre" sx={{ m: 0, p: 1, fontSize: 12 }}>
                    {info.rawText}
                  </Box>
                </CustomScrollArea>
              </Box>
            ) : null}
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 900, color: '#92400e' }}>
                输入参数
              </Typography>
              <CustomScrollArea hostSx={{ mt: 0.35, borderRadius: 2, bgcolor: 'rgba(255,255,255,.78)' }}>
                <Box component="pre" sx={{ m: 0, p: 1, fontSize: 12 }}>
                  {info.inputText}
                </Box>
              </CustomScrollArea>
            </Box>
          </Stack>
        </Collapse>
      </Box>
    </Paper>
  )
}
