import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined'
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { Box, Button, Card, CardContent, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import type { QuickRun } from '../types'

type QuickRunCardProps = {
  quickRun: QuickRun
  commandNames: string[]
  repoCount: number
  disabled?: boolean
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
}

const PREVIEW_LIMIT = 3

export function QuickRunCard({ quickRun, commandNames, repoCount, disabled = false, onRun, onEdit, onDelete }: QuickRunCardProps) {
  const count = commandNames.length
  const preview = count > 0
    ? commandNames.slice(0, PREVIEW_LIMIT).join(' · ') + (count > PREVIEW_LIMIT ? ` 等 ${count} 条` : '')
    : '没有可用命令，请编辑重新选择'

  return (
    <Card className="cr-repo-card" sx={{ position: 'relative' }}>
      <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 32, height: 32, flex: '0 0 auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'warning.main', bgcolor: 'rgba(237, 108, 2, 0.12)' }}>
            <BoltOutlinedIcon sx={{ fontSize: 18 }} />
          </Box>
          <Typography component="h2" sx={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 900 }} noWrap>{quickRun.name}</Typography>
          <Tooltip title="编辑">
            <IconButton size="small" aria-label="编辑快捷运行" disabled={disabled} onClick={onEdit}>
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="删除">
            <IconButton size="small" aria-label="删除快捷运行" disabled={disabled} onClick={onDelete}>
              <DeleteOutlineOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          <Chip size="small" label={`${count} 条命令`} sx={{ fontWeight: 800 }} />
          <Chip size="small" label={`${repoCount} 个仓库`} sx={{ fontWeight: 800 }} />
        </Box>
        <Typography
          color={count > 0 ? 'text.secondary' : 'warning.main'}
          noWrap
          sx={{ width: '100%', fontSize: 12, lineHeight: 1.5 }}
        >
          {preview}
        </Typography>
        <Box sx={{ mt: 'auto', pt: 0.5, width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<PlayArrowIcon fontSize="small" />}
            disabled={disabled || count === 0}
            onClick={onRun}
          >
            运行
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}
