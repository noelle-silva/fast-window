import * as React from 'react'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { Box, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { formatDateTime } from '../../shared/aiOnceDomain'
import { HistoryList } from '../components/HistoryList'
import { ImageAttachments } from '../components/ImageAttachments'
import type { AiOnceController } from '../hooks/useAiOnceController'

type WorkbenchViewProps = {
  controller: AiOnceController
}

export function WorkbenchView(props: WorkbenchViewProps) {
  const { controller } = props
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const data = controller.state.data
  const currentSpace = controller.currentSpace

  if (!data || !currentSpace) {
    return (
      <Box sx={{ minHeight: '55vh', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
        <Typography>AI Once 正在准备工作台...</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ height: { lg: '100%' }, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '310px minmax(0, 1fr)' }, gap: 1.5 }}>
      <Paper sx={{ minHeight: 0, overflow: 'auto', p: 1.5, borderRadius: 3, boxShadow: '0 12px 32px rgba(15, 23, 42, 0.07)' }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>{currentSpace.name}</Typography>
            <Typography variant="body2" color="text.secondary">{controller.state.history.length} 条历史 · {controller.state.dataDirStatus?.writable ? '数据目录可写' : '等待数据目录状态'}</Typography>
          </Box>

          <InfoGrid controller={controller} />

          <Stack spacing={0.75}>
            <Button startIcon={<SettingsOutlinedIcon fontSize="small" />} onClick={controller.openTemplates} fullWidth>
              模板管理
            </Button>
            <Button startIcon={<SettingsOutlinedIcon fontSize="small" />} onClick={controller.openSettings} fullWidth>
              供应商设置
            </Button>
            <Button startIcon={<RefreshRoundedIcon fontSize="small" />} onClick={() => void controller.refreshModels()} disabled={controller.state.busy} fullWidth>
              刷新模型
            </Button>
          </Stack>

          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>最近历史</Typography>
            {controller.state.history.length ? (
              <Button color="error" startIcon={<DeleteSweepRoundedIcon fontSize="small" />} onClick={controller.requestClearHistory} disabled={controller.state.busy}>
                清空
              </Button>
            ) : null}
          </Stack>
          <HistoryList controller={controller} limit={14} />
        </Stack>
      </Paper>

      <Paper sx={{ minHeight: 0, overflow: 'hidden', p: 1.5, borderRadius: 3, boxShadow: '0 12px 32px rgba(15, 23, 42, 0.07)' }}>
        <Stack spacing={1.25} sx={{ height: '100%', minHeight: { xs: 680, lg: 0 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
              <InputLabel id="provider-select-label">供应商</InputLabel>
              <Select labelId="provider-select-label" label="供应商" value={controller.providerId} onChange={event => void controller.updateActiveProvider(event.target.value)}>
                {data.settings.providers.map(provider => <MenuItem key={provider.id} value={provider.id}>{provider.name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180, flex: 1 }}>
              <InputLabel id="template-select-label">模板</InputLabel>
              <Select labelId="template-select-label" label="模板" value={currentSpace.activeTemplateId} onChange={event => void controller.updateActiveTemplate(event.target.value)}>
                {currentSpace.templates.map(template => <MenuItem key={template.id} value={template.id}>{template.name}</MenuItem>)}
              </Select>
            </FormControl>
            <Button startIcon={<SettingsOutlinedIcon fontSize="small" />} onClick={controller.openTemplates}>模板</Button>
            <Button startIcon={<SettingsOutlinedIcon fontSize="small" />} onClick={controller.openSettings}>设置</Button>
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
              <InputLabel id="model-select-label">模型</InputLabel>
              <Select labelId="model-select-label" label="模型" value={controller.state.modelDraft || controller.model} onChange={event => controller.setModelDraft(event.target.value)}>
                <MenuItem value="">选择模型</MenuItem>
                {controller.models.map(model => <MenuItem key={model} value={model}>{model}</MenuItem>)}
                <MenuItem value="__custom__">自定义模型...</MenuItem>
              </Select>
            </FormControl>
            {controller.state.modelDraft === '__custom__' ? (
              <TextField label="自定义模型名" value={controller.state.customModel} onChange={event => controller.setCustomModel(event.target.value)} sx={{ minWidth: 220, flex: 1 }} />
            ) : null}
            <Button variant="contained" color="success" startIcon={<PlayArrowRoundedIcon fontSize="small" />} onClick={() => void controller.askOnce()} disabled={!controller.canAsk}>
              {controller.state.busy ? '发送中...' : '发送'}
            </Button>
          </Stack>

          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={event => { if (event.target.files) void controller.addImageFiles(event.target.files); event.target.value = '' }} />
          <ImageAttachments controller={controller} onPickImages={() => fileInputRef.current?.click()} />

          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 1.25 }}>
            <Stack spacing={0.75} sx={{ minHeight: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <AutoFixHighRoundedIcon fontSize="small" color="primary" />
                <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>输入</Typography>
                <Chip size="small" label="Ctrl / Cmd + Enter 发送" />
              </Stack>
              <TextField
                value={controller.state.prompt}
                onChange={event => controller.setPrompt(event.target.value)}
                onPaste={event => void controller.addImageFiles(Array.from(event.clipboardData.files))}
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    void controller.askOnce()
                  }
                }}
                placeholder="输入你的问题..."
                multiline
                fullWidth
                sx={{ flex: 1, minHeight: 0, '& .MuiInputBase-root': { height: '100%', alignItems: 'stretch' }, '& textarea': { height: '100% !important', overflow: 'auto !important', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', lineHeight: 1.65 } }}
              />
            </Stack>

            <Stack spacing={0.75} sx={{ minHeight: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>输出</Typography>
                <Box sx={{ flex: 1 }} />
                <Button startIcon={<ContentCopyRoundedIcon fontSize="small" />} onClick={() => void controller.copyAnswer()} disabled={!controller.state.answer}>复制</Button>
                <Button onClick={controller.clearWorkbench} disabled={controller.state.busy}>清空</Button>
              </Stack>
              <Box
                component="pre"
                sx={{
                  flex: 1,
                  minHeight: 0,
                  m: 0,
                  p: 1.25,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  borderRadius: 2,
                  bgcolor: 'rgba(15, 23, 42, 0.035)',
                  boxShadow: 'inset 0 0 0 1px rgba(100, 116, 139, 0.16)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  lineHeight: 1.65,
                }}
              >
                {controller.state.answer || (controller.state.busy ? '正在请求 AI...' : '等待输出...')}
              </Box>
            </Stack>
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}

function InfoGrid(props: WorkbenchViewProps) {
  const { controller } = props
  const items = [
    ['供应商', controller.provider?.name || '未配置'],
    ['模型', controller.model || '未设置'],
    ['模板', controller.template?.name || '默认'],
    ['数据目录', controller.state.dataDirStatus?.writable ? '可写' : '未知/不可写'],
    ['初始命令', controller.state.initialCommand || '无'],
    ['运行命令', controller.state.runtimeCommand || '无'],
    ['最近健康', controller.state.health ? formatDateTime(new Date().toISOString()) : '等待后台'],
  ]

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr)', gap: 0.75 }}>
      {items.map(([label, value]) => (
        <React.Fragment key={label}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 900 }}>{label}</Typography>
          <Typography variant="caption" sx={{ minWidth: 0, overflowWrap: 'anywhere', fontFamily: label === '模型' ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : undefined }}>{value}</Typography>
        </React.Fragment>
      ))}
    </Box>
  )
}
