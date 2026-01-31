import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Typography,
} from '@mui/material'
import { PLUGIN_API_VERSION, PluginManifest } from '../plugins/pluginContract'

type Props = {
  open: boolean
  onClose: () => void
  onInstalled?: () => void
}

type SelectedPlugin = {
  manifest: PluginManifest
  rootDirName: string
  files: File[]
}

function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id)
}

function isSafeRelPath(path: string): boolean {
  if (!path) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  const parts = path.split(/[\\/]+/g)
  return parts.every(p => p !== '' && p !== '.' && p !== '..')
}

function splitRoot(webkitRelativePath: string): { root: string; rel: string } | null {
  const raw = String(webkitRelativePath || '').replace(/\\/g, '/')
  const parts = raw.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const root = parts[0]
  const rel = parts.slice(1).join('/')
  return { root, rel }
}

function parseSelectedPlugin(files: File[]): SelectedPlugin {
  if (files.length === 0) throw new Error('未选择任何文件')

  const roots = new Set<string>()
  const relMap = new Map<string, File>()

  for (const f of files) {
    const info = splitRoot((f as any).webkitRelativePath)
    if (!info) throw new Error('请选择一个插件文件夹（而不是单个文件）')
    roots.add(info.root)
    relMap.set(info.rel, f)
  }

  if (roots.size !== 1) throw new Error('请只选择一个插件文件夹')
  const [rootDirName] = Array.from(roots)

  const manifestFile = relMap.get('manifest.json')
  if (!manifestFile) throw new Error('插件缺少 manifest.json')

  return {
    manifest: {} as any,
    rootDirName,
    files,
  }
}

async function readTextFile(file: File): Promise<string> {
  return await file.text()
}

async function readBytes(file: File): Promise<number[]> {
  const buf = await file.arrayBuffer()
  return Array.from(new Uint8Array(buf))
}

export default function ImportPluginDialog(props: Props) {
  const { open, onClose, onInstalled } = props
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [pluginsDir, setPluginsDir] = useState<string>('')
  const [overwrite, setOverwrite] = useState(false)
  const [selected, setSelected] = useState<SelectedPlugin | null>(null)
  const [error, setError] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setSelected(null)
    setOverwrite(false)
    invoke<string>('get_plugins_dir')
      .then(dir => setPluginsDir(dir))
      .catch(() => setPluginsDir(''))
  }, [open])

  const selectedSummary = useMemo(() => {
    if (!selected) return ''
    const m = selected.manifest
    return `${m.name || ''} (${m.id || ''})`
  }, [selected])

  async function handleChooseDir() {
    setError('')
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    try {
      setError('')
      const list = e.target.files ? Array.from(e.target.files) : []
      const parsed = parseSelectedPlugin(list)

      const relMap = new Map<string, File>()
      for (const f of parsed.files) {
        const info = splitRoot((f as any).webkitRelativePath)
        if (!info) continue
        relMap.set(info.rel, f)
      }
      const manifestFile = relMap.get('manifest.json')
      if (!manifestFile) throw new Error('插件缺少 manifest.json')

      const raw = await readTextFile(manifestFile)
      const manifest = JSON.parse(raw) as PluginManifest

      if (!manifest || typeof manifest !== 'object') throw new Error('manifest.json 内容不合法')
      if (typeof manifest.id !== 'string' || !isSafeId(manifest.id)) throw new Error('manifest.id 不合法（仅允许字母/数字/_/-）')
      if (typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('manifest.name 不能为空')
      if (typeof manifest.version !== 'string' || !manifest.version.trim()) throw new Error('manifest.version 不能为空')
      if (typeof manifest.description !== 'string') throw new Error('manifest.description 必须是字符串')
      if (typeof manifest.main !== 'string' || !manifest.main.trim()) throw new Error('manifest.main 不能为空')
      if ((manifest.ui?.type ?? 'react') !== 'iframe') throw new Error('仅支持 ui.type="iframe" 的插件（legacy react 已禁用）')

      const apiVersion = typeof manifest.apiVersion === 'number' ? manifest.apiVersion : PLUGIN_API_VERSION
      if (apiVersion > PLUGIN_API_VERSION) {
        throw new Error(`插件需要 apiVersion=${apiVersion}，当前宿主版本=${PLUGIN_API_VERSION}`)
      }

      if (!isSafeRelPath(manifest.main)) throw new Error('manifest.main 路径不合法（不允许绝对路径或 ..）')
      if (!relMap.has(manifest.main)) throw new Error(`入口文件不存在：${manifest.main}`)

      for (const rel of relMap.keys()) {
        if (!isSafeRelPath(rel)) throw new Error(`文件路径不合法：${rel}`)
      }

      setSelected({ ...parsed, manifest })
    } catch (err: any) {
      setSelected(null)
      setError(String(err?.message || err))
    } finally {
      e.target.value = ''
    }
  }

  async function handleInstall() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const relMap = new Map<string, File>()
      for (const f of selected.files) {
        const info = splitRoot((f as any).webkitRelativePath)
        if (!info) continue
        relMap.set(info.rel, f)
      }

      const relPaths = Array.from(relMap.keys())
      if (relPaths.length > 128) throw new Error('文件数量过多（>128），拒绝导入')

      const filesPayload = []
      let totalBytes = 0
      for (const rel of relPaths) {
        const f = relMap.get(rel)!
        const bytes = await readBytes(f)
        totalBytes += bytes.length
        if (totalBytes > 10 * 1024 * 1024) throw new Error('插件体积过大（>10MB），拒绝导入')
        filesPayload.push({ path: rel, bytes })
      }

      await invoke('install_plugin_files', {
        pluginId: selected.manifest.id,
        overwrite,
        files: filesPayload,
      })

      onInstalled?.()
      onClose()
    } catch (err: any) {
      setError(String(err?.message || err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>导入插件</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {busy ? <LinearProgress sx={{ mb: 2 }} /> : null}

        <Typography variant="body2" color="text.secondary">
          插件会安装到：
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
          {pluginsDir || '(无法获取路径)'}
        </Typography>

        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button variant="contained" onClick={handleChooseDir} disabled={busy}>
            选择插件文件夹
          </Button>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
            {selected ? selectedSummary : '未选择'}
          </Typography>
        </Box>

        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox checked={overwrite} onChange={e => setOverwrite(e.target.checked)} disabled={busy} />}
          label="如已存在同 ID 插件则覆盖"
        />

        {selected ? (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              ID：{selected.manifest.id} · apiVersion：{selected.manifest.apiVersion ?? PLUGIN_API_VERSION} · ui.type：
              {selected.manifest.ui?.type ?? 'react'}
            </Typography>
          </Box>
        ) : null}

        {error ? (
          <Alert sx={{ mt: 2 }} severity="error" variant="outlined">
            {error}
          </Alert>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          // Chromium/Tauri 支持目录选择；标准属性未进 TS，因此用 any
          {...({ webkitdirectory: '', directory: '' } as any)}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button onClick={handleInstall} disabled={busy || !selected} variant="contained">
          安装
        </Button>
      </DialogActions>
    </Dialog>
  )
}
