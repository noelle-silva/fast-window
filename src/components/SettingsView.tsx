import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'

const DEFAULT_WAKE_SHORTCUT = 'control+alt+Space'

function toast(message: string) {
  window.dispatchEvent(new CustomEvent('fast-window:toast', { detail: { message } }))
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
  const [current, setCurrent] = useState<string>('')
  const [input, setInput] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [dir, cur] = await Promise.all([
          invoke<string>('get_data_dir'),
          invoke<string>('get_wake_shortcut'),
        ])
        setDataDir(dir)
        setCurrent(cur)
        setInput(cur)
      } catch {
        setCurrent('')
      }
    }
    load()
  }, [])

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
        </Stack>

        <Typography variant="caption" color={recording ? 'warning.main' : 'text.secondary'}>
          {recordHint}
        </Typography>
      </Stack>
    </Box>
  )
}
