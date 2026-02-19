import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded'
import StopRoundedIcon from '@mui/icons-material/StopRounded'
import BackspaceRoundedIcon from '@mui/icons-material/BackspaceRounded'

const DEFAULT_WAKE_SHORTCUT = 'control+alt+Space'
const MAX_VIDEO_RATE = 16

function toast(message: string) {
  window.dispatchEvent(new CustomEvent('fast-window:toast', { detail: { message } }))
}

function clampRate(raw: number) {
  if (!Number.isFinite(raw)) return 1
  return Math.min(MAX_VIDEO_RATE, Math.max(0.25, raw))
}

type AutoStartStatus = {
  supported: boolean
  enabled: boolean
  scope: string
}

type WebviewVideoSpeedPreset = {
  label: string
  rate: number
  shortcut?: string | null
}

type WebviewSettings = {
  video: {
    defaultRate: number
    maxRate: number
    presets: WebviewVideoSpeedPreset[]
  }
}

const DEFAULT_WEBVIEW_SETTINGS: WebviewSettings = {
  video: {
    defaultRate: 1,
    maxRate: MAX_VIDEO_RATE,
    presets: [
      { label: '1x', rate: 1, shortcut: null },
      { label: '1.5x', rate: 1.5, shortcut: null },
      { label: '2x', rate: 2, shortcut: null },
    ],
  },
}

const modifierCodes = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

function buildShortcutFromEvent(e: KeyboardEvent): string | null {
  const code = typeof e.code === 'string' ? e.code : ''
  if (!code || code === 'Unidentified') return null
  if (modifierCodes.has(code)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('control')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('super')
  parts.push(code)
  return parts.join('+')
}

export default function SettingsView(_props: { onBack: () => void }) {
  const [dataDir, setDataDir] = useState<string>('')
  const [pluginsDir, setPluginsDir] = useState<string>('')
  const [current, setCurrent] = useState<string>('')
  const [input, setInput] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState(false)
  const [webview, setWebview] = useState<WebviewSettings | null>(null)
  const [webviewSaving, setWebviewSaving] = useState(false)
  const [recordingPresetIndex, setRecordingPresetIndex] = useState<number | null>(null)
  const [autoStart, setAutoStart] = useState<AutoStartStatus>({ supported: false, enabled: false, scope: 'unknown' })
  const [autoStartSaving, setAutoStartSaving] = useState(false)
  const [tabIndex, setTabIndex] = useState(0)

  useEffect(() => {
    async function load() {
      const [dir, pdir, cur, st, wv] = await Promise.all([
        invoke<string>('get_data_dir').catch(() => ''),
        invoke<string>('get_plugins_dir').catch(() => ''),
        invoke<string>('get_wake_shortcut').catch(() => ''),
        invoke<AutoStartStatus>('get_auto_start').catch(() => ({ supported: false, enabled: false, scope: 'unknown' })),
        invoke<WebviewSettings>('get_webview_settings').catch(() => null),
      ])
      setDataDir(dir)
      setPluginsDir(pdir)
      setCurrent(cur)
      setInput(cur || DEFAULT_WAKE_SHORTCUT)
      setAutoStart(st)
      setWebview(wv || DEFAULT_WEBVIEW_SETTINGS)
    }
    load()
  }, [])

  async function openDataDir() {
    try {
      await invoke('open_data_dir')
    } catch (e: any) {
      toast(String(e?.message || e || '打开目录失败'))
    }
  }

  async function openPluginsDir() {
    try {
      await invoke('open_plugins_dir')
    } catch (e: any) {
      toast(String(e?.message || e || '打开目录失败'))
    }
  }

  async function save(next: string) {
    const raw = next.trim()
    if (!raw) {
      toast('快捷键不能为空')
      return
    }

    setSaving(true)
    try {
      const normalized = await invoke<string>('set_wake_shortcut', { shortcut: raw })
      setCurrent(normalized)
      setInput(normalized)
      toast('已更新快捷键')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
    } finally {
      setSaving(false)
    }
  }

  const recordHint = useMemo(() => {
    if (!recording) return '点击“开始录制”，然后按下你想要的组合键（ESC 取消）。'
    return '录制中…按下组合键（修饰键 + 主键），ESC 取消。'
  }, [recording])

  async function saveAutoStart(nextEnabled: boolean) {
    setAutoStartSaving(true)
    try {
      const st = await invoke<AutoStartStatus>('set_auto_start', { enabled: nextEnabled })
      setAutoStart(st)
      toast(nextEnabled ? '已开启开机自启' : '已关闭开机自启')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
    } finally {
      setAutoStartSaving(false)
    }
  }

  useEffect(() => {
    if (!recording) return

    invoke('pause_wake_shortcut').catch(() => {})

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e as any).stopImmediatePropagation?.()

      if (e.key === 'Escape') {
        setRecording(false)
        toast('已取消录制')
        return
      }

      if (e.repeat) return
      const shot = buildShortcutFromEvent(e)
      if (!shot) return

      setRecording(false)
      setInput(shot)
      save(shot)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      invoke('resume_wake_shortcut').catch(() => {})
    }
  }, [recording])

  useEffect(() => {
    if (recordingPresetIndex == null) return

    invoke('pause_wake_shortcut').catch(() => {})

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e as any).stopImmediatePropagation?.()

      if (e.key === 'Escape') {
        setRecordingPresetIndex(null)
        toast('已取消录制')
        return
      }

      if (e.repeat) return
      const shot = buildShortcutFromEvent(e)
      if (!shot) return

      setRecordingPresetIndex(null)
      setWebview(prev => {
        if (!prev) return prev
        const nextPresets = prev.video.presets.map((p, idx) => (idx === recordingPresetIndex ? { ...p, shortcut: shot } : p))
        return { ...prev, video: { ...prev.video, presets: nextPresets } }
      })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      invoke('resume_wake_shortcut').catch(() => {})
    }
  }, [recordingPresetIndex])

  async function saveWebview(next: WebviewSettings) {
    setWebviewSaving(true)
    try {
      const normalized = await invoke<WebviewSettings>('set_webview_settings', { settings: next })
      setWebview(normalized)
      toast('已更新 WebView 设置')
    } catch (e: any) {
      toast(String(e?.message || e || '设置失败'))
    } finally {
      setWebviewSaving(false)
    }
  }

  return (
    <Box sx={{ p: 2, height: '100%', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: 'background.default',
          pt: 0.25,
          pb: 1,
        }}
      >
        <Tabs
          value={tabIndex}
          onChange={(_, next) => {
            const nextIndex = typeof next === 'number' ? next : 0
            if ((recording || recordingPresetIndex != null) && nextIndex !== tabIndex) {
              setRecording(false)
              setRecordingPresetIndex(null)
              toast('已取消录制')
            }
            setTabIndex(nextIndex)
          }}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label="设置分类"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="常规" id="settings-tab-0" aria-controls="settings-tabpanel-0" />
          <Tab label="快捷键" id="settings-tab-1" aria-controls="settings-tabpanel-1" />
          <Tab label="WebView" id="settings-tab-2" aria-controls="settings-tabpanel-2" />
        </Tabs>
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== 0} id="settings-tabpanel-0" aria-labelledby="settings-tab-0" sx={{ pt: 0.5 }}>
        {tabIndex === 0 ? (
          <Stack spacing={1.25}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                数据与插件位置
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                data: {dataDir || '-'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                plugins: {pluginsDir || '-'}
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" onClick={openDataDir}>
                  打开数据目录
                </Button>
                <Button size="small" variant="outlined" onClick={openPluginsDir} disabled={!pluginsDir}>
                  打开插件目录
                </Button>
              </Box>
            </Box>

            <Divider />

            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                开机自启
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {autoStart.supported
                  ? `开启后会在 Windows 登录后自动运行（${autoStart.scope === 'currentUser' ? '当前用户' : autoStart.scope}）。配置写入 ${
                      dataDir ? `${dataDir}/app.json` : 'data/app.json'
                    } 的 autoStart`
                  : '当前平台不支持开机自启设置'}
              </Typography>
            </Box>

            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                bgcolor: 'background.paper',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <FormControlLabel
                sx={{ m: 0 }}
                control={
                  <Switch
                    checked={autoStart.enabled}
                    disabled={!autoStart.supported || autoStartSaving || saving || recording}
                    onChange={e => saveAutoStart(e.target.checked)}
                    inputProps={{ 'aria-label': '开机自启' }}
                  />
                }
                label={autoStart.enabled ? '已开启' : '已关闭'}
              />
              <Typography variant="caption" color="text.secondary">
                {autoStart.supported ? '仅影响本机当前用户' : '不可用'}
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== 1} id="settings-tabpanel-1" aria-labelledby="settings-tab-1" sx={{ pt: 0.5 }}>
        {tabIndex === 1 ? (
          <Stack spacing={1.25}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                唤醒窗口快捷键
              </Typography>
              <Typography variant="caption" color="text.secondary">
                保存后立即生效，并写入 {dataDir ? `${dataDir}/app.json` : 'data/app.json'} 的 wakeShortcut
              </Typography>
            </Box>

            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                bgcolor: 'background.paper',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                当前
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                {current || '-'}
              </Typography>
            </Box>

            <TextField
              label="新的组合"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ctrl+Alt+Space / Shift+Alt+KeyQ"
              size="small"
              autoComplete="off"
              helperText="用 + 连接，修饰键在前，主键在最后（例如 Ctrl+Alt+Space）"
              inputProps={{ readOnly: true, 'aria-readonly': true }}
            />

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Button
                variant={recording ? 'contained' : 'outlined'}
                color={recording ? 'warning' : 'primary'}
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => setRecording(v => !v)}
              >
                {recording ? '录制中…' : '开始录制'}
              </Button>
              <Button
                variant="outlined"
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => save(DEFAULT_WAKE_SHORTCUT)}
              >
                恢复默认
              </Button>
              <Button
                variant="outlined"
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => save('alt+Space')}
              >
                预设 Alt+Space（Windows）
              </Button>
              <Button
                variant="outlined"
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => save('control+alt+KeyQ')}
              >
                预设 Ctrl+Alt+Q
              </Button>
              <Button
                variant="outlined"
                disabled={saving || recordingPresetIndex != null || webviewSaving}
                onClick={() => save('control+alt+KeyW')}
              >
                预设 Ctrl+Alt+W
              </Button>
            </Stack>

            <Typography variant="caption" color={recording ? 'warning.main' : 'text.secondary'}>
              {recordHint}
            </Typography>
          </Stack>
        ) : null}
      </Box>

      <Box role="tabpanel" hidden={tabIndex !== 2} id="settings-tabpanel-2" aria-labelledby="settings-tab-2" sx={{ pt: 0.5 }}>
        {tabIndex === 2 ? (
          <Stack spacing={1.25}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                WebView（浏览）
              </Typography>
              <Typography variant="caption" color="text.secondary">
                配置写入 {dataDir ? `${dataDir}/app.json` : 'data/app.json'} 的 webview.video（快捷键仅在浏览窗口内生效）
              </Typography>
            </Box>

            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                bgcolor: 'background.paper',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  视频默认倍速
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  当前：{`${clampRate(webview?.video.defaultRate ?? 1)}x`}（范围 0.25 ~ {MAX_VIDEO_RATE}）
                </Typography>
                <Slider
                  aria-label="视频默认倍速"
                  value={clampRate(webview?.video.defaultRate ?? 1)}
                  min={0.25}
                  max={MAX_VIDEO_RATE}
                  step={0.25}
                  valueLabelDisplay="auto"
                  disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                  onChange={(_, next) => {
                    const v = Array.isArray(next) ? next[0] : next
                    setWebview(prev => (prev ? { ...prev, video: { ...prev.video, defaultRate: clampRate(Number(v)) } } : prev))
                  }}
                />
              </Box>

              <Typography variant="caption" color="text.secondary">
                倍速预设与快捷键映射（允许不带修饰键；在输入框/可编辑区域内不会抢按键）
              </Typography>

              <Stack spacing={1}>
                {(webview?.video.presets || []).map((p, idx) => {
                  const rowBusy = recordingPresetIndex === idx
                  return (
                    <Box
                      key={`${idx}-${p.label}-${p.rate}`}
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 2,
                        p: 1,
                        display: 'grid',
                        gridTemplateColumns: '1fr 120px 1fr auto auto auto',
                        gap: 1,
                        alignItems: 'center',
                      }}
                    >
                      <TextField
                        label="名称"
                        size="small"
                        value={p.label}
                        onChange={e => {
                          const label = e.target.value
                          setWebview(prev => {
                            if (!prev) return prev
                            const next = prev.video.presets.map((it, i) => (i === idx ? { ...it, label } : it))
                            return { ...prev, video: { ...prev.video, presets: next } }
                          })
                        }}
                        inputProps={{ 'aria-label': `倍速预设名称 ${idx + 1}` }}
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                      />

                      <TextField
                        label="倍速"
                        type="number"
                        size="small"
                        value={p.rate}
                        onChange={e => {
                          const rate = Number.parseFloat(e.target.value)
                          if (!Number.isFinite(rate)) return
                          setWebview(prev => {
                            if (!prev) return prev
                            const next = prev.video.presets.map((it, i) => (i === idx ? { ...it, rate } : it))
                            return { ...prev, video: { ...prev.video, presets: next } }
                          })
                        }}
                        inputProps={{ min: 0.25, max: MAX_VIDEO_RATE, step: 0.25, 'aria-label': `倍速预设倍速 ${idx + 1}` }}
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                      />

                      <TextField
                        label="快捷键（只读）"
                        size="small"
                        value={p.shortcut || ''}
                        placeholder="点击右侧录制"
                        inputProps={{ readOnly: true, 'aria-readonly': true }}
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                      />

                      <Button
                        size="small"
                        variant={rowBusy ? 'contained' : 'outlined'}
                        color={rowBusy ? 'warning' : 'primary'}
                        disabled={!webview || webviewSaving || saving || recording || (recordingPresetIndex != null && !rowBusy)}
                        onClick={() => setRecordingPresetIndex(v => (v === idx ? null : idx))}
                        startIcon={rowBusy ? <StopRoundedIcon fontSize="small" /> : <FiberManualRecordRoundedIcon fontSize="small" />}
                      >
                        {rowBusy ? '录制中…' : '录制'}
                      </Button>

                      <IconButton
                        aria-label="清除快捷键"
                        size="small"
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                        onClick={() => {
                          setWebview(prev => {
                            if (!prev) return prev
                            const next = prev.video.presets.map((it, i) => (i === idx ? { ...it, shortcut: null } : it))
                            return { ...prev, video: { ...prev.video, presets: next } }
                          })
                        }}
                      >
                        <BackspaceRoundedIcon fontSize="small" />
                      </IconButton>

                      <IconButton
                        aria-label="删除预设"
                        size="small"
                        disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                        onClick={() => {
                          setWebview(prev => {
                            if (!prev) return prev
                            const next = prev.video.presets.filter((_, i) => i !== idx)
                            return { ...prev, video: { ...prev.video, presets: next } }
                          })
                        }}
                      >
                        <DeleteRoundedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  )
                })}
              </Stack>

              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                  onClick={() => {
                    setWebview(prev => {
                      if (!prev) return prev
                      const next = prev.video.presets.concat([{ label: '新预设', rate: 2, shortcut: null }])
                      return { ...prev, video: { ...prev.video, presets: next } }
                    })
                  }}
                >
                  添加预设
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={!webview || webviewSaving || saving || recording || recordingPresetIndex != null}
                  onClick={() => webview && saveWebview(webview)}
                >
                  保存 WebView 设置
                </Button>
              </Stack>

              <Typography variant="caption" color={recordingPresetIndex != null ? 'warning.main' : 'text.secondary'}>
                {recordingPresetIndex != null ? '录制中…按下组合键（ESC 取消）。' : '提示：快捷键会在浏览窗口里即时生效。'}
              </Typography>
            </Box>
          </Stack>
        ) : null}
      </Box>
    </Box>
  )
}
