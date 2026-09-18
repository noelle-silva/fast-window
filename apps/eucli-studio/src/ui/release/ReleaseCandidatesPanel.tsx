import * as React from 'react'
import { Box, Button, Link, Stack, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { ArtifactReleaseCandidate, ReleaseArtifactIdentity, ReleaseCandidatesView } from '../../domain/release'

type ReleaseCandidatesPanelProps = {
  view?: ReleaseCandidatesView | null
  busy?: boolean
  onRefresh?: (kind?: string) => Promise<void> | void
  compact?: boolean
  kindFilter?: string
  onToolAction?: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void
  onPluginAction?: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void
  toolActionBusy?: boolean
  pluginActionBusy?: boolean
}

export function ReleaseCandidatesPanel(props: ReleaseCandidatesPanelProps) {
  const view = props.view || emptyView()
  const checking = props.busy === true || view.status === 'checking'
  const results = Array.isArray(view.candidates)
    ? view.candidates.filter((candidate) => !props.kindFilter || String(candidate.artifact?.kind || '') === props.kindFilter)
    : []

  return (
    <Stack spacing={1.25} aria-live="polite">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 900 }}>正式版本</Typography>
            <StatusPill status={view.status} />
          </Stack>
          {view.checkedAt ? (
            <Typography variant="caption" color="text.secondary">
              最近读取：{formatCheckedAt(view.checkedAt)}
            </Typography>
          ) : null}
        </Box>
        <Button
          startIcon={<RefreshIcon />}
          variant="text"
          onClick={() => props.onRefresh?.(props.kindFilter)}
          disabled={!props.onRefresh || checking}
          sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
        >
          {checking ? '读取中…' : '重新读取'}
        </Button>
      </Stack>

      {view.failing.length ? (
        <Typography variant="body2" color="error" role="alert" sx={{ overflowWrap: 'anywhere' }}>
          {view.failing.join('；')}
        </Typography>
      ) : null}

      {results.length ? (
        <Stack spacing={1}>
          {results.map((result) => (
            <ReleaseCandidateItem
              key={`${result.artifact.kind}:${result.artifact.id}`}
              result={result}
              compact={props.compact === true}
              onToolAction={props.onToolAction}
              onPluginAction={props.onPluginAction}
              toolActionBusy={props.toolActionBusy === true}
              pluginActionBusy={props.pluginActionBusy === true}
            />
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {checking ? '正在读取发行来源记录。' : view.status === 'failed' ? '本次没有取得可用的发行记录。' : '尚未读取发行记录。'}
        </Typography>
      )}
    </Stack>
  )
}

function ReleaseCandidateItem(props: { result: ArtifactReleaseCandidate; compact: boolean; onToolAction?: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void; onPluginAction?: (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => Promise<void> | void; toolActionBusy: boolean; pluginActionBusy: boolean }) {
  const { result, compact } = props
  const status = resultStatus(result)
  const compatibility = result.compatibility
  const kind = String(result.artifact.kind || '')
  const isTool = kind === 'tool'
  const isPlugin = kind === 'plugin'
  const actionBusy = (isTool && props.toolActionBusy) || (isPlugin && props.pluginActionBusy)
  const actionHandler = isTool ? props.onToolAction : isPlugin ? props.onPluginAction : undefined
  const canInstall = status.label === '可安装' && !!actionHandler
  const canUpdate = status.label === '可更新' && !!actionHandler
  const actionLabel = status.label === '可安装' ? '安装' : status.label === '可更新' ? '更新' : ''

  return (
    <Box sx={{ p: compact ? 1.1 : 1.35, borderRadius: 2, bgcolor: 'action.hover' }}>
      <Stack spacing={0.75}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Typography variant="body2" sx={{ minWidth: 0, flex: 1, fontWeight: 900, overflowWrap: 'anywhere' }}>
            {artifactLabel(result.artifact)}
          </Typography>
          <StatusPill status={status.tone} label={status.label} />
          {actionLabel ? (
            <Button
              size="small"
              variant="contained"
              disabled={actionBusy || !(canInstall || canUpdate)}
              onClick={() => actionHandler?.(result.artifact, canInstall ? 'install' : 'update')}
              sx={{ minWidth: 72 }}
            >
              {actionBusy ? '处理中…' : actionLabel}
            </Button>
          ) : null}
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          <ReleaseFact label="当前" value={result.installed ? result.currentVersion || '版本资料无效' : '未安装'} />
          <ReleaseFact label="可用" value={result.latestVersion || '暂无正式发行'} />
          {result.downloadSize > 0 ? <ReleaseFact label="大小" value={formatBytes(result.downloadSize)} /> : null}
        </Stack>

        {compatibility ? (
          <Typography variant="caption" color={compatibility.compatible ? 'success.main' : 'error.main'} sx={{ overflowWrap: 'anywhere' }}>
            {compatibility.compatible ? '适用于当前业务端' : compatibility.reason || '不适用于当前业务端'}
          </Typography>
        ) : null}

        {result.affectedArtifacts.length ? (
          <Typography variant="caption" color="warning.main" sx={{ overflowWrap: 'anywhere' }}>
            更新后预计受影响：{result.affectedArtifacts.map(artifactLabel).join('、')}
          </Typography>
        ) : null}

        {result.failureReason ? (
          <Typography variant="caption" color="error" role="alert" sx={{ overflowWrap: 'anywhere' }}>
            {result.failureReason}
          </Typography>
        ) : null}

        {result.releaseNotes ? (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {result.releaseNotes}
          </Typography>
        ) : null}

        {result.releaseUrl ? (
          <Link href={result.releaseUrl} target="_blank" rel="noreferrer" variant="caption" sx={{ width: 'fit-content', fontWeight: 800 }}>
            查看官方发行页面
          </Link>
        ) : null}
      </Stack>
    </Box>
  )
}

function StatusPill(props: { status: string; label?: string }) {
  const status = String(props.status || 'not_checked')
  const color = status === 'failed' ? 'error.main' : status === 'completed' || status === 'available' ? 'success.main' : 'text.secondary'
  const background = status === 'failed' ? 'rgba(220,38,38,.10)' : status === 'completed' || status === 'available' ? 'rgba(22,163,74,.10)' : 'action.selected'
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 24, px: 1, borderRadius: 999, bgcolor: background, color, fontSize: 12, fontWeight: 800, lineHeight: 1 }}>
      {props.label || viewStatusLabel(status)}
    </Box>
  )
}

function ReleaseFact(props: { label: string; value: string }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
      {props.label}：<Box component="span" sx={{ color: 'text.primary', fontWeight: 800 }}>{props.value}</Box>
    </Typography>
  )
}

function resultStatus(result: ArtifactReleaseCandidate): { tone: string; label: string } {
  if (result.status === 'failed') return { tone: 'failed', label: '读取失败' }
  if (!result.latestVersion) return { tone: 'completed', label: '暂无正式发行' }
  if (!result.installed) return { tone: 'available', label: '可安装' }
  if (result.updateAvailable) return { tone: 'available', label: '可更新' }
  return { tone: 'completed', label: '已是最新版' }
}

function viewStatusLabel(status: string) {
  if (status === 'checking') return '读取中'
  if (status === 'completed') return '读取完成'
  if (status === 'failed') return '读取失败'
  return '尚未读取'
}

function artifactLabel(artifact: ReleaseArtifactIdentity) {
  if (artifact.kind === 'tool') return `AI 工具 · ${artifact.id || '未知'}`
  if (artifact.kind === 'plugin') return `系统插件 · ${artifact.id || '未知'}`
  return artifact.id || '未知发布物'
}

function formatCheckedAt(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间资料无效'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(date)
}

function formatBytes(value: number) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function emptyView(): ReleaseCandidatesView {
  return {
    status: 'not_checked',
    statuses: {},
    source: 'official',
    checkedAt: '',
    checkedAts: {},
    failing: [],
    candidates: [],
    installations: [],
    sourceCandidates: { official: [], local: [] },
    sourceCheckedAts: {
      official: { tool: '', plugin: '' },
      local: { tool: '', plugin: '' },
    },
  }
}
