import * as React from 'react'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { Box, Button, Chip, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
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
    <Box sx={{ height: { lg: '100%' }, minHeight: 0 }}>
      <Paper sx={{ height: '100%', minHeight: 0, overflow: 'hidden', p: 1.5, borderRadius: 3, boxShadow: '0 12px 32px rgba(15, 23, 42, 0.07)' }}>
        <Stack spacing={1.25} sx={{ height: '100%', minHeight: { xs: 680, lg: 0 } }}>
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 1.25 }}>
            <Stack spacing={0.75} sx={{ minHeight: 0, height: '100%' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="caption" color="text.secondary">{controller.state.history.length} 条历史 · {controller.state.dataDirStatus?.writable ? '数据目录可写' : '等待数据目录状态'}</Typography>
                <Button startIcon={<SettingsOutlinedIcon fontSize="small" />} onClick={controller.openTemplates}>
                  空间编辑
                </Button>
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
                  <InputLabel id="template-select-label">模板</InputLabel>
                  <Select labelId="template-select-label" label="模板" value={currentSpace.activeTemplateId} onChange={event => void controller.updateActiveTemplate(event.target.value)}>
                    {currentSpace.templates.map(template => <MenuItem key={template.id} value={template.id}>{template.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180, flex: 1.4 }}>
                  <InputLabel id="model-select-label">模型坐标</InputLabel>
                  <Select labelId="model-select-label" label="模型坐标" value={controller.state.modelDraft || controller.model} onChange={event => controller.setModelDraft(event.target.value)}>
                    <MenuItem value="">选择模型</MenuItem>
                    {controller.models.map(model => <MenuItem key={model} value={model}>{model}</MenuItem>)}
                    <MenuItem value="__custom__">自定义模型坐标...</MenuItem>
                  </Select>
                </FormControl>
                <Button startIcon={<PlayArrowRoundedIcon fontSize="small" />} variant="contained" color="success" onClick={() => void controller.askOnce()} disabled={!controller.canAsk}>
                  {controller.state.busy ? '发送中...' : '发送'}
                </Button>
              </Stack>

              {controller.state.modelDraft === '__custom__' ? (
                <TextField label="自定义模型坐标" placeholder="供应商名称/模型ID" value={controller.state.customModel} onChange={event => controller.setCustomModel(event.target.value)} />
              ) : null}

              <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={event => { if (event.target.files) void controller.addImageFiles(event.target.files); event.target.value = '' }} />
              <ImageAttachments controller={controller} onPickImages={() => fileInputRef.current?.click()} />

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

            <Stack spacing={0.75} sx={{ minHeight: 0, height: '100%' }}>
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
