import * as React from 'react'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import StorefrontIcon from '@mui/icons-material/Storefront'
import RefreshIcon from '@mui/icons-material/Refresh'
import DownloadIcon from '@mui/icons-material/Download'
import UpdateIcon from '@mui/icons-material/Update'
import CancelIcon from '@mui/icons-material/Cancel'
import { artifactStatusLabels, compatibilityRangeText, isArtifactBusy, isArtifactCancelable, type ArtifactInstallState, type ArtifactReleaseCandidate, type InstallSourceStatus, type ReleaseArtifactIdentity, type ReleaseCandidatesView, type Shelf, type ShelfOutcome } from '../../domain/release'
import { SettingsPill } from './SettingsSurfaces'
import { ShelfManagerDialog } from './ShelfManagerDialog'

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
  getInstallSource?: () => Promise<InstallSourceStatus | null>
  setInstallSource?: (source: string) => Promise<{ ok: boolean; error?: string }>
  getShelves?: () => Promise<{ shelves: Shelf[]; problem: string } | null>
  addShelf?: (name: string, path: string) => Promise<ShelfOutcome | null | undefined>
  updateShelf?: (name: string, newName?: string, newPath?: string) => Promise<ShelfOutcome | null | undefined>
  removeShelf?: (name: string) => Promise<ShelfOutcome | null | undefined>
}

export function ArtifactStoreDialog(props: ArtifactStoreDialogProps) {
  const { open, onClose, kind, title, releaseView, installStates, onAction, onCancel, onSync, onRefresh, getInstallSource, setInstallSource, getShelves, addShelf, updateShelf, removeShelf } = props
  const [refreshing, setRefreshing] = React.useState(false)
  const [sourceKey, setSourceKey] = React.useState('official')
  const [sourceProblem, setSourceProblem] = React.useState('')
  const [shelves, setShelves] = React.useState<Shelf[]>([])
  const [pendingSource, setPendingSource] = React.useState<string | null>(null)
  const [sourceError, setSourceError] = React.useState('')
  const [manageOpen, setManageOpen] = React.useState(false)
  // 回调统一经引用读取最新值：父级重渲染不会更换副作用依赖，打开读取只触发一次。
  const callbacksRef = React.useRef({ onSync, onRefresh, getInstallSource, getShelves })
  callbacksRef.current = { onSync, onRefresh, getInstallSource, getShelves }

  const sourceOptions = React.useMemo(() => ['official', ...shelves.map((item) => item.name)], [shelves])
  const sourceCandidates = sourceKey
    ? releaseView?.sourceCandidates?.[sourceKey] || []
    : releaseView?.candidates || []
  const items = sourceCandidates
    .filter((candidate) => String(candidate.artifact?.kind || '') === kind)
    .sort((a, b) => String(a.artifact?.id || '').localeCompare(String(b.artifact?.id || '')))
  const busy = pendingSource !== null || refreshing

  const loadShelves = async () => {
    const view = await Promise.resolve(callbacksRef.current.getShelves?.()).catch(() => null)
    setShelves(view && Array.isArray(view.shelves) ? view.shelves : [])
  }

  // 打开弹窗时：恢复进行中任务事实，读取当前来源与货架注册表，并强制刷新当前分类清单。
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setSourceError('')
    void Promise.resolve(callbacksRef.current.onSync?.()).catch(() => {})
    Promise.resolve(callbacksRef.current.getInstallSource?.())
      .then(async (status) => {
        if (cancelled || !status) return
        setSourceKey(String(status.source || ''))
        setSourceProblem(String(status.problem || ''))
        await loadShelves()
        if (cancelled) return
        setRefreshing(true)
        await Promise.resolve(callbacksRef.current.onRefresh(kind)).catch(() => {})
        if (!cancelled) setRefreshing(false)
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
  const switchSource = async (next: string) => {
    if (next === sourceKey || busy) return
    setPendingSource(next)
    setSourceError('')
    try {
      const outcome = await Promise.resolve(setInstallSource?.(next))
      if (!outcome || !outcome.ok) {
        setSourceError(outcome?.error || '切换商店来源失败')
        return
      }
      setSourceKey(next)
      setSourceProblem('')
      // 该来源已有缓存则直接展示；没有才发起读取（读取端点自带新鲜度判定）。
      if (!hasSourceCandidates(releaseView, next)) {
        await Promise.resolve(callbacksRef.current.onRefresh(kind)).catch(() => {})
      }
    } finally {
      setPendingSource(null)
    }
  }

  // 货架注册表变更后：重建列表、跟随业务端回落的选择值，并刷新清单（淘汰旧来源键缓存）。
  const handleShelvesChanged = async () => {
    const status = await Promise.resolve(callbacksRef.current.getInstallSource?.()).catch(() => null)
    if (status) {
      setSourceKey(String(status.source || ''))
      setSourceProblem(String(status.problem || ''))
    }
    await loadShelves()
    await Promise.resolve(callbacksRef.current.onRefresh(kind)).catch(() => {})
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorefrontIcon fontSize="small" />
        {title}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          {sourceOptions.map((value) => (
            <Button
              key={value}
              size="small"
              variant={(pendingSource ?? sourceKey) === value ? 'contained' : 'outlined'}
              disabled={busy}
              startIcon={pendingSource === value ? <CircularProgress size={12} color="inherit" /> : undefined}
              onClick={() => void switchSource(value)}
            >
              {sourceLabel(value)}
            </Button>
          ))}
          <Button size="small" variant="text" disabled={busy} onClick={() => setManageOpen(true)}>
            管理货架
          </Button>
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
              当前商店来源：{sourceKey === 'official' ? '官方源（线上正式发行）' : sourceKey ? `货架「${sourceKey}」` : '配置不可用'}
            </Typography>
            {refreshing ? <CircularProgress size={12} /> : null}
          </Stack>
          {sourceProblem ? (
            <Typography variant="caption" color="error" sx={{ overflowWrap: 'anywhere' }}>
              安装来源配置不可用：{sourceProblem}。重新设置官方源或注册一个货架即可重建配置。
            </Typography>
          ) : null}
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
                sourceKey={sourceKey}
              />
            ))
          ) : busy ? (
            <Stack spacing={1} alignItems="center" sx={{ p: 3 }}>
              <CircularProgress size={22} />
              <Typography variant="body2" color="text.secondary">
                {pendingSource ? `正在切换到${sourceLabel(pendingSource)}…` : '正在获取商店清单…'}
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
      <ShelfManagerDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        shelves={shelves}
        addShelf={addShelf}
        updateShelf={updateShelf}
        removeShelf={removeShelf}
        onChanged={handleShelvesChanged}
      />
    </Dialog>
  )
}

function sourceLabel(value: string): string {
  return value === 'official' ? '官方源' : value
}

function StoreItem(props: {
  result: ArtifactReleaseCandidate
  installState: ArtifactInstallState | null
  onAction: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void
  onCancel: (artifact: ReleaseArtifactIdentity) => Promise<void> | void
  sourceKey: string
}) {
  const { result, installState, onAction, onCancel, sourceKey } = props
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
            {sourceKey === 'official' ? '官方' : sourceKey}：<Box component="span" sx={{ color: 'text.primary', fontWeight: 800 }}>{result.latestVersion || '暂无'}</Box>
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

function hasSourceCandidates(view: ReleaseCandidatesView | null | undefined, source: string): boolean {
  return (view?.sourceCandidates?.[source]?.length ?? 0) > 0
}

function formatBytes(value: number) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
