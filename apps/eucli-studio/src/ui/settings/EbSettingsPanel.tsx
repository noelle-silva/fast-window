import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from '@mui/material'
import CableIcon from '@mui/icons-material/Cable'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { compatibilityRangeText, type StudioBootstrap } from '../../domain/release'
import { SettingsHeading, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

export type AiChatEucliBoxConnectionInfo = {
  eucliBoxUrl: string
  eucliBoxKey?: string
}

export type AiChatEucliBoxConnection = {
  onLoad?: () => Promise<AiChatEucliBoxConnectionInfo>
  onDisconnect?: () => Promise<void> | void
}

type EbSettingsPanelProps = {
  bootstrap?: StudioBootstrap
  connection?: AiChatEucliBoxConnection
}

export function EbSettingsPanel(props: EbSettingsPanelProps) {
  const { bootstrap, connection } = props
  const [url, setUrl] = React.useState('')
  const [key, setKey] = React.useState('')
  const [configReady, setConfigReady] = React.useState(false)
  const [keyVisible, setKeyVisible] = React.useState(false)
  const [disconnectOpen, setDisconnectOpen] = React.useState(false)
  const [disconnecting, setDisconnecting] = React.useState(false)

  const load = connection?.onLoad
  React.useEffect(() => {
    let disposed = false
    if (typeof load !== 'function') {
      setConfigReady(true)
      return () => {
        disposed = true
      }
    }
    void load()
      .then((config) => {
        if (disposed) return
        setUrl(String(config?.eucliBoxUrl || ''))
        setKey(String(config?.eucliBoxKey || ''))
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) setConfigReady(true)
      })
    return () => {
      disposed = true
    }
  }, [load])

  const configured = !!url.trim()
  const canDisconnect = configReady && configured && typeof connection?.onDisconnect === 'function'

  const confirmDisconnect = React.useCallback(async () => {
    if (typeof connection?.onDisconnect !== 'function' || disconnecting) return
    setDisconnecting(true)
    try {
      await connection.onDisconnect()
    } finally {
      setDisconnecting(false)
      setDisconnectOpen(false)
    }
  }, [connection, disconnecting])

  const keyRevealLabel = keyVisible ? '隐藏访问 Key' : '显示访问 Key'

  return (
    <SettingsSurface>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
          <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(14,165,233,.10)', color: 'info.main', display: 'grid', placeItems: 'center' }}>
            <CableIcon fontSize="small" />
          </Box>
          <SettingsHeading title="eucli-box连接设置" description="查看当前连接信息，以及客户端与 eucli-box 的版本和适用情况。" descriptionVariant="body2" />
        </Stack>

        <SettingsSection tone="muted">
          <Stack spacing={1.25}>
            <Typography sx={{ fontWeight: 900 }}>连接信息</Typography>
            <TextField
              size="small"
              label="业务端地址（网关）"
              value={configReady ? (url || '未配置') : '读取中…'}
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              size="small"
              label="访问 Key"
              value={configReady ? (key || '未配置') : '读取中…'}
              fullWidth
              type={key && !keyVisible ? 'password' : 'text'}
              InputProps={{
                readOnly: true,
                endAdornment: key ? (
                  <InputAdornment position="end">
                    <Tooltip title={keyRevealLabel}>
                      <IconButton
                        size="small"
                        aria-label={keyRevealLabel}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setKeyVisible((visible) => !visible)}
                      >
                        {keyVisible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ) : null,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              退出连接只是断开与 eucli-box 的连接；地址与 Key 会保留，重新连接时无需重新填写，客户端外观、壁纸、会话索引等本地设置也不受影响。
            </Typography>
            <Box>
              <Button
                color="error"
                variant="outlined"
                disabled={!canDisconnect || disconnecting}
                onClick={() => setDisconnectOpen(true)}
              >
                退出当前连接
              </Button>
            </Box>
          </Stack>
        </SettingsSection>

        {bootstrap ? (
          <SettingsSection tone="muted">
            <Stack spacing={1}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 900 }}>版本与连接</Typography>
                <SettingsPill tone={bootstrap.businessAvailable ? 'selected' : 'danger'}>
                  {bootstrap.businessAvailable ? '适用' : '不可用'}
                </SettingsPill>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ flexWrap: 'wrap' }}>
                <ReleaseFact label="客户端版本" value={bootstrap.clientVersion || '版本资料无效'} />
                <ReleaseFact label="eucli-box 版本" value={bootstrap.eucliBoxVersion || '版本资料无效'} />
                <ReleaseFact label="客户端所需范围" value={compatibilityRangeText(bootstrap.clientEucliBoxCompatibility)} />
              </Stack>
              {bootstrap.eucliBoxIssue ? (
                <Typography variant="caption" color="error">{bootstrap.eucliBoxIssue}</Typography>
              ) : null}
            </Stack>
          </SettingsSection>
        ) : null}
      </Stack>

      <Dialog open={disconnectOpen} onClose={() => { if (!disconnecting) setDisconnectOpen(false) }} fullWidth maxWidth="xs">
        <DialogTitle>退出当前连接</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">将断开与 eucli-box 的连接，并回到连接窗口。</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            地址与 Key 会保留，重新连接时无需重新填写；客户端外观、壁纸、会话索引等本地设置也不受影响。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={disconnecting} onClick={() => setDisconnectOpen(false)}>取消</Button>
          <Button color="error" variant="contained" disabled={disconnecting} onClick={() => void confirmDisconnect()}>
            {disconnecting ? '退出中…' : '退出连接'}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsSurface>
  )
}

function ReleaseFact(props: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: { xs: 0, sm: 180 }, flex: '1 1 180px' }}>
      <Typography variant="caption" color="text.secondary">{props.label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{props.value}</Typography>
    </Box>
  )
}
