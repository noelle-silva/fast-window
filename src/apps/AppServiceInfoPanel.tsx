import { useState } from 'react'
import { Box, Button, CircularProgress, TextField, Typography } from '@mui/material'
import type {
  AppServiceConfigField,
  AppServiceConnectionValue,
  AppServiceInfo,
} from './appServiceInfo'
import { saveAppServiceConfig } from './appServiceInfo'
import { hostToast } from '../host/hostPrimitives'
import { hostButtonSx, hostTextFieldSx } from '../components/hostUiStyles'

const MONO_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

interface AppServiceInfoPanelProps {
  info: AppServiceInfo | null
  loading: boolean
  error: string | null
  exePath: string
  onSaved: () => void | Promise<void>
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
  fontFamily: MONO_FONT_FAMILY,
  fontSize: 13,
  wordBreak: 'break-all',
} as const

const editorInputSx = {
  ...hostTextFieldSx,
  '& .MuiInputBase-input': { fontFamily: MONO_FONT_FAMILY, fontSize: 13 },
} as const

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
      {children}
    </Typography>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={fieldRowSx}>
      <Typography sx={labelSx}>{label}</Typography>
      {children}
    </Box>
  )
}

function ConnectionValueEditor({
  label,
  field,
  entry,
  exePath,
  onSaved,
}: {
  label: string
  field: AppServiceConfigField
  entry: AppServiceConnectionValue
  exePath: string
  onSaved: () => void | Promise<void>
}) {
  const [draft, setDraft] = useState(entry.available ? entry.value : '')
  const [saving, setSaving] = useState(false)
  const baseline = entry.available ? entry.value : ''

  const save = async () => {
    setSaving(true)
    try {
      await saveAppServiceConfig(exePath, field, draft)
      await hostToast('已保存，重启服务后生效')
      await onSaved()
    } catch (error: any) {
      await hostToast(String(error?.message || error || `保存${label}失败`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FieldRow label={label}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <TextField
            size="small"
            fullWidth
            value={draft}
            disabled={saving}
            onChange={event => setDraft(event.target.value)}
            slotProps={{ htmlInput: { 'aria-label': label } }}
            sx={editorInputSx}
          />
          <Button
            size="small"
            variant="text"
            disabled={saving || draft.trim() === baseline}
            onClick={() => void save()}
            sx={{ ...hostButtonSx, flexShrink: 0 }}
          >
            保存
          </Button>
        </Box>
        {!entry.available ? (
          <Typography sx={{ ...valueSx, color: 'text.secondary' }}>{entry.reason || '不可用'}</Typography>
        ) : null}
      </Box>
    </FieldRow>
  )
}

export default function AppServiceInfoPanel({ info, loading, error, exePath, onSaved }: AppServiceInfoPanelProps) {
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

  if (!info || info.appKind !== 'service-app') return null

  const start = info.start
  const environmentEntries = start ? Object.entries(start.environment) : []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box>
        <SectionTitle>启动方式</SectionTitle>
        <FieldRow label="主程序">
          <Typography sx={valueSx}>{start?.executable || '(未声明)'}</Typography>
        </FieldRow>
        <FieldRow label="启动参数">
          <Typography sx={valueSx}>{start?.args.length ? start.args.join(' ') : '(无)'}</Typography>
        </FieldRow>
        <FieldRow label="环境变量">
          {environmentEntries.length ? (
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {environmentEntries.map(([key, value]) => (
                <Typography key={key} sx={valueSx}>{key}={value}</Typography>
              ))}
            </Box>
          ) : (
            <Typography sx={valueSx}>(无)</Typography>
          )}
        </FieldRow>
      </Box>

      <Box>
        <SectionTitle>就绪规则</SectionTitle>
        <FieldRow label="匹配文本">
          <Typography sx={valueSx}>{info.ready?.match || '(未声明)'}</Typography>
        </FieldRow>
        <FieldRow label="超时">
          <Typography sx={valueSx}>
            {info.ready ? `${info.ready.timeoutSeconds} 秒` : '(未声明)'}
          </Typography>
        </FieldRow>
      </Box>

      <Box>
        <SectionTitle>停止方式</SectionTitle>
        <FieldRow label="方式">
          <Typography sx={valueSx}>{info.stop?.type || '(未声明)'}</Typography>
        </FieldRow>
      </Box>

      <Box>
        <SectionTitle>连接信息</SectionTitle>
        <ConnectionValueEditor
          label="端口"
          field="port"
          entry={info.connection.port}
          exePath={exePath}
          onSaved={onSaved}
        />
        <ConnectionValueEditor
          label="钥匙"
          field="key"
          entry={info.connection.key}
          exePath={exePath}
          onSaved={onSaved}
        />
      </Box>
    </Box>
  )
}
