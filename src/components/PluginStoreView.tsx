import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { alpha } from '@mui/material/styles'
import {
  Alert,
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
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import { pluginStoreInstall } from '../plugins/pluginStore'
import { getWallpaperSettings, type WallpaperSettings } from '../wallpaper'

type Props = {
  onBack: () => void
}

type RegistryPluginItem = {
  id: string
  name: string
  description: string
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
  window.dispatchEvent(new CustomEvent('fast-window:toast', { detail: { message } }))
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

function isHighRiskCapability(cap: string): boolean {
  const s = String(cap || '').trim()
  if (!s.startsWith('tauri:')) return false
  if (s === 'tauri:*') return true
  if (s.includes('plugin:shell|')) return true
  return false
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

    out.push({ id, name, description, version, download_url, sha256, requires })
  }

  out.sort((a, b) => a.name.localeCompare(b.name))
  return { registry_version: 1, plugins: out }
}

async function loadLocalPluginVersions(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = await invoke<string[]>('list_plugins').catch(() => [] as string[])
  for (const id of ids) {
    const pluginId = String(id || '').trim()
    if (!pluginId) continue
    try {
      const manifestText = await invoke<string>('read_plugin_file', { pluginId, path: 'manifest.json' })
      const m = JSON.parse(manifestText || '{}') as any
      const version = typeof m?.version === 'string' ? m.version.trim() : ''
      if (version) out.set(pluginId, version)
    } catch {}
  }
  return out
}

export default function PluginStoreView(props: Props) {
  const { onBack } = props

  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(null)
  const indexUrl = DEFAULT_STORE_INDEX_URL
  const [registry, setRegistry] = useState<RegistryIndex | null>(null)
  const [localVersions, setLocalVersions] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<{ item: RegistryPluginItem; action: 'install' | 'update' } | null>(null)
  const [installing, setInstalling] = useState(false)
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
        setLocalVersions(await loadLocalPluginVersions())
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
    setInstalling(true)
    setError('')
    try {
      const r = await pluginStoreInstall({
        url: confirm.item.download_url,
        expectedSha256: confirm.item.sha256,
        expectedId: confirm.item.id,
        expectedVersion: confirm.item.version,
        expectedRequires: confirm.item.requires || [],
      })
      window.dispatchEvent(new CustomEvent('fast-window:plugins-changed'))
      toast(confirm.action === 'install' ? `已安装：${confirm.item.name}` : `已更新：${confirm.item.name}`)
      if (r?.pluginId && r.pluginId !== confirm.item.id) {
        toast(`警告：安装的插件 ID 为 ${r.pluginId}，与商店条目 ${confirm.item.id} 不一致`)
      }
      setLocalVersions(await loadLocalPluginVersions())
      setConfirm(null)
    } catch (e: any) {
      setError(String(e?.message || e || '安装失败'))
    } finally {
      setInstalling(false)
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
                仅显示内置官方商店源中的最新版插件；安装和更新前会展示权限清单。
              </Typography>
              {items.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  index.json 中未发现有效条目
                </Typography>
              ) : (
                <List dense disablePadding>
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

                    const versionText = !installed
                      ? item.version
                      : needsUpdate
                        ? `${local || '未知'} → ${item.version}`
                        : (local || item.version)
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
                              disabled={installing}
                              sx={{ borderRadius: 999, boxShadow: 'none' }}
                            >
                              {action === 'install' ? '安装' : '更新'}
                            </Button>
                          )
                        }
                        sx={{
                          position: 'relative',
                          py: 1.1,
                          px: 1,
                          borderRadius: 2.5,
                          alignItems: 'flex-start',
                          bgcolor: theme =>
                            wallpaper?.enabled
                              ? alpha(theme.palette.background.paper, 0.55)
                              : theme.palette.action.hover,
                          '& + &': {
                            mt: 0.75,
                          },
                          '&:hover': {
                            bgcolor: theme =>
                              wallpaper?.enabled
                                ? alpha(theme.palette.background.paper, 0.75)
                                : theme.palette.action.selected,
                          },
                        }}
                      >
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
                              {Array.isArray(item.requires) && item.requires.length ? (
                                <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                  {item.requires.slice(0, 6).map(cap => (
                                    <Chip
                                      key={cap}
                                      size="small"
                                      label={cap}
                                      color={isHighRiskCapability(cap) ? 'warning' : 'default'}
                                      sx={{
                                        border: 'none',
                                        bgcolor: theme =>
                                          isHighRiskCapability(cap)
                                            ? alpha(theme.palette.warning.main, 0.14)
                                            : alpha(theme.palette.text.primary, 0.06),
                                      }}
                                    />
                                  ))}
                                  {item.requires.length > 6 ? (
                                    <Chip
                                      size="small"
                                      label={`+${item.requires.length - 6}`}
                                      sx={{
                                        border: 'none',
                                        bgcolor: theme => alpha(theme.palette.text.primary, 0.06),
                                      }}
                                    />
                                  ) : null}
                                </Box>
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

      <Dialog open={!!confirm} onClose={installing ? undefined : () => setConfirm(null)} fullWidth maxWidth="sm">
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

              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
                  将授予的权限（requires）
                </Typography>
                {Array.isArray(confirm.item.requires) && confirm.item.requires.length ? (
                  <Stack spacing={0.75}>
                    {confirm.item.requires.map(cap => (
                      <Chip
                        key={cap}
                        label={cap}
                        color={isHighRiskCapability(cap) ? 'warning' : 'default'}
                        sx={{
                          border: 'none',
                          bgcolor: theme =>
                            isHighRiskCapability(cap)
                              ? alpha(theme.palette.warning.main, 0.14)
                              : alpha(theme.palette.text.primary, 0.06),
                        }}
                      />
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    （无）
                  </Typography>
                )}
                {Array.isArray(confirm.item.requires) && confirm.item.requires.some(isHighRiskCapability) ? (
                  <Alert
                    severity="warning"
                    sx={{
                      mt: 1.5,
                      border: 'none',
                      borderRadius: 3,
                      boxShadow: theme => `0 10px 24px ${alpha(theme.palette.warning.main, 0.12)}`,
                    }}
                  >
                    检测到高危权限（例如 tauri:* / shell）。请确认你信任该来源。
                  </Alert>
                ) : null}
              </Box>
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={installing}>
            取消
          </Button>
          <Button variant="contained" onClick={() => void doInstall()} disabled={!confirm || installing}>
            {installing ? '处理中…' : '确认'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
