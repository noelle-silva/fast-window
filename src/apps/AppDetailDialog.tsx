import {
  Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import type { AppStatus, RegisteredApp, RegisteredAppCommand } from './types'
import { isDataImageUrl } from '../utils'

interface AppDetailDialogProps {
  app: RegisteredApp | null
  status?: AppStatus
  onClose: () => void
}

const fieldRowSx = { display: 'grid', gridTemplateColumns: '128px 1fr', gap: 1, py: 0.5 } as const
const labelSx = { color: 'text.secondary', fontSize: 13 } as const
const valueSx = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 } as const

const displayModeLabels: Record<RegisteredApp['displayMode'], string> = {
  default: '默认（置顶，失焦自动隐藏）',
  window: '窗口（普通窗口行为）',
  top: '置顶（不失焦隐藏）',
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} 分钟`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`

  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days} 天 ${restHours} 小时` : `${days} 天`
}

function runningText(status?: AppStatus): string {
  if (!status?.running) return '未运行'
  if (!status.startedAt) return '运行中'
  return `运行中，已运行 ${formatDuration(Date.now() - status.startedAt)}`
}

function windowBoundsText(app: RegisteredApp): string {
  const size = app.windowWidth && app.windowHeight ? `${Math.round(app.windowWidth)} x ${Math.round(app.windowHeight)}` : ''
  const position = app.windowX !== undefined && app.windowY !== undefined ? `(${Math.round(app.windowX)}, ${Math.round(app.windowY)})` : ''
  if (size && position) return `${size} @ ${position}`
  return size || position || '(未记录)'
}

function CommandList({ commands }: { commands?: RegisteredAppCommand[] }) {
  if (!commands?.length) {
    return <Typography sx={valueSx} color="text.secondary">(空)</Typography>
  }

  return (
    <Box component="ul" sx={{ m: 0, pl: 2 }}>
      {commands.map(command => (
        <li key={command.id}>
          <Typography sx={valueSx}>
            {command.title} <Typography component="span" sx={labelSx}>({command.id}{command.hotkey ? `，${command.hotkey}` : ''})</Typography>
          </Typography>
        </li>
      ))}
    </Box>
  )
}

export default function AppDetailDialog({ app, status, onClose }: AppDetailDialogProps) {
  const iconAsImage = app?.icon && isDataImageUrl(app.icon) ? app.icon : undefined

  return (
    <Dialog open={!!app} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        应用详情
        <IconButton
          aria-label="关闭应用详情"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
          size="small"
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {app ? (
          <Box>
            <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', mb: 1.5 }}>
              <Avatar
                variant="rounded"
                src={iconAsImage}
                imgProps={{ alt: app.name || 'app' }}
                sx={{ width: 44, height: 44, fontSize: 22, bgcolor: 'action.hover', color: 'text.primary' }}
              >
                {iconAsImage ? null : app.icon || app.name[0] || 'A'}
              </Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body1" sx={{ fontWeight: 800, lineHeight: 1.2 }} noWrap>
                  {app.name || '(未命名)'}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  v5 独立应用 · {app.id || '(无 ID)'}
                </Typography>
              </Box>
              <Chip
                label={status?.running ? '运行中' : '未运行'}
                size="small"
                color={status?.running ? 'success' : 'default'}
                variant={status?.running ? 'filled' : 'outlined'}
              />
            </Box>

            <Box sx={fieldRowSx}>
              <Typography sx={labelSx}>可执行文件</Typography>
              <Typography sx={{ ...valueSx, wordBreak: 'break-all' }}>{app.path || '(未知)'}</Typography>
            </Box>
            <Box sx={fieldRowSx}>
              <Typography sx={labelSx}>显示模式</Typography>
              <Typography sx={valueSx}>{displayModeLabels[app.displayMode] || app.displayMode}</Typography>
            </Box>
            <Box sx={fieldRowSx}>
              <Typography sx={labelSx}>全局快捷键</Typography>
              <Typography sx={valueSx}>{app.hotkey || '(无)'}</Typography>
            </Box>
            <Box sx={fieldRowSx}>
              <Typography sx={labelSx}>FW 自启</Typography>
              <Typography sx={valueSx}>{app.autoStart ? '开启' : '关闭'}</Typography>
            </Box>
            <Box sx={fieldRowSx}>
              <Typography sx={labelSx}>窗口记忆</Typography>
              <Typography sx={valueSx}>{windowBoundsText(app)}</Typography>
            </Box>
            <Box sx={fieldRowSx}>
              <Typography sx={labelSx}>运行状态</Typography>
              <Typography sx={valueSx}>{runningText(status)}</Typography>
            </Box>
            {status?.pid ? (
              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>进程 PID</Typography>
                <Typography sx={valueSx}>{status.pid}</Typography>
              </Box>
            ) : null}
            {status?.exitCode !== undefined ? (
              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>最近退出码</Typography>
                <Typography sx={valueSx}>{status.exitCode}</Typography>
              </Box>
            ) : null}

            <Box sx={{ mt: 1.25 }}>
              <Typography sx={{ color: 'text.secondary', fontSize: 13, mb: 0.5 }}>已注册命令</Typography>
              <CommandList commands={app.commands} />
            </Box>
            <Box sx={{ mt: 1.25 }}>
              <Typography sx={{ color: 'text.secondary', fontSize: 13, mb: 0.5 }}>应用可用命令</Typography>
              <CommandList commands={app.availableCommands} />
            </Box>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
