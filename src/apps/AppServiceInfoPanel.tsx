import { invoke } from '@tauri-apps/api/core'
import { Box, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import type { AppServiceConnectionValue, AppServiceInfo } from './appServiceInfo'
import { hostToast } from '../host/hostPrimitives'

interface AppServiceInfoPanelProps {
  info: AppServiceInfo | null
  loading: boolean
  error: string | null
}

const fieldRowSx = {
  display: 'grid',
  gridTemplateColumns: '96px 1fr',
  gap: 1,
  py: 0.5,
  alignItems: 'start',
} as const

const labelSx = { color: 'text.secondary', fontSize: 13 } as const

const valueSx = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  wordBreak: 'break-all',
} as const

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
      {children}
    </Typography>
  )
}

function ReadOnlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={fieldRowSx}>
      <Typography sx={labelSx}>{label}</Typography>
      {children}
    </Box>
  )
}

function ConnectionValueField({ label, entry }: { label: string; entry: AppServiceConnectionValue }) {
  const copyValue = async () => {
    try {
      await invoke('clipboard_write_text', { text: entry.value })
      await hostToast(`已复制${label}`)
    } catch (error: any) {
      await hostToast(String(error?.message || error || `复制${label}失败`))
    }
  }

  if (!entry.available) {
    return (
      <ReadOnlyField label={label}>
        <Typography sx={{ ...valueSx, color: 'text.secondary' }}>{entry.reason || '不可用'}</Typography>
      </ReadOnlyField>
    )
  }

  return (
    <ReadOnlyField label={label}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Typography sx={{ ...valueSx, flex: 1, minWidth: 0 }}>{entry.value}</Typography>
        <Tooltip title={`复制${label}`}>
          <IconButton size="small" aria-label={`复制${label}`} onClick={() => void copyValue()}>
            <ContentCopyRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </ReadOnlyField>
  )
}

export default function AppServiceInfoPanel({ info, loading, error }: AppServiceInfoPanelProps) {
  if (loading && !info) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={14} />
        <Typography variant="caption" color="text.secondary">正在读取服务信息…</Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Typography variant="caption" color="error.main">
        服务信息不可用：{error}
      </Typography>
    )
  }

  if (!info || info.appKind !== 'service') return null

  const start = info.start
  const environmentEntries = start ? Object.entries(start.environment) : []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box>
        <SectionTitle>启动方式</SectionTitle>
        <ReadOnlyField label="主程序">
          <Typography sx={valueSx}>{start?.executable || '(未声明)'}</Typography>
        </ReadOnlyField>
        <ReadOnlyField label="启动参数">
          <Typography sx={valueSx}>{start?.args.length ? start.args.join(' ') : '(无)'}</Typography>
        </ReadOnlyField>
        <ReadOnlyField label="环境变量">
          {environmentEntries.length ? (
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {environmentEntries.map(([key, value]) => (
                <Typography key={key} sx={valueSx}>{key}={value}</Typography>
              ))}
            </Box>
          ) : (
            <Typography sx={valueSx}>(无)</Typography>
          )}
        </ReadOnlyField>
      </Box>

      <Box>
        <SectionTitle>就绪规则</SectionTitle>
        <ReadOnlyField label="匹配文本">
          <Typography sx={valueSx}>{info.ready?.match || '(未声明)'}</Typography>
        </ReadOnlyField>
        <ReadOnlyField label="超时">
          <Typography sx={valueSx}>
            {info.ready ? `${info.ready.timeoutSeconds} 秒` : '(未声明)'}
          </Typography>
        </ReadOnlyField>
      </Box>

      <Box>
        <SectionTitle>停止方式</SectionTitle>
        <ReadOnlyField label="方式">
          <Typography sx={valueSx}>{info.stop?.type || '(未声明)'}</Typography>
        </ReadOnlyField>
      </Box>

      <Box>
        <SectionTitle>连接信息</SectionTitle>
        {info.connection ? (
          <>
            <ConnectionValueField label="端口" entry={info.connection.port} />
            <ConnectionValueField label="钥匙" entry={info.connection.key} />
          </>
        ) : (
          <Typography sx={{ ...valueSx, color: 'text.secondary' }}>声明中没有配置连接信息</Typography>
        )}
      </Box>
    </Box>
  )
}
