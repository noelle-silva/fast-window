import * as React from 'react'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import StorefrontIcon from '@mui/icons-material/Storefront'
import RefreshIcon from '@mui/icons-material/Refresh'
import DownloadIcon from '@mui/icons-material/Download'
import UpdateIcon from '@mui/icons-material/Update'
import { artifactStatusLabels, compatibilityRangeText, type ArtifactReleaseCandidate, type ReleaseArtifactIdentity, type ReleaseCandidatesView } from '../../domain/release'
import { SettingsPill } from './SettingsSurfaces'

type StoreSourceKind = 'official' | 'local'

type ArtifactStoreDialogProps = {
  open: boolean
  onClose: () => void
  kind: 'tool' | 'plugin'
  title: string
  releaseView?: ReleaseCandidatesView | null
  installState: any
  actionBusy: boolean
  onAction: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void
  onRead: (kind: string) => Promise<void> | void
  onRefresh: (kind?: string) => Promise<void> | void
  getInstallSource?: () => Promise<string | null>
  setInstallSource?: (kind: StoreSourceKind) => Promise<{ ok: boolean; error?: string }>
}

export function ArtifactStoreDialog(props: ArtifactStoreDialogProps) {
  const { open, onClose, kind, title, releaseView, installState, actionBusy, onAction, onRead, onRefresh, getInstallSource, setInstallSource } = props
  const [refreshing, setRefreshing] = React.useState(false)
  const [sourceKind, setSourceKind] = React.useState<StoreSourceKind>('official')
  const [pendingSource, setPendingSource] = React.useState<StoreSourceKind | null>(null)
  const [sourceError, setSourceError] = React.useState('')
  // 回调统一经引用读取最新值：父级重渲染不会更换副作用依赖，打开读取只触发一次。
  const callbacksRef = React.useRef({ onRead, onRefresh, getInstallSource })
  callbacksRef.current = { onRead, onRefresh, getInstallSource }

  const sourceCandidates = releaseView?.sourceCandidates?.[sourceKind] || []
  const items = sourceCandidates
    .filter((candidate) => String(candidate.artifact?.kind || '') === kind)
    .sort((a, b) => String(a.artifact?.id || '').localeCompare(String(b.artifact?.id || '')))
  const busy = pendingSource !== null || refreshing

  // 打开弹窗时读取当前来源：已有新鲜缓存不重复读取；没有缓存才按分类读取一次。
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setSourceError('')
    Promise.resolve(callbacksRef.current.getInstallSource?.())
      .then((source) => {
        if (cancelled || (source !== 'official' && source !== 'local')) return
        setSourceKind(source)
        void Promise.resolve(callbacksRef.current.onRead(kind)).catch(() => {})
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
        await Promise.resolve(callbacksRef.current.onRead(kind)).catch(() => {})
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
          <Typography variant="caption" color="text.secondary">
            当前商店源：{sourceKind === 'local' ? '本地源（programs/local-store 货架）' : '官方源（线上正式发行）'}
          </Typography>
          {sourceError ? (
            <Typography variant="caption" color="error">
              {sourceError}
            </Typography>
          ) : null}
          {busy ? (
            <Stack spacing={1} alignItems="center" sx={{ p: 3 }}>
              <CircularProgress size={22} />
              <Typography variant="body2" color="text.secondary">
                {pendingSource ? `正在切换到${pendingSource === 'local' ? '本地源' : '官方源'}…` : '正在获取商店清单…'}
              </Typography>
            </Stack>
          ) : items.length ? (
            items.map((result) => (
              <StoreItem key={`${result.artifact.kind}:${result.artifact.id}`} result={result} installState={installState} actionBusy={actionBusy} onAction={onAction} sourceKind={sourceKind} />
            ))
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              {`当前没有可显示的${itemTitle(kind)}。请先刷新商店清单。`}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
          安装或更新由业务端在后台完成，客户端只发起一次动作。
        </Typography>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}

function StoreItem(props: { result: ArtifactReleaseCandidate; installState: any; actionBusy: boolean; onAction: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void; sourceKind: StoreSourceKind }) {
  const { result, installState, actionBusy, onAction, sourceKind } = props
  const artifact = result.artifact
  const id = String(artifact?.id || '')
  const compatibility = result.compatibility
  const failed = result.status === 'failed'
  const installed = result.installed === true
  const canInstall = !installed && !failed && !!result.latestVersion
  const canUpdate = installed && result.updateAvailable === true && !failed
  const stateForItem = installState && typeof installState === 'object' && String(installState.artifact?.id || '') === id ? installState : null
  const stateStatus = String(stateForItem?.status || '')
  const stateError = stateForItem?.error && typeof stateForItem.error === 'object' ? stateForItem.error : {}
  const busy = actionBusy || stateStatus === 'downloading' || stateStatus === 'verifying' || stateStatus === 'preparing' || stateStatus === 'switching' || stateStatus === 'starting' || stateStatus === 'restoring'

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
            {installed && !canUpdate && !failed ? <SettingsPill>已是最新版</SettingsPill> : null}
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
        {stateForItem && String(stateError.code || '') ? (
          <Typography variant="caption" color={stateStatus === 'blocked' ? 'warning.main' : 'error'} sx={{ overflowWrap: 'anywhere' }}>
            上次操作：{String(stateError.code || '')}@{String(stateError.phase || '未知阶段')}：{String(stateError.message || '未知原因')}
          </Typography>
        ) : null}
        {result.releaseNotes ? (
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {result.releaseNotes}
          </Typography>
        ) : null}
        {busy ? (
          <Typography variant="caption" color="info.main">
            处理中：{artifactStatusLabels[stateStatus] || stateStatus}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  )
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
