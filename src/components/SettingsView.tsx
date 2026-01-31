import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Box, Button, Divider, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material'

const DEFAULT_WAKE_SHORTCUT = 'control+alt+Space'

function toast(message: string) {
  window.dispatchEvent(new CustomEvent('fast-window:toast', { detail: { message } }))
}

type AutoStartStatus = {
  supported: boolean
  enabled: boolean
  scope: string
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
  const [autoStart, setAutoStart] = useState<AutoStartStatus>({ supported: false, enabled: false, scope: 'unknown' })
  const [autoStartSaving, setAutoStartSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const [dir, pdir, cur, st] = await Promise.all([
        invoke<string>('get_data_dir').catch(() => ''),
        invoke<string>('get_plugins_dir').catch(() => ''),
        invoke<string>('get_wake_shortcut').catch(() => ''),
        invoke<AutoStartStatus>('get_auto_start').catch(() => ({ supported: false, enabled: false, scope: 'unknown' })),
      ])
      setDataDir(dir)
      setPluginsDir(pdir)
      setCurrent(cur)
      setInput(cur || DEFAULT_WAKE_SHORTCUT)
      setAutoStart(st)
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

  return (
    <Box sx={{ p: 2 }}>
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

        <Divider />

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
            disabled={saving}
            onClick={() => setRecording(v => !v)}
          >
            {recording ? '录制中…' : '开始录制'}
          </Button>
          <Button variant="outlined" disabled={saving} onClick={() => save(DEFAULT_WAKE_SHORTCUT)}>
            恢复默认
          </Button>
          <Button
            variant="outlined"
            disabled={saving}
            onClick={() => save('alt+Space')}
          >
            预设 Alt+Space（Windows）
          </Button>
          <Button variant="outlined" disabled={saving} onClick={() => save('control+alt+KeyQ')}>
            预设 Ctrl+Alt+Q
          </Button>
          <Button variant="outlined" disabled={saving} onClick={() => save('control+alt+KeyW')}>
            预设 Ctrl+Alt+W
          </Button>
        </Stack>

        <Typography variant="caption" color={recording ? 'warning.main' : 'text.secondary'}>
          {recordHint}
        </Typography>
      </Stack>
    </Box>
  )
}
