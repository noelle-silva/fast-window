import { Box, Typography, Button, CircularProgress } from '@mui/material'
import type { RegisteredApp, AppStatus } from './types'
import { launchApp } from './appLauncher'
import { appStopToastMessage, stopRegisteredApp } from './appStop'
import { hostToast } from '../host/hostPrimitives'
import { hostButtonSx, hostDangerButtonSx } from '../components/hostUiStyles'
import HostPageHeader from '../components/HostPageHeader'

interface AppActivationViewProps {
  app: RegisteredApp
  status?: AppStatus
  onBack: () => void
}

export default function AppActivationView({ app, status, onBack }: AppActivationViewProps) {
  const handleStop = async () => {
    try {
      const result = await stopRegisteredApp(app)
      await hostToast(appStopToastMessage(app.name, result))
    } catch (error: any) {
      await hostToast(String(error?.message || error || '停止应用失败'))
    }
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <HostPageHeader title={app.name} onBack={onBack} />
      <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3 }}>
        {status?.running ? (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              应用正在运行
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
              <Button variant="text" size="small" sx={hostButtonSx} onClick={() => launchApp(app, 'show')}>
                唤醒窗口
              </Button>
              <Button variant="text" size="small" sx={hostDangerButtonSx} color="error" onClick={() => void handleStop()}>
                停止应用
              </Button>
            </Box>
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center' }}>
            <CircularProgress size={18} sx={{ mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              正在启动 {app.name}...
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}
