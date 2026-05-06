import * as React from 'react'
import DownloadDoneRoundedIcon from '@mui/icons-material/DownloadDoneRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import ImportExportRoundedIcon from '@mui/icons-material/ImportExportRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { Alert, Box, Button, Chip, Collapse, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'

type SettingsPanelProps = {
  controller: ClipboardHistoryController
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { controller } = props
  const { state, dataDirStatus } = controller
  const [pollInterval, setPollInterval] = React.useState(String(state.settings.pollInterval))
  const [maxHistory, setMaxHistory] = React.useState(String(state.settings.maxHistory))
  const [collapseLines, setCollapseLines] = React.useState(String(state.settings.collapseLines))

  React.useEffect(() => {
    setPollInterval(String(state.settings.pollInterval))
    setMaxHistory(String(state.settings.maxHistory))
    setCollapseLines(String(state.settings.collapseLines))
  }, [state.settings.collapseLines, state.settings.maxHistory, state.settings.pollInterval])

  const saveSettings = React.useCallback(() => {
    void controller.updateSettings({
      ...state.settings,
      pollInterval: Number(pollInterval),
      maxHistory: Number(maxHistory),
      collapseLines: Number(collapseLines),
    })
  }, [collapseLines, controller, maxHistory, pollInterval, state.settings])

  return (
    <Collapse in={state.showSettings} unmountOnExit>
      <Paper sx={{ mb: 1.25, p: 1.25, boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06)', bgcolor: 'background.paper' }}>
        <Stack spacing={1.25}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>自动监控</Typography>
            <Switch
              checked={state.settings.autoMonitor}
              onChange={() => void controller.updateSettings({ ...state.settings, autoMonitor: !state.settings.autoMonitor })}
              inputProps={{ 'aria-label': '自动监控' }}
            />
            <Chip size="small" color={state.settings.autoMonitor ? 'primary' : 'default'} label={state.settings.autoMonitor ? '开启' : '关闭'} />
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>轮询间隔(ms)</Typography>
            <TextField type="number" inputProps={{ min: 200, step: 100 }} value={pollInterval} onChange={(event) => setPollInterval(event.target.value)} sx={{ width: 140 }} />
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>最大记录数</Typography>
            <TextField type="number" inputProps={{ min: 10, step: 10 }} value={maxHistory} onChange={(event) => setMaxHistory(event.target.value)} sx={{ width: 140 }} />
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>折叠行数</Typography>
            <TextField type="number" inputProps={{ min: 1, step: 1 }} value={collapseLines} onChange={(event) => setCollapseLines(event.target.value)} sx={{ width: 140 }} />
          </Stack>

          <Box>
            <Button variant="contained" startIcon={<SaveRoundedIcon fontSize="small" />} onClick={saveSettings}>保存</Button>
          </Box>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>数据目录</Typography>
            <Chip
              size="small"
              label={dataDirStatus?.writable === false ? '不可写' : '正常'}
              color={dataDirStatus?.writable === false ? 'error' : 'success'}
              title={String(dataDirStatus?.dataDir || '')}
            />
            <Button startIcon={<FolderOpenRoundedIcon fontSize="small" />} onClick={() => void controller.pickDataDir()}>选择目录</Button>
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>旧数据</Typography>
            <Button startIcon={<ImportExportRoundedIcon fontSize="small" />} onClick={() => void controller.importLegacyData()}>导入旧插件数据</Button>
          </Stack>

          <Alert severity="info" sx={{ py: 0.25 }}>
            导入需要手动选择旧数据目录；导入前会备份当前数据。
          </Alert>

          {state.legacyImportReport ? <LegacyImportReport controller={controller} /> : null}
          {dataDirStatus?.error ? <Alert severity="warning">{String(dataDirStatus.error)}</Alert> : null}
        </Stack>
      </Paper>
    </Collapse>
  )
}

function LegacyImportReport(props: SettingsPanelProps) {
  const report = props.controller.state.legacyImportReport
  if (!report) return null
  const files = Array.isArray(report.importedFiles) && report.importedFiles.length ? report.importedFiles.join(', ') : '无'
  const backup = report.backupDir || '导入前没有旧数据需要备份'

  return (
    <Alert severity="success" icon={<DownloadDoneRoundedIcon fontSize="small" />}>
      <Stack spacing={0.5}>
        <Typography variant="body2">
          最近导入：{report.historyCount || 0} 条历史，{report.collectionCount || 0} 个收藏节点，{report.copiedImages || 0} 张图片。
        </Typography>
        <Typography variant="caption" color="text.secondary">导入文件：{files}</Typography>
        <Typography variant="caption" color="text.secondary">备份位置：{backup}</Typography>
      </Stack>
    </Alert>
  )
}
