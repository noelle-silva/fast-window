import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { DEFAULT_APP_STORE_CATALOG_URL } from '../constants'
import { getAppsDir, pickAppInstallDir } from '../appStore/appInstaller'
import { fetchStoreCatalog } from '../appStore/catalogClient'
import type { StoreAppEntry, StoreCatalog } from '../appStore/catalogTypes'
import { isStoreImageIcon, storeIconToDisplay } from '../appStore/icon'
import { loadLocalStoreApps, type LocalStoreApp } from '../appStore/localApps'
import { cmpSemver, parseSemverStrict } from '../appStore/semver'
import { cancelStoreTask, dismissStoreTask, startStoreTask, type StoreTaskSnapshot } from '../appStore/storeTasks'
import { useStoreTasks, type StoreTasksMap } from '../appStore/useStoreTasks'
import { loadRegistry } from '../apps/appRegistry'
import { hostToast } from '../host/hostPrimitives'
import HostPageHeader from './HostPageHeader'
import { hostButtonSx, hostDangerButtonSx, hostPageRootSx, hostPageScrollSx, hostSoftChipSx, hostSurfaceSx } from './hostUiStyles'
import { useHostAppearance, type HostSurfaceMode } from './hostAppearance'

type Props = {
  onBack: () => void
}

type ConfirmState = { item: StoreAppEntry; action: 'install' | 'update' }

function toast(message: string) {
  void hostToast(message)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function installedVersion(recordVersion: string | undefined): string {
  const version = String(recordVersion || '').trim()
  return version
}

function compareVersions(remote: string, local: string): number | null {
  const remoteSemver = parseSemverStrict(remote)
  const localSemver = parseSemverStrict(local)
  if (!remoteSemver || !localSemver) return null
  return cmpSemver(remoteSemver, localSemver)
}

function iconDisplay(icon: string, fallback: string): { src: string; text: string } {
  if (icon && (isStoreImageIcon(icon) || isHttpUrl(icon))) return { src: icon, text: '' }
  return { src: '', text: icon || fallback }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function taskPhaseLabel(task: StoreTaskSnapshot): string {
  if (task.cancelRequested) return '正在取消…'
  if (task.phase === 'downloading') return '下载中'
  if (task.phase === 'extracting') return '解压中'
  return task.action === 'update' ? '正在应用更新' : '正在安装'
}

export default function AppStoreView(props: Props) {
  const { onBack } = props

  const [catalog, setCatalog] = useState<StoreCatalog | null>(null)
  const [localApps, setLocalApps] = useState<Map<string, LocalStoreApp>>(new Map())
  const [defaultAppsDir, setDefaultAppsDir] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const refreshLocalState = useCallback(async (storeIds: readonly string[]) => {
    const [apps, appsDir] = await Promise.all([
      loadRegistry(),
      getAppsDir().catch(() => ''),
    ])
    const localStoreApps = await loadLocalStoreApps(storeIds, apps)
    setLocalApps(localStoreApps)
    setDefaultAppsDir(appsDir)
  }, [])

  const onTaskFinished = useCallback((task: StoreTaskSnapshot) => {
    if (task.status !== 'succeeded') return
    void refreshLocalState((catalog?.apps ?? []).map(item => item.id))
  }, [catalog, refreshLocalState])

  const tasks = useStoreTasks(onTaskFinished)

  const refresh = useCallback(async () => {
    const requestId = ++requestSeqRef.current
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    setError('')
    try {
      const next = await fetchStoreCatalog(DEFAULT_APP_STORE_CATALOG_URL, 25_000, ac.signal)
      if (requestId !== requestSeqRef.current) return
      setCatalog(next)
      await refreshLocalState(next.apps.map(item => item.id))
    } catch (e: any) {
      if (requestId !== requestSeqRef.current) return
      const msg = String(e?.message || e || '').trim()
      const isAbort = String(e?.name || '') === 'AbortError' || msg.toLowerCase().includes('abort')
      setCatalog(null)
      setError(isAbort ? '加载超时或已取消，请重试' : (msg || '加载失败'))
    } finally {
      if (requestId === requestSeqRef.current) setLoading(false)
    }
  }, [refreshLocalState])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCancel = useCallback(async (appId: string) => {
    try {
      await cancelStoreTask(appId)
    } catch (e: any) {
      toast(String(e?.message || e || '取消失败'))
    }
  }, [])

  const handleDismiss = useCallback(async (appId: string) => {
    try {
      await dismissStoreTask(appId)
    } catch (e: any) {
      toast(String(e?.message || e || '清除失败'))
    }
  }, [])

  async function doConfirm() {
    if (!confirm) return
    const current = confirm
    setConfirm(null)
    setError('')
    const item = current.item
    try {
      let installDir: string | undefined
      if (current.action === 'install') {
        const picked = await pickAppInstallDir()
        if (!picked) return
        installDir = picked
      }
      await startStoreTask({
        action: current.action,
        url: item.platforms.windows.downloadUrl,
        expectedSha256: item.platforms.windows.sha256,
        expectedId: item.id,
        expectedVersion: item.version,
        appName: item.name,
        installDir,
      })
    } catch (e: any) {
      setError(String(e?.message || e || '启动任务失败'))
    }
  }

  const hostAppearance = useHostAppearance()
  const panelSx = hostSurfaceSx(hostAppearance.surfaceMode)
  const { desktop: desktopApps, service: serviceApps } = splitAppsByType(catalog?.apps ?? [])

  return (
    <Box sx={hostPageRootSx}>
      <HostPageHeader
        title="应用商店"
        onBack={onBack}
        translucent={hostAppearance.glassEnabled}
        action={(
          <IconButton aria-label="刷新" size="small" onClick={() => void refresh()} disabled={loading}>
            <RefreshRoundedIcon fontSize="small" />
          </IconButton>
        )}
      />

      <Box sx={hostPageScrollSx}>
        <Stack spacing={1.25}>
          {error ? <StoreError message={error} /> : null}
          {loading ? <StoreLoading /> : null}
          {!loading && catalog ? (
            <>
              <StoreAppSection
                title="桌面应用"
                badge="桌面"
                note={`初次安装会选择安装目录，默认位置：${defaultAppsDir || 'apps'}；已注册应用会直接更新。`}
                emptyText="暂无桌面应用"
                items={desktopApps}
                localApps={localApps}
                tasks={tasks}
                panelSx={panelSx}
                surfaceMode={hostAppearance.surfaceMode}
                onAction={(item, action) => setConfirm({ item, action })}
                onCancel={(appId) => void handleCancel(appId)}
                onDismiss={(appId) => void handleDismiss(appId)}
              />
              {serviceApps.length > 0 ? (
                <StoreAppSection
                  title="服务应用"
                  badge="服务"
                  items={serviceApps}
                  localApps={localApps}
                  tasks={tasks}
                  panelSx={panelSx}
                  surfaceMode={hostAppearance.surfaceMode}
                  onAction={(item, action) => setConfirm({ item, action })}
                  onCancel={(appId) => void handleCancel(appId)}
                  onDismiss={(appId) => void handleDismiss(appId)}
                />
              ) : null}
            </>
          ) : null}
        </Stack>
      </Box>

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} onConfirm={() => void doConfirm()} />
    </Box>
  )
}

function StoreError({ message }: { message: string }) {
  return (
    <Alert severity="error" sx={{ border: 0, borderRadius: 3 }}>
      {message}
    </Alert>
  )
}

function StoreLoading() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <CircularProgress size={18} />
      <Typography variant="body2" color="text.secondary">正在加载…</Typography>
    </Box>
  )
}

function StoreAppSection(props: {
  title: string
  badge: string
  note?: string
  emptyText?: string
  items: StoreAppEntry[]
  localApps: Map<string, LocalStoreApp>
  tasks: StoreTasksMap
  panelSx: (theme: any) => any
  surfaceMode: HostSurfaceMode
  onAction: (item: StoreAppEntry, action: 'install' | 'update') => void
  onCancel: (appId: string) => void
  onDismiss: (appId: string) => void
}) {
  const { title, badge, note, emptyText, items, localApps, tasks, panelSx, surfaceMode, onAction, onCancel, onDismiss } = props
  return (
    <Box sx={panelSx}>
      <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.5 }}>{title}（{items.length}）</Typography>
      {note ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
          {note}
        </Typography>
      ) : null}
      {items.length === 0 ? (emptyText ? <EmptyText text={emptyText} /> : null) : (
        <StoreGrid>
          {items.map(item => {
            const local = localApps.get(item.id)
            const localVersion = installedVersion(local?.version)
            const compare = localVersion ? compareVersions(item.version, localVersion) : null
            const needsUpdate = !!local && (!localVersion || compare == null || compare > 0)
            const action: 'install' | 'update' | 'none' = !local ? 'install' : needsUpdate ? 'update' : 'none'
            const icon = storeIconToDisplay(item.icon)
            const display = iconDisplay(icon, (item.name || item.id).slice(0, 1) || 'A')
            const versionText = !local
              ? item.version
              : needsUpdate
                ? `${localVersion || '未知'} → ${item.version}`
                : (localVersion || item.version)
            return (
              <StoreListItem
                key={item.id}
                id={item.id}
                name={item.name}
                description={item.description}
                versionText={versionText}
                iconSrc={display.src}
                iconText={display.text}
                badge={badge}
                action={action}
                doneText={local ? '已是最新' : '已安装'}
                task={tasks.get(item.id)}
                surfaceMode={surfaceMode}
                onAction={() => action !== 'none' && onAction(item, action)}
                onCancel={() => onCancel(item.id)}
                onDismiss={() => onDismiss(item.id)}
              />
            )
          })}
        </StoreGrid>
      )}
    </Box>
  )
}

function StoreGrid({ children }: { children: React.ReactNode }) {
  return (
    <List dense disablePadding sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.75, alignItems: 'stretch' }}>
      {children}
    </List>
  )
}

function StoreListItem(props: {
  id: string
  name: string
  description: string
  versionText: string
  iconSrc: string
  iconText: string
  badge: string
  action: 'install' | 'update' | 'none'
  doneText: string
  task?: StoreTaskSnapshot
  surfaceMode: HostSurfaceMode
  onAction: () => void
  onCancel: () => void
  onDismiss: () => void
}) {
  const { id, name, description, versionText, iconSrc, iconText, badge, action, doneText, task, surfaceMode, onAction, onCancel, onDismiss } = props
  const running = task?.status === 'running'
  const cancelBlocked = !!task && (task.cancelRequested || task.phase === 'applying')

  return (
    <ListItem
      disableGutters
      secondaryAction={running ? (
        <Button variant="text" size="small" onClick={onCancel} disabled={cancelBlocked} sx={hostDangerButtonSx}>
          {task?.cancelRequested ? '取消中' : '取消'}
        </Button>
      ) : action === 'none' ? (
        <Chip size="small" label={doneText} sx={hostSoftChipSx} />
      ) : (
        <Button variant="contained" size="small" onClick={onAction} sx={hostButtonSx}>
          {action === 'install' ? '安装' : '更新'}
        </Button>
      )}
      sx={theme => ({
        ...hostSurfaceSx(surfaceMode, { tone: 'item' })(theme),
        position: 'relative',
        alignItems: 'flex-start',
        height: '100%',
        '& .MuiListItemSecondaryAction-root': { top: 10, right: 10, transform: 'none' },
        '&:hover': { bgcolor: 'action.selected' },
      })}
    >
      <ListItemAvatar sx={{ minWidth: 44, mt: 0.1 }}>
        <Avatar variant="rounded" src={iconSrc || undefined} imgProps={{ alt: `${name || id} 图标` }} sx={{ width: 34, height: 34, fontSize: 18, bgcolor: 'action.hover', color: 'text.primary' }}>
          {iconSrc ? null : iconText}
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={(
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, pr: 10 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{name}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{id}</Typography>
            <Chip size="small" label={badge} sx={{ ...hostSoftChipSx, height: 18, fontSize: 10 }} />
          </Box>
        )}
        secondary={(
          <Box sx={{ mt: 0.5, pr: 10 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>版本：{versionText}</Typography>
            {description ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{description}</Typography> : null}
            {task ? <StoreTaskLine task={task} onDismiss={onDismiss} /> : null}
          </Box>
        )}
      />
    </ListItem>
  )
}

function StoreTaskLine({ task, onDismiss }: { task: StoreTaskSnapshot; onDismiss: () => void }) {
  if (task.status === 'running') {
    const done = task.progress?.done ?? 0
    const total = task.progress?.total
    const determinate = typeof total === 'number' && total > 0
    const percent = determinate ? Math.min(100, Math.round((done / total) * 100)) : null
    return (
      <Box sx={{ mt: 0.75, maxWidth: 420 }}>
        <LinearProgress
          variant={determinate ? 'determinate' : 'indeterminate'}
          value={percent ?? undefined}
          sx={{ height: 6, borderRadius: 3 }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary" noWrap>{taskPhaseLabel(task)}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {taskProgressDetail(task, percent)}
          </Typography>
        </Box>
      </Box>
    )
  }

  const resultText = task.status === 'succeeded'
    ? '已完成'
    : task.status === 'canceled'
      ? '已取消'
      : `失败：${task.error || '未知错误'}`
  return (
    <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'flex-start', gap: 0.25 }}>
      <Typography
        variant="caption"
        color={task.status === 'failed' ? 'error' : 'text.secondary'}
        sx={{ wordBreak: 'break-word' }}
      >
        {resultText}
      </Typography>
      <IconButton aria-label="清除任务结果" size="small" onClick={onDismiss} sx={{ p: 0.25 }}>
        <CloseRoundedIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  )
}

function taskProgressDetail(task: StoreTaskSnapshot, percent: number | null): string {
  if (task.cancelRequested) return ''
  const done = task.progress?.done ?? 0
  const total = task.progress?.total
  if (task.phase === 'downloading') {
    if (typeof total === 'number' && total > 0) return `${formatBytes(done)} / ${formatBytes(total)} · ${percent}%`
    return formatBytes(done)
  }
  if (task.phase === 'extracting' && typeof total === 'number' && total > 0) {
    return `${done} / ${total} 个文件 · ${percent}%`
  }
  return ''
}

function splitAppsByType(apps: StoreAppEntry[]): { desktop: StoreAppEntry[]; service: StoreAppEntry[] } {
  const desktop: StoreAppEntry[] = []
  const service: StoreAppEntry[] = []
  for (const item of apps) {
    if (item.type === 'service-app') service.push(item)
    else desktop.push(item)
  }
  return { desktop, service }
}

function EmptyText({ text }: { text: string }) {
  return <Typography variant="body2" color="text.secondary">{text}</Typography>
}

function ConfirmDialog(props: {
  confirm: ConfirmState | null
  onClose: () => void
  onConfirm: () => void
}) {
  const { confirm, onClose, onConfirm } = props
  const title = confirm?.action === 'install' ? '安装 v5 应用' : '更新 v5 应用'
  const name = confirm?.item.name || ''
  const id = confirm?.item.id || ''
  const version = confirm?.item.version || ''
  return (
    <Dialog open={!!confirm} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {confirm ? (
          <>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{name}（{id}）</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>版本：{version}</Typography>
            {confirm.action === 'install' ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>下一步会弹出目录选择窗口，安装成功后自动注册到 v5 应用列表。</Typography>
            ) : null}
            {confirm.action === 'update' ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>更新会使用已注册应用的安装目录，并在替换文件前停止正在运行的应用。</Typography>
            ) : null}
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={onConfirm} disabled={!confirm}>确认</Button>
      </DialogActions>
    </Dialog>
  )
}
