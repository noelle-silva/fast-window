import * as React from 'react'
import { Box, Button, IconButton, InputBase, Switch, Tooltip, Typography } from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

export function TrashSettingsPanel(props: {
  enabled: boolean
  autoDeleteDays: number
  onEnabledChange: (enabled: boolean) => void
  onAutoDeleteDaysChange: (days: number) => void
  onOpenTrash: () => void
}) {
  const { enabled, autoDeleteDays, onEnabledChange, onAutoDeleteDaysChange, onOpenTrash } = props
  const [daysText, setDaysText] = React.useState(String(autoDeleteDays))

  React.useEffect(() => {
    setDaysText(String(autoDeleteDays))
  }, [autoDeleteDays])

  const commitDays = React.useCallback(() => {
    onAutoDeleteDaysChange(clampInt(daysText, 30, 0, 3650))
  }, [daysText, onAutoDeleteDaysChange])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>回收站</Typography>
          <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
            启用后，删除笔记会先移入回收站；关闭后则直接永久删除（不可恢复）。
          </Typography>
        </Box>

        <Tooltip title="打开回收站" placement="left">
          <IconButton size="small" aria-label="打开回收站" onClick={onOpenTrash}>
            <DeleteRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.75, borderRadius: 2, bgcolor: 'rgba(0,0,0,.02)' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#111' }}>启用回收站</Typography>
        <Switch checked={enabled} onChange={(_, checked) => onEnabledChange(checked)} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', alignItems: 'center', gap: 1, px: 1, py: 0.75, borderRadius: 2, bgcolor: 'rgba(0,0,0,.02)' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#111' }}>自动清理（天）</Typography>
        <InputBase
          value={daysText}
          onChange={e => setDaysText(e.target.value)}
          onBlur={commitDays}
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            commitDays()
          }}
          placeholder="例如：30；填 0 表示不自动清理"
          inputProps={{ inputMode: 'numeric', 'aria-label': '回收站自动清理天数' }}
          sx={{
            px: 1,
            py: 0.6,
            borderRadius: 2,
            bgcolor: '#fff',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.10)',
            fontSize: 13,
          }}
        />
        <Button size="small" variant="outlined" onClick={commitDays}>
          保存
        </Button>
      </Box>
    </Box>
  )
}

