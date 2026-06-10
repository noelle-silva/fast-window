import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { Alert, Box, Button, Dialog, Divider, Stack, TextField, Typography } from '@mui/material'
import { APP_REQUEST_TIMEOUT_GRACE_SECONDS, MAX_REQUEST_TIMEOUT_SECONDS, MIN_REQUEST_TIMEOUT_SECONDS, appRequestTimeoutSeconds, normalizeTimeoutSettings } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'

type AppSettingsDialogProps = {
  controller: AiOnceController
}

export function AppSettingsDialog(props: AppSettingsDialogProps) {
  const { controller } = props
  const { dataDirStatus, busy, asking, dialog, editing } = controller.state
  const open = dialog === 'app-settings'
  const timeouts = normalizeTimeoutSettings(editing?.settings.timeouts)

  return (
    <Dialog open={open} onClose={controller.closeDialog} fullWidth maxWidth="sm">
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>应用设置</Typography>
            <Typography variant="body2" color="text.secondary">管理本地数据目录、后台连接状态和全局请求等待时间。</Typography>
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

          {editing ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
              <TextField
                label="模型服务等待秒数"
                type="number"
                inputProps={{ min: MIN_REQUEST_TIMEOUT_SECONDS, max: MAX_REQUEST_TIMEOUT_SECONDS, step: 1 }}
                value={timeouts.modelRequestTimeoutSeconds}
                onChange={event => controller.mutateEditing(draft => {
                  draft.settings.timeouts = normalizeTimeoutSettings({ modelRequestTimeoutSeconds: Number(event.target.value) })
                })}
                helperText="模型返回慢时可以调大，默认 600 秒。"
              />
              <TextField
                label="界面最长等待"
                value={`${appRequestTimeoutSeconds(timeouts)} 秒`}
                disabled
                helperText={`自动比模型服务多等 ${APP_REQUEST_TIMEOUT_GRACE_SECONDS} 秒，避免界面提前放弃。`}
              />
            </Box>
          ) : (
            <Alert severity="info" sx={{ py: 0.75 }}>数据尚未加载，等待时间设置稍后可用。</Alert>
          )}

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
            <Button onClick={controller.closeDialog}>关闭</Button>
            <Button variant="contained" startIcon={<SaveRoundedIcon fontSize="small" />} onClick={() => void controller.saveEditing()} disabled={!editing || busy || asking}>保存</Button>
          </Stack>
        </Stack>
      </Box>
    </Dialog>
  )
}
