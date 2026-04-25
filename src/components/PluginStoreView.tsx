import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { alpha } from '@mui/material/styles'
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
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { pluginStoreInstall } from '../plugins/pluginStore'
import { getWallpaperSettings, type WallpaperSettings } from '../wallpaper'
import { hostToast } from '../host/hostPrimitives'

type Props = {
  onBack: () => void
}

type RegistryPluginItem = {
  id: string
  name: string
  description: string
  icon?: string
  version: string
  download_url: string
  sha256: string
  requires?: string[]
}

type RegistryIndex = {
  registry_version: number
  plugins: RegistryPluginItem[]
}

const DEFAULT_STORE_INDEX_URL = 'https://raw.githubusercontent.com/noelle-silva/fast-window-plugins-download/main/index.json'

type Semver = { major: number; minor: number; patch: number }

function parseSemverStrict(raw: string): Semver | null {
  const s = String(raw || '').trim()
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null
  if (major < 0 || minor < 0 || patch < 0) return null
  return { major, minor, patch }
}

function cmpSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

function toast(message: string) {
  void hostToast(message)
}

function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/')
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

function isSafeRelPath(path: string): boolean {
  if (!path) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  const parts = path.split(/[\\/]+/g)
  return parts.every(p => p !== '' && p !== '.' && p !== '..')
}

function normalizeIcon(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return ''
  if (isDataImageUrl(s) || isHttpUrl(s)) return s
  // 允许用 emoji / 短文本作为 fallback（避免长字符串把 UI 顶爆）
  if (s.length <= 8) return s
  return ''
}

async function resolveLocalPluginIcon(pluginId: string, icon: unknown): Promise<string> {
  const raw = typeof icon === 'string' ? icon.trim() : ''
  if (!raw) return ''
  if (isDataImageUrl(raw) || isHttpUrl(raw)) return raw

  if (raw.startsWith('svg:')) {
    const path = raw.slice('svg:'.length).trim()
    if (!isSafeRelPath(path) || !path.toLowerCase().endsWith('.svg')) return ''
    try {
      const svg = await invoke<string>('read_plugin_file', { pluginId, path })
      const encoded = encodeURIComponent(svg)
      return `data:image/svg+xml;utf8,${encoded}`
    } catch {
      return ''
    }
  }

  if (raw.startsWith('file:')) {
    const path = raw.slice('file:'.length).trim()
    if (!isSafeRelPath(path)) return ''
    const lower = path.toLowerCase()

    const mime =
      lower.endsWith('.png') ? 'image/png'
      : (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ? 'image/jpeg'
      : lower.endsWith('.webp') ? 'image/webp'
      : lower.endsWith('.gif') ? 'image/gif'
      : lower.endsWith('.ico') ? 'image/x-icon'
      : lower.endsWith('.svg') ? 'image/svg+xml'
      : ''

    if (!mime) return ''
    try {
      const b64 = await invoke<string>('read_plugin_file_base64', { pluginId, path })
      return `data:${mime};base64,${b64}`
    } catch {
      return ''
    }
  }

  return normalizeIcon(raw)
}

function normalizeRegistry(raw: unknown): RegistryIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('index.json 格式不合法')
  const obj = raw as any
  if (obj.registry_version !== 1) throw new Error('不支持的 registry_version（仅支持 1）')
  if (!Array.isArray(obj.plugins)) throw new Error('index.json.plugins 必须是数组')

  const out: RegistryPluginItem[] = []
  for (const item of obj.plugins) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const id = String((item as any).id || '').trim()
    const name = String((item as any).name || '').trim()
    const description = String((item as any).description || '')
    const icon = normalizeIcon((item as any).icon)
    const version = String((item as any).version || '').trim()
    const download_url = String((item as any).download_url || '').trim()
    const sha256 = String((item as any).sha256 || '').trim()
    const requiresRaw = (item as any).requires
    const requires = Array.isArray(requiresRaw) ? requiresRaw.map((x: any) => String(x || '').trim()).filter(Boolean) : []

    if (!id || !isSafeId(id)) continue
    if (!name) continue
    if (!version) continue
    if (!parseSemverStrict(version)) continue
    if (!download_url) continue
    if (!sha256) continue

    out.push({ id, name, description, icon: icon || undefined, version, download_url, sha256, requires })
  }

  out.sort((a, b) => a.name.localeCompare(b.name))
  return { registry_version: 1, plugins: out }
}

async function loadLocalPluginMeta(): Promise<{ versions: Map<string, string>; icons: Map<string, string> }> {
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

export default function PluginStoreView(props: Props) {
  const { onBack } = props

  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(null)
  const indexUrl = DEFAULT_STORE_INDEX_URL
  const [registry, setRegistry] = useState<RegistryIndex | null>(null)
  const [localVersions, setLocalVersions] = useState<Map<string, string>>(new Map())
  const [localIcons, setLocalIcons] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<{ item: RegistryPluginItem; action: 'install' | 'update' } | null>(null)
  const [installing, setInstalling] = useState<{ pluginId: string; action: 'install' | 'update' } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)

  useEffect(() => {
    void getWallpaperSettings()
      .then(v => setWallpaper(v))
      .catch(() => setWallpaper({ enabled: false, opacity: 0.65, blur: 0, titlebarOpacity: 0.62, titlebarBlur: 12, filePath: null }))
  }, [])

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const refresh = useCallback(async () => {
    const requestId = ++requestSeqRef.current
    const url = indexUrl.trim()
    if (!url) {
      if (requestId === requestSeqRef.current) {
        setRegistry(null)
        setError('商店地址为空')
      }
      return
    }

    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac

    if (requestId === requestSeqRef.current) {
      setLoading(true)
      setError('')
    }
    try {
      const timeoutMs = 25_000
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      const resp = await fetch(url, { cache: 'no-store', signal: ac.signal })
      clearTimeout(timer)
      if (!resp.ok) throw new Error(`拉取失败：HTTP ${resp.status}`)
      const raw = (await resp.json()) as unknown
      const next = normalizeRegistry(raw)
      if (requestId === requestSeqRef.current) {
        setRegistry(next)
        const meta = await loadLocalPluginMeta()
        setLocalVersions(meta.versions)
        setLocalIcons(meta.icons)
      }
    } catch (e: any) {
      const msg = String(e?.message || e || '').trim()
      const isAbort =
        String(e?.name || '') === 'AbortError' ||
        msg.toLowerCase().includes('aborted') ||
        msg.toLowerCase().includes('abort')

      // 旧请求被取消/超时，不应污染 UI（例如用户点击刷新触发的新请求已在路上）。
      if (requestId !== requestSeqRef.current) return

      if (isAbort) {
        setError('加载超时或已取消，请重试')
        return
      }

      setRegistry(null)
      setError(msg || '加载失败')
    } finally {
      if (requestId === requestSeqRef.current) setLoading(false)
    }
  }, [indexUrl])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function doInstall() {
    if (!confirm) return
    if (installing) return
    const { item, action } = confirm
    setConfirm(null)
    setInstalling({ pluginId: item.id, action })
    setError('')
    try {
      const r = await pluginStoreInstall({
        url: item.download_url,
        expectedSha256: item.sha256,
        expectedId: item.id,
        expectedVersion: item.version,
        expectedRequires: item.requires || [],
      })
      window.dispatchEvent(new CustomEvent('fast-window:plugins-changed'))
      toast(action === 'install' ? `已安装：${item.name}` : `已更新：${item.name}`)
      if (r?.pluginId && r.pluginId !== item.id) {
        toast(`警告：安装的插件 ID 为 ${r.pluginId}，与商店条目 ${item.id} 不一致`)
      }
      const meta = await loadLocalPluginMeta()
      setLocalVersions(meta.versions)
      setLocalIcons(meta.icons)
    } catch (e: any) {
      setError(String(e?.message || e || '安装失败'))
    } finally {
      setInstalling(null)
    }
  }

  const items = registry?.plugins || []
  const panelSx = (theme: any) => ({
    borderRadius: 3,
    px: 1.5,
    py: 1.35,
    bgcolor: wallpaper?.enabled ? alpha(theme.palette.background.paper, 0.6) : alpha(theme.palette.background.paper, 0.92),
    backdropFilter: wallpaper?.enabled ? 'blur(12px)' : undefined,
    boxShadow: `0 10px 30px ${alpha(theme.palette.common.black, 0.06)}`,
  })

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box
        data-tauri-drag-region="true"
        sx={theme => ({
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 0.75,
          bgcolor: wallpaper?.enabled ? alpha(theme.palette.background.paper, 0.62) : theme.palette.background.paper,
          backdropFilter: wallpaper?.enabled ? 'blur(12px)' : undefined,
          boxShadow: `inset 0 -1px 0 ${alpha(theme.palette.common.black, wallpaper?.enabled ? 0.04 : 0.06)}`,
          WebkitAppRegion: 'drag',
        })}
      >
        <IconButton aria-label="返回" size="small" onClick={onBack} data-tauri-drag-region="false" sx={{ WebkitAppRegion: 'no-drag' }}>
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, textAlign: 'center', fontWeight: 700, userSelect: 'none', pointerEvents: 'none' }}>
          应用商店
        </Typography>
        <IconButton aria-label="刷新" size="small" onClick={() => void refresh()} disabled={loading} data-tauri-drag-region="false" sx={{ WebkitAppRegion: 'no-drag' }}>
          <RefreshRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
        <Stack spacing={1.25}>
          {error ? (
            <Alert
              severity="error"
              sx={{
                border: 'none',
                borderRadius: 3,
                boxShadow: theme => `0 10px 24px ${alpha(theme.palette.error.main, 0.12)}`,
              }}
            >
              {error}
            </Alert>
          ) : null}

          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                正在加载…
              </Typography>
            </Box>
          ) : null}

          {!loading && registry ? (
            <Box sx={panelSx}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                插件列表（{items.length}）
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
                仅显示内置官方商店源中的最新版插件；安装和更新前会二次确认。
              </Typography>
              {items.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  index.json 中未发现有效条目
                </Typography>
              ) : (
                <List
                  dense
                  disablePadding
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                    gap: 0.75,
                    alignItems: 'stretch',
                  }}
                >
                  {items.map(item => {
                    const local = localVersions.get(item.id) || ''
                    const installed = !!local
                    const localSemver = installed ? parseSemverStrict(local) : null
                    const remoteSemver = parseSemverStrict(item.version)
                    const needsUpdate =
                      installed &&
                      !!remoteSemver &&
                      (!localSemver || cmpSemver(remoteSemver, localSemver) > 0)
                    const alreadyLatest =
                      installed &&
                      !!remoteSemver &&
                      !!localSemver &&
                      cmpSemver(remoteSemver, localSemver) <= 0
                    const action: 'install' | 'update' | 'none' = !installed ? 'install' : needsUpdate ? 'update' : 'none'
                    const isInstallingThis = installing?.pluginId === item.id

                    const versionText = !installed
                      ? item.version
                      : needsUpdate
                        ? `${local || '未知'} → ${item.version}`
                        : (local || item.version)

                    const icon = item.icon || localIcons.get(item.id) || ''
                    const iconSrc = icon && (isDataImageUrl(icon) || isHttpUrl(icon)) ? icon : ''
                    const iconFallback = iconSrc ? '' : (icon || (item.name || '').trim().slice(0, 1) || '?')
                    return (
                      <ListItem
                        key={item.id}
                        disableGutters
                        secondaryAction={
                          action === 'none' ? (
                            <Chip
                              size="small"
                              label={alreadyLatest ? '已是最新' : '已安装'}
                              sx={{
                                bgcolor: theme => alpha(theme.palette.text.primary, 0.06),
                                border: 'none',
                              }}
                            />
                          ) : (
                            <Button
                              variant="contained"
                              size="small"
                              onClick={() => setConfirm({ item, action })}
                              disabled={!!installing}
                              startIcon={isInstallingThis ? <CircularProgress size={14} color="inherit" /> : undefined}
                              sx={{ borderRadius: 999, boxShadow: 'none' }}
                            >
                              {isInstallingThis ? (action === 'install' ? '安装中' : '更新中') : (action === 'install' ? '安装' : '更新')}
                            </Button>
                          )
                        }
                        sx={{
                          position: 'relative',
                          py: 1.1,
                          px: 1,
                          borderRadius: 2.5,
                          alignItems: 'flex-start',
                          height: '100%',
                          '& .MuiListItemSecondaryAction-root': {
                            top: 10,
                            right: 10,
                            transform: 'none',
                          },
                          bgcolor: theme =>
                            wallpaper?.enabled
                              ? alpha(theme.palette.background.paper, 0.55)
                              : theme.palette.action.hover,
                          '&:hover': {
                            bgcolor: theme =>
                              wallpaper?.enabled
                                ? alpha(theme.palette.background.paper, 0.75)
                                : theme.palette.action.selected,
                          },
                        }}
                      >
                        <ListItemAvatar sx={{ minWidth: 44, mt: 0.1 }}>
                          <Avatar
                            variant="rounded"
                            src={iconSrc || undefined}
                            imgProps={{ alt: `${item.name || item.id} 图标` }}
                            sx={{ width: 34, height: 34, fontSize: 18, bgcolor: 'action.hover', color: 'text.primary' }}
                          >
                            {iconSrc ? null : iconFallback}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                                {item.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {item.id}
                              </Typography>
                            </Box>
                          }
                          secondary={
                            <Box sx={{ mt: 0.5 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                版本：{versionText}
                              </Typography>
                              {item.description ? (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  {item.description}
                                </Typography>
                              ) : null}
                            </Box>
                          }
                        />
                      </ListItem>
                    )
                  })}
                </List>
              )}
            </Box>
          ) : null}
        </Stack>
      </Box>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} fullWidth maxWidth="sm">
        <DialogTitle>{confirm?.action === 'install' ? '确认安装' : '确认更新'}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {confirm ? (
            <>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {confirm.item.name}（{confirm.item.id}）
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                版本：{confirm.item.version}
              </Typography>
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={!!installing}>
            取消
          </Button>
          <Button variant="contained" onClick={() => void doInstall()} disabled={!confirm || !!installing}>
            确认
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
