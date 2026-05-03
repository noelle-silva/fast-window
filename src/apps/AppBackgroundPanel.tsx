import { useState, useEffect } from 'react'
import {
  Box, Typography, IconButton, Dialog, DialogTitle, DialogContent,
  Switch, Button, CircularProgress,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import type { RegisteredApp, RegisteredAppUpdatePatch, AppStatus } from './types'
import { launchApp, stopApp, getAppStatuses } from './appLauncher'
import AppCardView from './AppCardView'

interface AppBackgroundPanelProps {
  apps: RegisteredApp[]
  onClose?: () => void
  onUpdateApp: (id: string, patch: RegisteredAppUpdatePatch) => void
  embedded?: boolean
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

function runningDurationText(status: AppStatus | undefined, now: number): string | null {
  if (!status?.running || !status.startedAt) return null
  return `已运行 ${formatDuration(now - status.startedAt)}`
}

export default function AppBackgroundPanel({ apps, onClose, onUpdateApp, embedded }: AppBackgroundPanelProps) {
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({})
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const refresh = async () => {
    if (apps.length === 0) return
    setLoading(true)
    try {
      const result = await getAppStatuses(apps.map(a => a.id))
      setStatuses(result)
    } catch (e) {
      console.warn('[app] status refresh failed:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps.length])

  useEffect(() => {
    const hasRunningApp = Object.values(statuses).some(status => status.running && status.startedAt)
    if (!hasRunningApp) return

    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    setNow(Date.now())
    return () => window.clearInterval(timer)
  }, [statuses])

  const handleLaunch = async (app: RegisteredApp) => {
    setBusyId(app.id)
    try {
      await launchApp(app, 'show')
    } catch (e) {
      console.error('[app] launch failed:', e)
    }
    setTimeout(refresh, 500)
    setBusyId(null)
  }

  const handleStop = async (id: string) => {
    setBusyId(id)
    try {
      await stopApp(id)
    } catch (e) {
      console.error('[app] stop failed:', e)
    }
    setTimeout(refresh, 500)
    setBusyId(null)
  }

  const content = (
    <>
      {embedded ? (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1.25 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                应用后台
              </Typography>
              {loading ? <CircularProgress size={14} /> : null}
            </Box>
            <Typography variant="caption" color="text.secondary">
              查看 v5 独立应用运行状态，启动、唤醒、停止或设置 FW 启动时自启。
            </Typography>
          </Box>
          <Button size="small" variant="outlined" onClick={refresh} disabled={loading || apps.length === 0} sx={{ flexShrink: 0 }}>
            刷新
          </Button>
        </Box>
      ) : null}

      <Box>
        {apps.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            暂无注册应用
          </Typography>
        ) : (
          apps.map(app => {
            const status = statuses[app.id]
            const durationText = runningDurationText(status, now)
            return (
              <Box key={app.id} sx={{ mb: 2, p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <AppCardView app={app} status={status} />
                {durationText ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.25, mt: -0.5 }}>
                    {durationText}
                  </Typography>
                ) : null}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleLaunch(app)}
                      disabled={busyId === app.id}
                    >
                      {status?.running ? '唤醒' : '启动'}
                    </Button>
                    {status?.running ? (
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => handleStop(app.id)}
                        disabled={busyId === app.id}
                      >
                        停止
                      </Button>
                    ) : null}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">自启</Typography>
                    <Switch
                      size="small"
                      checked={app.autoStart}
                      onChange={(_, v) => onUpdateApp(app.id, { autoStart: v })}
                    />
                  </Box>
                </Box>
              </Box>
            )
          })
        )}
      </Box>
    </>
  )

  if (embedded) {
    return <Box>{content}</Box>
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6, display: 'flex', alignItems: 'center', gap: 1 }}>
        后台管理
        {loading ? <CircularProgress size={14} /> : null}
        <IconButton aria-label="关闭" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} size="small">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>{content}</DialogContent>
    </Dialog>
  )
}
