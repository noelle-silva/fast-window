import * as React from 'react'
import { Button, Stack, TextField, Typography } from '@mui/material'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import SaveIcon from '@mui/icons-material/Save'
import { SettingsSection } from './SettingsSurfaces'

type ToolWorkDirectorySectionProps = {
  controller: any
  state: any
}

// ToolWorkDirectorySection 展示并编辑「AI 工具默认工作目录」：
// 没有工作区的会话里，所有工具都在这个目录中干活。
export function ToolWorkDirectorySection(props: ToolWorkDirectorySectionProps) {
  const { controller, state } = props
  const loading = state?.loading === true
  const saving = state?.saving === true
  const error = String(state?.error || '')
  return (
    <SettingsSection>
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900 }}>工具默认工作目录</Typography>
            <Typography variant="caption" color="text.secondary">
              没有工作区的会话里，所有 AI 工具都在这个目录中干活；有工作区的会话仍以工作区目录为准。
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<RestartAltIcon />} onClick={() => controller.actions.resetToolWorkDirectoryToDefault?.()} disabled={loading || saving}>
              恢复默认
            </Button>
            <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={() => controller.actions.saveToolWorkDirectory?.()} disabled={loading || saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </Stack>
        </Stack>
        <TextField
          size="small"
          label="目录绝对路径"
          value={String(state?.draft || '')}
          onChange={(event) => controller.actions.setToolWorkDirectoryDraft?.(event.target.value)}
          placeholder="留空保存即恢复默认（系统临时区下的 eucli-box-temp）"
          disabled={loading || saving}
          fullWidth
        />
        {error ? <Typography variant="caption" color="error">{error}</Typography> : null}
      </Stack>
    </SettingsSection>
  )
}
