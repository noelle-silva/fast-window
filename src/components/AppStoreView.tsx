import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
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
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { DEFAULT_APP_STORE_CATALOG_URL } from '../constants'
import { appStoreInstall, appStoreUpdate, getAppsDir, pickAppInstallDir } from '../appStore/appInstaller'
import { fetchStoreCatalog } from '../appStore/catalogClient'
import type { LegacyPluginStoreEntry, StoreAppEntry, StoreCatalog } from '../appStore/catalogTypes'
import { isStoreImageIcon, storeIconToDisplay } from '../appStore/icon'
import { loadLocalStoreApps, type LocalStoreApp } from '../appStore/localApps'
import { cmpSemver, parseSemverStrict } from '../appStore/semver'
import { loadRegistry } from '../apps/appRegistry'
import { pluginStoreInstall } from '../plugins/pluginStore'
import { getPluginAssetMime, isDataImageUrl, resolveLocalPluginIconPath } from '../plugins/pluginIcon'
import { getWallpaperSettings, type WallpaperSettings } from '../wallpaper'
import { hostToast } from '../host/hostPrimitives'
import HostPageHeader from './HostPageHeader'
import { hostButtonSx, hostPageRootSx, hostPageScrollSx, hostSoftChipSx, hostSurfaceSx } from './hostUiStyles'

type Props = {
  onBack: () => void
}

type LocalPluginMeta = {
  versions: Map<string, string>
  icons: Map<string, string>
}

type ConfirmState =
  | { kind: 'app'; item: StoreAppEntry; action: 'install' | 'update' }
  | { kind: 'plugin'; item: LegacyPluginStoreEntry; action: 'install' | 'update' }

type BusyState =
  | { kind: 'app'; id: string; action: 'install' | 'update' }
  | { kind: 'plugin'; id: string; action: 'install' | 'update' }

function toast(message: string) {
  void hostToast(message)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isSafeRelPath(path: string): boolean {
  if (!path) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  const parts = path.split(/[\\/]+/g)
  return parts.every(p => p !== '' && p !== '.' && p !== '..')
}

async function resolveLocalPluginIcon(pluginId: string, icon: unknown): Promise<string> {
  const raw = typeof icon === 'string' ? icon.trim() : ''
  if (!raw) return ''
  if (isDataImageUrl(raw) || isHttpUrl(raw)) return raw

  const path = resolveLocalPluginIconPath(raw)
  const mime = path && isSafeRelPath(path) ? getPluginAssetMime(path) : ''
  if (mime) {
    try {
      const b64 = await invoke<string>('read_plugin_file_base64', { pluginId, path })
      return `data:${mime};base64,${b64}`
    } catch {
      return ''
    }
  }

  return raw.length <= 8 ? raw : ''
}

async function loadLocalPluginMeta(): Promise<LocalPluginMeta> {
  const versions = new Map<string, string>()
  const icons = new Map<string, string>()
  const ids = await invoke<string[]>('list_plugins').catch(() => [] as string[])
  for (const id of ids) {
    const pluginId = String(id || '').trim()
    if (!pluginId) continue
    try {
      const manifestText = await invoke<string>('read_plugin_file', { pluginId, path: 'manifest.json' })
      const m = JSON.parse(manifestText || '{}') as any
      const version = typeof m?.version === 'string' ? m.version.trim() : ''
      if (version) versions.set(pluginId, version)
      const icon = await resolveLocalPluginIcon(pluginId, m?.icon)
      if (icon) icons.set(pluginId, icon)
    } catch {}
  }
  return { versions, icons }
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

export default function AppStoreView(props: Props) {
  const { onBack } = props

  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(null)
  const [catalog, setCatalog] = useState<StoreCatalog | null>(null)
  const [localApps, setLocalApps] = useState<Map<string, LocalStoreApp>>(new Map())
  const [localPlugins, setLocalPlugins] = useState<LocalPluginMeta>({ versions: new Map(), icons: new Map() })
  const [defaultAppsDir, setDefaultAppsDir] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [busy, setBusy] = useState<BusyState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)

  useEffect(() => {
    void getWallpaperSettings()
      .then(v => setWallpaper(v))
      .catch(() => setWallpaper({ enabled: false, opacity: 0.65, blur: 0, titlebarOpacity: 0.62, titlebarBlur: 12, filePath: null }))
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const refreshLocalState = useCallback(async () => {
    const [apps, pluginMeta, appsDir] = await Promise.all([
      loadRegistry(),
      loadLocalPluginMeta(),
      getAppsDir().catch(() => ''),
    ])
    const localStoreApps = await loadLocalStoreApps(apps)
    setLocalApps(localStoreApps)
    setLocalPlugins(pluginMeta)
    setDefaultAppsDir(appsDir)
  }, [])

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
      await refreshLocalState()
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

  async function doAppInstall(item: StoreAppEntry, action: 'install' | 'update') {
    const asset = item.platforms.windows
    if (action === 'install') {
      const installDir = await pickAppInstallDir()
      if (!installDir) return
      setBusy({ kind: 'app', id: item.id, action })
      const result = await appStoreInstall({
        url: asset.downloadUrl,
        expectedSha256: asset.sha256,
        expectedId: item.id,
        expectedVersion: item.version,
        installDir,
      })
      if (result.appId !== item.id) toast(`警告：安装的应用 ID 为 ${result.appId}，与商店条目 ${item.id} 不一致`)
      toast(`已安装应用：${item.name}`)
      return
    }

    setBusy({ kind: 'app', id: item.id, action })
    const result = await appStoreUpdate({
      url: asset.downloadUrl,
      expectedSha256: asset.sha256,
      expectedId: item.id,
      expectedVersion: item.version,
    })
    if (result.appId !== item.id) toast(`警告：更新的应用 ID 为 ${result.appId}，与商店条目 ${item.id} 不一致`)
    toast(`已更新应用：${item.name}`)
  }

  async function doPluginInstall(item: LegacyPluginStoreEntry, action: 'install' | 'update') {
    setBusy({ kind: 'plugin', id: item.id, action })
    const result = await pluginStoreInstall({
      url: item.downloadUrl,
      expectedSha256: item.sha256,
      expectedId: item.id,
      expectedVersion: item.version,
      expectedRequires: item.requires || [],
    })
    window.dispatchEvent(new CustomEvent('fast-window:plugins-changed'))
    if (result.pluginId !== item.id) toast(`警告：安装的插件 ID 为 ${result.pluginId}，与商店条目 ${item.id} 不一致`)
    toast(action === 'install' ? `已安装插件：${item.name}` : `已更新插件：${item.name}`)
  }

  async function doConfirm() {
    if (!confirm || busy) return
    const current = confirm
    setConfirm(null)
    setError('')
    try {
      if (current.kind === 'app') await doAppInstall(current.item, current.action)
      else await doPluginInstall(current.item, current.action)
      await refreshLocalState()
      if (current.kind === 'app') window.dispatchEvent(new CustomEvent('fast-window:registered-apps-changed'))
    } catch (e: any) {
      setError(String(e?.message || e || '安装失败'))
    } finally {
      setBusy(null)
    }
  }

  const wallpaperEnabled = wallpaper?.enabled === true
  const panelSx = hostSurfaceSx(wallpaperEnabled)

  return (
    <Box sx={hostPageRootSx}>
      <HostPageHeader
        title="应用商店"
        onBack={onBack}
        translucent={wallpaperEnabled}
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
                items={catalog.apps}
                localApps={localApps}
                busy={busy}
                defaultAppsDir={defaultAppsDir}
                panelSx={panelSx}
                wallpaperEnabled={wallpaperEnabled}
                onAction={(item, action) => setConfirm({ kind: 'app', item, action })}
              />
              <LegacyPluginSection
                items={catalog.plugins}
                localPlugins={localPlugins}
                busy={busy}
                panelSx={panelSx}
                wallpaperEnabled={wallpaperEnabled}
                onAction={(item, action) => setConfirm({ kind: 'plugin', item, action })}
              />
            </>
          ) : null}
        </Stack>
      </Box>

      <ConfirmDialog confirm={confirm} busy={!!busy} onClose={() => setConfirm(null)} onConfirm={() => void doConfirm()} />
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
  items: StoreAppEntry[]
  localApps: Map<string, LocalStoreApp>
  busy: BusyState | null
  defaultAppsDir: string
  panelSx: (theme: any) => any
  wallpaperEnabled: boolean
  onAction: (item: StoreAppEntry, action: 'install' | 'update') => void
}) {
  const { items, localApps, busy, defaultAppsDir, panelSx, wallpaperEnabled, onAction } = props
  return (
    <Box sx={panelSx}>
      <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.5 }}>v5 应用（{items.length}）</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
        初次安装会选择安装目录，默认位置：{defaultAppsDir || 'apps'}；已注册应用会直接更新。
      </Typography>
      {items.length === 0 ? <EmptyText text="catalog.apps 中未发现有效条目" /> : (
        <StoreGrid>
          {items.map(item => {
            const local = localApps.get(item.id)
            const localVersion = installedVersion(local?.version)
            const compare = localVersion ? compareVersions(item.version, localVersion) : null
            const needsUpdate = !!local && (!localVersion || compare == null || compare > 0)
            const action: 'install' | 'update' | 'none' = !local ? 'install' : needsUpdate ? 'update' : 'none'
            const busyThis = busy?.kind === 'app' && busy.id === item.id
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
                badge="v5 app"
                action={action}
                actionText={busyThis ? (action === 'install' ? '安装中' : '更新中') : (action === 'install' ? '安装' : '更新')}
                doneText={local ? '已是最新' : '已安装'}
                busy={busyThis}
                disabled={!!busy}
                wallpaperEnabled={wallpaperEnabled}
                onAction={() => action !== 'none' && onAction(item, action)}
              />
            )
          })}
        </StoreGrid>
      )}
    </Box>
  )
}

function LegacyPluginSection(props: {
  items: LegacyPluginStoreEntry[]
  localPlugins: LocalPluginMeta
  busy: BusyState | null
  panelSx: (theme: any) => any
  wallpaperEnabled: boolean
  onAction: (item: LegacyPluginStoreEntry, action: 'install' | 'update') => void
}) {
  const { items, localPlugins, busy, panelSx, wallpaperEnabled, onAction } = props
  return (
    <Box sx={panelSx}>
      <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.5 }}>Legacy v2 插件（{items.length}）</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
        旧插件继续走 v2 iframe 插件安装器，与 v5 独立应用安装机制分离。
      </Typography>
      {items.length === 0 ? <EmptyText text="catalog.plugins 中未发现有效条目" /> : (
        <StoreGrid>
          {items.map(item => {
            const localVersion = localPlugins.versions.get(item.id) || ''
            const installed = !!localVersion
            const compare = installed ? compareVersions(item.version, localVersion) : null
            const needsUpdate = installed && (!localVersion || compare == null || compare > 0)
            const action: 'install' | 'update' | 'none' = !installed ? 'install' : needsUpdate ? 'update' : 'none'
            const busyThis = busy?.kind === 'plugin' && busy.id === item.id
            const icon = storeIconToDisplay(item.icon) || localPlugins.icons.get(item.id) || ''
            const display = iconDisplay(icon, (item.name || item.id).slice(0, 1) || 'P')
            const versionText = !installed
              ? item.version
              : needsUpdate
                ? `${localVersion || '未知'} → ${item.version}`
                : localVersion
            return (
              <StoreListItem
                key={item.id}
                id={item.id}
                name={item.name}
                description={item.description}
                versionText={versionText}
                iconSrc={display.src}
                iconText={display.text}
                badge="v2 plugin"
                action={action}
                actionText={busyThis ? (action === 'install' ? '安装中' : '更新中') : (action === 'install' ? '安装' : '更新')}
                doneText="已是最新"
                busy={busyThis}
                disabled={!!busy}
                wallpaperEnabled={wallpaperEnabled}
                onAction={() => action !== 'none' && onAction(item, action)}
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
  actionText: string
  doneText: string
  busy: boolean
  disabled: boolean
  wallpaperEnabled: boolean
  onAction: () => void
}) {
  const { id, name, description, versionText, iconSrc, iconText, badge, action, actionText, doneText, busy, disabled, wallpaperEnabled, onAction } = props
  return (
    <ListItem
      disableGutters
      secondaryAction={action === 'none' ? (
        <Chip size="small" label={doneText} sx={hostSoftChipSx} />
      ) : (
        <Button variant="contained" size="small" onClick={onAction} disabled={disabled} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined} sx={hostButtonSx}>
          {actionText}
        </Button>
      )}
      sx={theme => ({
        ...hostSurfaceSx(wallpaperEnabled, { tone: 'item' })(theme),
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
          </Box>
        )}
      />
    </ListItem>
  )
}

function EmptyText({ text }: { text: string }) {
  return <Typography variant="body2" color="text.secondary">{text}</Typography>
}

function ConfirmDialog(props: {
  confirm: ConfirmState | null
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { confirm, busy, onClose, onConfirm } = props
  const isApp = confirm?.kind === 'app'
  const title = confirm?.action === 'install' ? (isApp ? '安装 v5 应用' : '安装 legacy 插件') : (isApp ? '更新 v5 应用' : '更新 legacy 插件')
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
            {isApp && confirm.action === 'install' ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>下一步会弹出目录选择窗口，安装成功后自动注册到 v5 应用列表。</Typography>
            ) : null}
            {isApp && confirm.action === 'update' ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>更新会使用已注册应用的安装目录，并在替换文件前停止正在运行的应用。</Typography>
            ) : null}
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="contained" onClick={onConfirm} disabled={!confirm || busy}>确认</Button>
      </DialogActions>
    </Dialog>
  )
}
