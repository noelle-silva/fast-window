import { useState, useEffect } from 'react'
import {
  Box, Typography, IconButton, Dialog, DialogTitle, DialogContent,
  Switch, Button, CircularProgress,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import type { RegisteredApp, AppStatus } from './types'
import { launchApp, stopApp, getAppStatuses } from './appLauncher'
import AppCardView from './AppCardView'

interface AppBackgroundPanelProps {
  apps: RegisteredApp[]
  onClose: () => void
  onUpdateApp: (id: string, patch: Partial<RegisteredApp>) => void
}

export default function AppBackgroundPanel({ apps, onClose, onUpdateApp }: AppBackgroundPanelProps) {
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({})
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  const handleLaunch = async (app: RegisteredApp) => {
    setBusyId(app.id)
    try {
      await launchApp(app, 'toggle')
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

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6, display: 'flex', alignItems: 'center', gap: 1 }}>
        后台管理
        {loading ? <CircularProgress size={14} /> : null}
        <IconButton aria-label="关闭" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} size="small">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {apps.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            暂无注册应用
          </Typography>
        ) : (
          apps.map(app => {
            const status = statuses[app.id]
            return (
              <Box key={app.id} sx={{ mb: 2, p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <AppCardView app={app} status={status} />
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
      </DialogContent>
    </Dialog>
  )
}
