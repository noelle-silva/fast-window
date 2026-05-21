import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import type { HostUpdateEntry } from '../appStore/catalogTypes'
import { checkHostUpdate } from '../hostUpdate/hostUpdateClient'
import { downloadHostUpdateMsi, installHostUpdateMsi, type HostUpdateDownloadResult } from '../hostUpdate/hostUpdateInstaller'
import { hostToast } from '../host/hostPrimitives'

type HostUpdatePanelProps = {
  currentVersion: string
  panelSx: (theme: Theme) => object
}

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; remoteVersion: string }
  | { kind: 'missing' }
  | { kind: 'available'; update: HostUpdateEntry }
  | { kind: 'error'; message: string }

function toast(message: string) {
  void hostToast(message)
}

function formatBytes(sizeBytes?: number): string {
  if (!Number.isFinite(sizeBytes || 0) || !sizeBytes) return '-'
  const mb = sizeBytes / 1024 / 1024
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`
}

export default function HostUpdatePanel({ currentVersion, panelSx }: HostUpdatePanelProps) {
  const [state, setState] = useState<CheckState>({ kind: 'idle' })
  const [downloaded, setDownloaded] = useState<HostUpdateDownloadResult | null>(null)
  const [busy, setBusy] = useState<'download' | 'install' | ''>('')
  const [confirmInstall, setConfirmInstall] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  async function check() {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setState({ kind: 'checking' })
    setDownloaded(null)
    try {
      const result = await checkHostUpdate(currentVersion, ctrl.signal)
      if (result.status === 'available') setState({ kind: 'available', update: result.update })
      else if (result.status === 'current') setState({ kind: 'current', remoteVersion: result.remoteVersion })
      else setState({ kind: 'missing' })
    } catch (error: any) {
      const msg = String(error?.message || error || '检查更新失败')
      setState({ kind: 'error', message: msg })
    }
  }

  async function download(update: HostUpdateEntry) {
    setBusy('download')
    setDownloaded(null)
    try {
      const asset = update.platforms.windows
      const result = await downloadHostUpdateMsi({
        version: update.version,
        url: asset.downloadUrl,
        expectedSha256: asset.sha256,
      })
      setDownloaded(result)
      toast(`宿主更新已下载：v${result.version}`)
      setConfirmInstall(true)
    } catch (error: any) {
      toast(String(error?.message || error || '下载更新失败'))
    } finally {
      setBusy('')
    }
  }

  async function install(update: HostUpdateEntry) {
    if (!downloaded) return
    setBusy('install')
    try {
      await installHostUpdateMsi({
        version: update.version,
        path: downloaded.path,
        expectedSha256: update.platforms.windows.sha256,
      })
    } catch (error: any) {
      setBusy('')
      toast(String(error?.message || error || '启动安装失败'))
    }
  }

  const update = state.kind === 'available' ? state.update : null
  const asset = update?.platforms.windows || null
  const checking = state.kind === 'checking'

  return (
    <Box sx={panelSx}>
      <Stack spacing={1}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              宿主更新
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              当前版本：{currentVersion || '未知'}。检查仓库清单，下载 MSI 后会校验 SHA-256，再由你确认安装。
            </Typography>
          </Box>
          <Button size="small" variant="outlined" disabled={checking || !!busy || !currentVersion} onClick={() => void check()}>
            {checking ? '检查中…' : '检查更新'}
          </Button>
        </Box>

        {checking ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">正在读取远程更新清单…</Typography>
          </Box>
        ) : null}

        {state.kind === 'current' ? (
          <Alert severity="success" variant="outlined">已是最新版本（远端：v{state.remoteVersion}）。</Alert>
        ) : null}

        {state.kind === 'missing' ? (
          <Alert severity="info" variant="outlined">远程清单还没有发布宿主 MSI 更新信息。</Alert>
        ) : null}

        {state.kind === 'error' ? (
          <Alert severity="error" variant="outlined">{state.message}</Alert>
        ) : null}

        {update && asset ? (
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              可更新到 v{update.version}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              安装包：MSI · {formatBytes(asset.sizeBytes)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', wordBreak: 'break-all' }}>
              SHA-256：{asset.sha256}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
              <Button size="small" variant="contained" disabled={!!busy} onClick={() => void download(update)}>
                {busy === 'download' ? '下载中…' : downloaded ? '重新下载' : '下载更新'}
              </Button>
              <Button size="small" variant="outlined" disabled={!downloaded || !!busy} onClick={() => setConfirmInstall(true)}>
                安装已下载更新
              </Button>
            </Stack>
            {downloaded ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, wordBreak: 'break-all' }}>
                已下载到：{downloaded.path}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Stack>

      <Dialog open={confirmInstall && !!update && !!downloaded} onClose={() => (busy ? undefined : setConfirmInstall(false))} fullWidth maxWidth="xs">
        <DialogTitle>确认安装宿主更新？</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography variant="body2">
            将启动 MSI 安装器更新到 v{update?.version}。启动安装器后 Fast Window 会退出，请在安装器中继续确认。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={!!busy} onClick={() => setConfirmInstall(false)}>取消</Button>
          <Button variant="contained" disabled={!update || !downloaded || !!busy} onClick={() => update && void install(update)} sx={{ boxShadow: 'none' }}>
            {busy === 'install' ? '启动中…' : '启动安装器'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
