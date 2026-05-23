import * as React from 'react'
import DownloadDoneRoundedIcon from '@mui/icons-material/DownloadDoneRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import ImportExportRoundedIcon from '@mui/icons-material/ImportExportRounded'
import ImageSearchRoundedIcon from '@mui/icons-material/ImageSearchRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { Alert, Box, Button, Chip, Dialog, Stack, Switch, TextField, Typography } from '@mui/material'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'
import { ThemePicker } from './ThemePicker'
import type { ClipboardHistoryThemeId, OrphanImageCleanupReport, OrphanImageReport } from '../../shared/types'
import { ScrollArea } from './ScrollArea'

type SettingsPanelProps = {
  controller: ClipboardHistoryController
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { controller } = props
  const { state, dataDirStatus } = controller
  const [pollInterval, setPollInterval] = React.useState(String(state.settings.pollInterval))
  const [maxHistory, setMaxHistory] = React.useState(String(state.settings.maxHistory))
  const [collapseLines, setCollapseLines] = React.useState(String(state.settings.collapseLines))
  const [orphanReport, setOrphanReport] = React.useState<OrphanImageReport | null>(null)
  const [orphanCleanup, setOrphanCleanup] = React.useState<OrphanImageCleanupReport | null>(null)
  const [orphanBusy, setOrphanBusy] = React.useState(false)

  React.useEffect(() => {
    setPollInterval(String(state.settings.pollInterval))
    setMaxHistory(String(state.settings.maxHistory))
    setCollapseLines(String(state.settings.collapseLines))
  }, [state.settings.collapseLines, state.settings.maxHistory, state.settings.pollInterval])

  const buildDraftSettings = React.useCallback((patch: Partial<typeof state.settings> = {}) => ({
      ...state.settings,
      pollInterval: draftNumber(pollInterval, state.settings.pollInterval),
      maxHistory: draftNumber(maxHistory, state.settings.maxHistory),
      collapseLines: draftNumber(collapseLines, state.settings.collapseLines),
      ...patch,
    }), [collapseLines, maxHistory, pollInterval, state.settings])

  const saveSettings = React.useCallback(() => {
    void controller.updateSettings(buildDraftSettings())
  }, [buildDraftSettings, controller])

  const selectTheme = React.useCallback((theme: ClipboardHistoryThemeId) => {
    void controller.updateSettings(buildDraftSettings({ theme }))
  }, [buildDraftSettings, controller])

  const confirmClearHistory = React.useCallback(() => {
    void controller.clearHistory().catch(error => controller.host.toast(String((error as any)?.message || error || '清空历史失败')))
  }, [controller])

  const scanOrphans = React.useCallback(async () => {
    setOrphanBusy(true)
    try {
      const report = await controller.scanOrphanImages()
      if (report) {
        setOrphanReport(report)
        setOrphanCleanup(null)
      }
    } finally {
      setOrphanBusy(false)
    }
  }, [controller])

  const deleteOrphans = React.useCallback(async () => {
    setOrphanBusy(true)
    try {
      const cleanup = await controller.deleteOrphanImages()
      if (cleanup) {
        setOrphanCleanup(cleanup)
        setOrphanReport(cleanup.remaining)
      }
    } finally {
      setOrphanBusy(false)
    }
  }, [controller])

  return (
    <>
      <Dialog
        open={state.showSettings}
        onClose={() => controller.setShowSettings(false)}
        fullWidth
        maxWidth="md"
        PaperProps={{
          sx: {
            width: 'min(760px, calc(100vw - 28px))',
            maxHeight: 'min(82vh, 720px)',
            borderRadius: 3,
            bgcolor: 'background.paper',
            boxShadow: '0 28px 80px rgba(15, 23, 42, 0.24)',
            overflow: 'hidden',
          },
        }}
      >
        <ScrollArea ariaLabel="设置内容" viewportSx={{ maxHeight: 'min(82vh, 720px)', p: { xs: 1.5, sm: 2 } }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>设置</Typography>
              <Typography variant="caption" color="text.secondary">调整剪贴板监听、显示和配色偏好。</Typography>
            </Box>

            <Stack spacing={1}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>配色方案</Typography>
                <Chip size="small" color="primary" label="点击卡片立即切换" />
              </Stack>
              <Box sx={{ pl: { xs: 0, sm: '132px' } }}>
                <ThemePicker value={state.settings.theme} disabled={!controller.isReady} onChange={selectTheme} />
              </Box>
            </Stack>

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

            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>历史清空</Typography>
              <Button
                color="error"
                startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                onClick={() => controller.setShowClearHistoryConfirm(true)}
                disabled={!controller.isReady}
              >
                清空历史
              </Button>
            </Stack>

            <Stack spacing={1}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>孤立图片</Typography>
                <Button startIcon={<ImageSearchRoundedIcon fontSize="small" />} onClick={scanOrphans} disabled={!controller.isReady || orphanBusy}>
                  检测孤立图片
                </Button>
                {orphanReport?.orphanCount ? (
                  <Button color="error" startIcon={<DeleteOutlineRoundedIcon fontSize="small" />} onClick={deleteOrphans} disabled={orphanBusy}>
                    删除检测结果
                  </Button>
                ) : null}
              </Stack>
              {orphanReport ? <OrphanImageReportView report={orphanReport} cleanup={orphanCleanup} /> : null}
            </Stack>

            <Alert severity="info" sx={{ py: 0.25 }}>
              导入需要手动选择旧数据目录；导入前会备份当前数据。
            </Alert>

            {state.legacyImportReport ? <LegacyImportReport controller={controller} /> : null}
            {dataDirStatus?.error ? <Alert severity="warning">{String(dataDirStatus.error)}</Alert> : null}
          </Stack>
        </ScrollArea>
      </Dialog>

      <Dialog
        open={state.showClearHistoryConfirm}
        onClose={() => controller.setShowClearHistoryConfirm(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            borderRadius: 3,
            bgcolor: 'background.paper',
            boxShadow: '0 28px 80px rgba(15, 23, 42, 0.28)',
          },
        }}
      >
        <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>确认清空历史？</Typography>
              <Typography variant="body2" color="text.secondary">这会删除当前剪贴板历史记录，图片历史也会一起清理。</Typography>
            </Box>

            <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
              <Button onClick={() => controller.setShowClearHistoryConfirm(false)}>取消</Button>
              <Button color="error" variant="contained" startIcon={<DeleteOutlineRoundedIcon fontSize="small" />} onClick={confirmClearHistory} disabled={!controller.isReady}>
                确认清空
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Dialog>
    </>
  )
}

function OrphanImageReportView(props: { report: OrphanImageReport; cleanup: OrphanImageCleanupReport | null }) {
  const { report, cleanup } = props
  const preview = report.orphans.slice(0, 8)

  return (
    <Alert severity={report.orphanCount ? 'warning' : 'success'} sx={{ py: 0.75 }}>
      <Stack spacing={0.75}>
        <Typography variant="body2">
          已扫描 {report.scannedFiles} 张托管图片，当前历史引用 {report.referencedFiles} 张，发现 {report.orphanCount} 张孤立图片，占用 {formatBytes(report.orphanBytes)}。
        </Typography>
        {cleanup ? (
          <Typography variant="caption" color="text.secondary">
            最近清理：删除 {cleanup.deletedCount} 张，释放 {formatBytes(cleanup.deletedBytes)}{cleanup.failed.length ? `，失败 ${cleanup.failed.length} 张` : ''}。
          </Typography>
        ) : null}
        {preview.length ? (
          <Stack spacing={0.25}>
            {preview.map((item) => (
              <Typography key={item.path} variant="caption" color="text.secondary" title={item.path}>
                {item.fileName} · {formatBytes(item.sizeBytes)}
              </Typography>
            ))}
            {report.orphans.length > preview.length ? (
              <Typography variant="caption" color="text.secondary">还有 {report.orphans.length - preview.length} 张未展示。</Typography>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Alert>
  )
}

function formatBytes(value: number): string {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function draftNumber(value: string, fallback: number): number {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
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
