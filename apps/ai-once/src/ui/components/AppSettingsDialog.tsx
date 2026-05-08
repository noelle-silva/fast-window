import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { Alert, Box, Button, Dialog, Divider, Stack, Typography } from '@mui/material'
import type { AiOnceController } from '../hooks/useAiOnceController'

type AppSettingsDialogProps = {
  controller: AiOnceController
}

export function AppSettingsDialog(props: AppSettingsDialogProps) {
  const { controller } = props
  const { dataDirStatus, busy, dialog } = controller.state
  const open = dialog === 'app-settings'

  return (
    <Dialog open={open} onClose={controller.closeDialog} fullWidth maxWidth="sm">
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>应用设置</Typography>
            <Typography variant="body2" color="text.secondary">管理本地数据目录和后台连接状态。</Typography>
          </Box>

          <Alert severity={dataDirStatus?.writable ? 'success' : 'info'} sx={{ py: 0.75 }}>
            {dataDirStatus?.dataDir || '等待数据目录状态'}
          </Alert>

          <Box sx={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', gap: 0.75 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 900 }}>写入状态</Typography>
            <Typography variant="caption">{dataDirStatus?.writable ? '可写' : '未知/不可写'}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 900 }}>默认目录</Typography>
            <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{dataDirStatus?.defaultDataDir || '未知'}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 900 }}>配置目录</Typography>
            <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{dataDirStatus?.configuredDataDir || '未单独配置'}</Typography>
          </Box>

          {dataDirStatus?.error ? <Alert severity="warning" sx={{ py: 0.75 }}>{dataDirStatus.error}</Alert> : null}

          <Divider />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
            <Button startIcon={<FolderOpenRoundedIcon fontSize="small" />} onClick={() => void controller.pickDataDir()} disabled={busy}>
              选择数据目录
            </Button>
            <Button startIcon={<RefreshRoundedIcon fontSize="small" />} onClick={() => void controller.connect({ restartBackend: true })} disabled={busy}>
              重启后台并重连
            </Button>
          </Stack>

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="contained" onClick={controller.closeDialog}>关闭</Button>
          </Stack>
        </Stack>
      </Box>
    </Dialog>
  )
}
