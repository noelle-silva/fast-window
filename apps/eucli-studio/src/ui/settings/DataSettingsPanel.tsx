import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useEvent } from '../hooks/useEvent'
import { SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

export type DataDirectoryStatus = {
  dataDir: string
  defaultDataDir: string
  configuredDataDir?: string | null
  writable: boolean
  error?: string | null
}

export type AiChatDataDirectory = {
  status: DataDirectoryStatus | null
  busy?: boolean
  onPick?: () => Promise<void> | void
  onRefresh?: () => Promise<DataDirectoryStatus | null> | void
}

export function DataSettingsPanel(props: { dataDirectory?: AiChatDataDirectory; loading: boolean }) {
  const { dataDirectory, loading } = props
  const status = dataDirectory?.status || null
  const busy = !!dataDirectory?.busy || loading
  const currentDir = String(status?.dataDir || '')
  const defaultDir = String(status?.defaultDataDir || '')
  const configuredDir = String(status?.configuredDataDir || '')
  const hasCustomDir = !!configuredDir && configuredDir !== defaultDir
  const issue = String(status?.error || '').trim() || (status && !status.writable ? '数据目录不可写' : '')

  const runPick = useEvent(async () => {
    if (typeof dataDirectory?.onPick !== 'function') return
    await dataDirectory.onPick()
  })

  const runRefresh = useEvent(async () => {
    if (typeof dataDirectory?.onRefresh !== 'function') return
    await dataDirectory.onRefresh()
  })

  return (
    <SettingsSurface>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 900 }}>数据</Typography>
              <Typography variant="caption" color="text.secondary">
                eucli-studio 的聊天、角色、图片和运行状态都会保存在这个目录里。
              </Typography>
            </Box>
            {status ? <SettingsPill tone={status.writable ? 'selected' : 'danger'}>{status.writable ? '可写' : '不可写'}</SettingsPill> : <SettingsPill>读取中</SettingsPill>}
          </Stack>

          {issue ? (
            <SettingsSection tone="danger">
              <Typography variant="body2" color="error" sx={{ fontWeight: 800 }}>
                {issue}
              </Typography>
            </SettingsSection>
          ) : null}

          <Stack spacing={1.25}>
            <TextField
              size="small"
              label="当前数据目录"
              value={currentDir || '读取中...'}
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              size="small"
              label="默认数据目录"
              value={defaultDir || '读取中...'}
              fullWidth
              InputProps={{ readOnly: true }}
            />
            <TextField
              size="small"
              label="目录来源"
              value={hasCustomDir ? '自定义目录' : '默认目录'}
              fullWidth
              InputProps={{ readOnly: true }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Button variant="contained" onClick={runPick} disabled={busy || typeof dataDirectory?.onPick !== 'function'}>
              {busy ? '处理中…' : '选择数据目录'}
            </Button>
            <Button variant="text" onClick={runRefresh} disabled={busy || typeof dataDirectory?.onRefresh !== 'function'}>
              刷新状态
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary">
             切换目录会重启 eucli-studio 自己的本机后台，然后重新载入新目录中的数据。
          </Typography>
        </Stack>
    </SettingsSurface>
  )
}
