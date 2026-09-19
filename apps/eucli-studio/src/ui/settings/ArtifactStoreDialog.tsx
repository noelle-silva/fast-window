import * as React from 'react'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import StorefrontIcon from '@mui/icons-material/Storefront'
import RefreshIcon from '@mui/icons-material/Refresh'
import DownloadIcon from '@mui/icons-material/Download'
import UpdateIcon from '@mui/icons-material/Update'
import CancelIcon from '@mui/icons-material/Cancel'
import { artifactStatusLabels, compatibilityRangeText, isArtifactBusy, isArtifactCancelable, type ArtifactInstallState, type ArtifactReleaseCandidate, type ReleaseArtifactIdentity, type ReleaseCandidatesView } from '../../domain/release'
import { SettingsPill } from './SettingsSurfaces'

type StoreSourceKind = 'official' | 'local'

type ArtifactStoreDialogProps = {
  open: boolean
  onClose: () => void
  kind: 'tool' | 'plugin'
  title: string
  releaseView?: ReleaseCandidatesView | null
  installStates: Record<string, ArtifactInstallState>
  onAction: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void
  onCancel: (artifact: ReleaseArtifactIdentity) => Promise<void> | void
  onSync: () => Promise<void> | void
  onRefresh: (kind?: string) => Promise<void> | void
  getInstallSource?: () => Promise<string | null>
  setInstallSource?: (kind: StoreSourceKind) => Promise<{ ok: boolean; error?: string }>
}

export function ArtifactStoreDialog(props: ArtifactStoreDialogProps) {
  const { open, onClose, kind, title, releaseView, installStates, onAction, onCancel, onSync, onRefresh, getInstallSource, setInstallSource } = props
  const [refreshing, setRefreshing] = React.useState(false)
  const [sourceKind, setSourceKind] = React.useState<StoreSourceKind>('official')
  const [pendingSource, setPendingSource] = React.useState<StoreSourceKind | null>(null)
  const [sourceError, setSourceError] = React.useState('')
  // 回调统一经引用读取最新值：父级重渲染不会更换副作用依赖，打开读取只触发一次。
  const callbacksRef = React.useRef({ onSync, onRefresh, getInstallSource })
  callbacksRef.current = { onSync, onRefresh, getInstallSource }

  const sourceCandidates = releaseView?.sourceCandidates?.[sourceKind] || []
  const items = sourceCandidates
    .filter((candidate) => String(candidate.artifact?.kind || '') === kind)
    .sort((a, b) => String(a.artifact?.id || '').localeCompare(String(b.artifact?.id || '')))
  const busy = pendingSource !== null || refreshing

  // 打开弹窗时：恢复进行中任务事实，并强制刷新当前分类清单，保证已装状态最新。
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setSourceError('')
    void Promise.resolve(callbacksRef.current.onSync?.()).catch(() => {})
    Promise.resolve(callbacksRef.current.getInstallSource?.())
      .then((source) => {
        if (cancelled || (source !== 'official' && source !== 'local')) return
        setSourceKind(source)
        setRefreshing(true)
        void Promise.resolve(callbacksRef.current.onRefresh(kind))
          .catch(() => {})
          .finally(() => {
            if (!cancelled) setRefreshing(false)
          })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, kind])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.resolve(callbacksRef.current.onRefresh(kind)).catch(() => {})
    } finally {
      setRefreshing(false)
    }
  }

  // switchSource 的时序：切换即刻进入加载态；切换成功后读该来源缓存，
  // 只有该来源该分类没有缓存时才发起读取。等待期间不展示上一个来源的清单。
  const switchSource = async (next: StoreSourceKind) => {
    if (next === sourceKind || busy) return
    setPendingSource(next)
    setSourceError('')
    try {
      const outcome = await Promise.resolve(setInstallSource?.(next))
      if (!outcome || !outcome.ok) {
        setSourceError(outcome?.error || '切换商店源失败')
        return
      }
      setSourceKind(next)
      // 该来源该分类已有缓存则直接展示；没有才发起读取（读取端点自带新鲜度判定）。
      if (!hasSourceKind(releaseView, next, kind)) {
        await Promise.resolve(callbacksRef.current.onRefresh(kind)).catch(() => {})
      }
    } finally {
      setPendingSource(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorefrontIcon fontSize="small" />
        {title}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.5}>
          {(['official', 'local'] as const).map((value) => (
            <Button
              key={value}
              size="small"
              variant={(pendingSource ?? sourceKind) === value ? 'contained' : 'outlined'}
              disabled={busy}
              startIcon={pendingSource === value ? <CircularProgress size={12} color="inherit" /> : undefined}
              onClick={() => void switchSource(value)}
            >
              {value === 'official' ? '官方源' : '本地源'}
            </Button>
          ))}
        </Stack>
        <Button startIcon={<RefreshIcon />} size="small" variant="text" onClick={() => void refresh()} disabled={busy}>
          {refreshing ? '刷新中…' : '刷新'}
        </Button>
        <IconButton onClick={onClose} size="small" aria-label="关闭商店">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: 'grey.50' }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              当前商店源：{sourceKind === 'local' ? '本地源（programs/local-store 货架）' : '官方源（线上正式发行）'}
            </Typography>
            {refreshing ? <CircularProgress size={12} /> : null}
          </Stack>
          {sourceError ? (
            <Typography variant="caption" color="error">
              {sourceError}
            </Typography>
          ) : null}
          {items.length ? (
            items.map((result) => (
              <StoreItem
                key={`${result.artifact.kind}:${result.artifact.id}`}
                result={result}
                installState={installStates[String(result.artifact?.id || '')] || null}
                onAction={onAction}
                onCancel={onCancel}
                sourceKind={sourceKind}
              />
            ))
          ) : busy ? (
            <Stack spacing={1} alignItems="center" sx={{ p: 3 }}>
              <CircularProgress size={22} />
              <Typography variant="body2" color="text.secondary">
                {pendingSource ? `正在切换到${pendingSource === 'local' ? '本地源' : '官方源'}…` : '正在获取商店清单…'}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              {`当前没有可显示的${itemTitle(kind)}。请先刷新商店清单。`}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
          安装或更新由业务端后台完成：可同时进行多条任务，离开页面或关闭客户端都不会中断。
        </Typography>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}

function StoreItem(props: {
  result: ArtifactReleaseCandidate
  installState: ArtifactInstallState | null
  onAction: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void
  onCancel: (artifact: ReleaseArtifactIdentity) => Promise<void> | void
  sourceKind: StoreSourceKind
}) {
  const { result, installState, onAction, onCancel, sourceKind } = props
  const artifact = result.artifact
  const id = String(artifact?.id || '')
  const compatibility = result.compatibility
  const failed = result.status === 'failed'
  const installed = result.installed === true
  const canInstall = !installed && !failed && !!result.latestVersion
  const canUpdate = installed && result.updateAvailable === true && !failed
  const state = installState && String(installState.artifact?.id || '') === id ? installState : null
  const busy = isArtifactBusy(state)
  const cancelable = isArtifactCancelable(state)
  const [cancelling, setCancelling] = React.useState(false)

  React.useEffect(() => {
    if (!busy) setCancelling(false)
  }, [busy])

  const cancel = async () => {
    setCancelling(true)
    try {
      await Promise.resolve(onCancel(artifact)).catch(() => {})
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Box sx={{ p: 1.35, borderRadius: 2, bgcolor: 'background.paper' }}>
      <Stack spacing={0.75}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Typography variant="body2" sx={{ minWidth: 0, flex: 1, fontWeight: 900, overflowWrap: 'anywhere' }}>
            {id}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
            <SettingsPill tone={installed ? 'selected' : 'info'}>{installed ? '已安装' : '未安装'}</SettingsPill>
            {canInstall ? (
              <Button size="small" variant="contained" startIcon={<DownloadIcon />} disabled={busy} onClick={() => onAction(artifact, 'install')}>
                {busy ? '处理中…' : '安装'}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button size="small" variant="contained" startIcon={<UpdateIcon />} disabled={busy} onClick={() => onAction(artifact, 'update')}>
                {busy ? '处理中…' : '更新'}
              </Button>
            ) : null}
            {cancelable ? (
              <Button size="small" variant="outlined" color="warning" startIcon={<CancelIcon />} disabled={cancelling} onClick={() => void cancel()}>
                {cancelling ? '取消中…' : '取消'}
              </Button>
            ) : null}
            {installed && !canUpdate && !failed && !busy ? <SettingsPill>已是最新版</SettingsPill> : null}
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            当前：<Box component="span" sx={{ color: 'text.primary', fontWeight: 800 }}>{installed ? result.currentVersion || '版本资料无效' : '未安装'}</Box>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {sourceKind === 'local' ? '货架' : '官方'}：<Box component="span" sx={{ color: 'text.primary', fontWeight: 800 }}>{result.latestVersion || '暂无'}</Box>
          </Typography>
          {result.downloadSize > 0 ? (
            <Typography variant="caption" color="text.secondary">
              大小：<Box component="span" sx={{ color: 'text.primary', fontWeight: 800 }}>{formatBytes(result.downloadSize)}</Box>
            </Typography>
          ) : null}
        </Stack>
        {compatibility ? (
          <Typography variant="caption" color={compatibility.compatible ? 'success.main' : 'error.main'} sx={{ overflowWrap: 'anywhere' }}>
            {compatibility.compatible ? `适用于当前业务端（范围 ${compatibilityRangeText(compatibility.requiredEucliBoxCompatibility)}）` : compatibility.reason || '不适用于当前业务端'}
          </Typography>
        ) : null}
        {failed && result.failureReason ? (
          <Typography variant="caption" color="error" sx={{ overflowWrap: 'anywhere' }}>
            {result.failureReason}
          </Typography>
        ) : null}
        {state && !busy && state.status === 'cancelled' ? (
          <Typography variant="caption" color="text.secondary">上次操作已取消。</Typography>
        ) : null}
        {state && String(state.error?.code || '') ? (
          <Typography variant="caption" color={state.status === 'blocked' ? 'warning.main' : 'error'} sx={{ overflowWrap: 'anywhere' }}>
            上次操作：{String(state.error.code || '')}@{String(state.error.phase || '未知阶段')}：{String(state.error.message || '未知原因')}
          </Typography>
        ) : null}
        {result.releaseNotes ? (
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {result.releaseNotes}
          </Typography>
        ) : null}
        {busy && state ? <InstallProgress state={state} /> : null}
      </Stack>
    </Box>
  )
}

// InstallProgress 展示运行中的任务：下载阶段给确定进度条与百分比，其余阶段给阶段推进。
function InstallProgress(props: { state: ArtifactInstallState }) {
  const { state } = props
  const total = Number(state.progress?.totalBytes || 0)
  const received = Number(state.progress?.receivedBytes || 0)
  const label = artifactStatusLabels[String(state.status || '')] || String(state.status || '')
  if (String(state.status || '') === 'downloading' && total > 0) {
    const percent = Math.max(0, Math.min(100, Math.round((received / total) * 100)))
    return (
      <Stack spacing={0.4} sx={{ pt: 0.25 }}>
        <LinearProgress variant="determinate" value={percent} />
        <Typography variant="caption" color="info.main">
          {label} {percent}%（{formatBytes(received)} / {formatBytes(total)}）
        </Typography>
      </Stack>
    )
  }
  return (
    <Stack spacing={0.4} sx={{ pt: 0.25 }}>
      <LinearProgress />
      <Typography variant="caption" color="info.main">
        {label}{state.phase ? `（${phaseLabel(state.phase)}）` : ''}
      </Typography>
    </Stack>
  )
}

function phaseLabel(phase: string) {
  switch (phase) {
    case 'candidate': return '检查发行'
    case 'compatibility': return '适用判断'
    case 'activity': return '检查活动'
    case 'download': return '下载'
    case 'manifest': return '核对清单'
    case 'archive': return '解包'
    case 'package': return '包内核对'
    case 'prepare': return '准备版本'
    case 'probe': return '启动探测'
    case 'switch': return '切换版本'
    case 'restore': return '恢复版本'
    case 'refresh': return '刷新状态'
    default: return phase
  }
}

function itemTitle(kind: string) {
  return kind === 'plugin' ? '系统插件' : 'AI 工具'
}

function hasSourceKind(view: ReleaseCandidatesView | null | undefined, source: StoreSourceKind, kind: string): boolean {
  if (!view?.sourceCandidates) return false
  return (view.sourceCandidates[source] || []).some((candidate) => String(candidate.artifact?.kind || '') === kind)
}

function formatBytes(value: number) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
