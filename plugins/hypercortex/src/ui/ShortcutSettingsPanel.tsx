import * as React from 'react'
import { Box, Button, Typography } from '@mui/material'
import {
  chordFromKeyboardEvent,
  DEFAULT_SHORTCUT_BINDINGS,
  formatChordForDisplay,
  type HyperCortexShortcutBindingsV1,
  type HyperCortexShortcutId,
} from '../shortcuts'

function updateBinding(bindings: HyperCortexShortcutBindingsV1, id: HyperCortexShortcutId, nextChord: string): HyperCortexShortcutBindingsV1 {
  const chord = String(nextChord || '').trim()
  if (id === 'newNote') return { ...bindings, newNote: chord }
  if (id === 'saveNote') return { ...bindings, saveNote: chord }
  if (id === 'toggleMode') return { ...bindings, toggleMode: chord }
  return { ...bindings, toggleSidebar: chord }
}

export function ShortcutSettingsPanel(props: {
  bindings: HyperCortexShortcutBindingsV1
  onChange: (next: HyperCortexShortcutBindingsV1) => void
  onRecordingChange?: (active: boolean) => void
}) {
  const { onChange, onRecordingChange } = props
  const bindings = props.bindings || DEFAULT_SHORTCUT_BINDINGS
  const [recording, setRecording] = React.useState<HyperCortexShortcutId | null>(null)

  React.useEffect(() => {
    onRecordingChange?.(!!recording)
    return () => onRecordingChange?.(false)
  }, [onRecordingChange, recording])

  React.useEffect(() => {
    if (!recording) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setRecording(null)
        return
      }
      const chord = chordFromKeyboardEvent(e)
      if (!chord) return
      e.preventDefault()
      e.stopPropagation()
      onChange(updateBinding(bindings, recording, chord))
      setRecording(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [bindings, onChange, recording])

  const Row = (p: { id: HyperCortexShortcutId; title: string; value: string }) => {
    const isRec = recording === p.id
    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr auto auto',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.75,
          borderRadius: 2,
          bgcolor: isRec ? 'rgba(25,118,210,0.06)' : 'transparent',
        }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{p.title}</Typography>
        <Typography
          sx={{
            fontSize: 13,
            color: p.value ? 'rgba(0,0,0,.78)' : 'rgba(0,0,0,.45)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={p.value || '未设置'}
        >
          {isRec ? '正在录制…（按 Esc 取消）' : formatChordForDisplay(p.value)}
        </Typography>
        <Button
          size="small"
          variant={isRec ? 'contained' : 'outlined'}
          onClick={() => setRecording(prev => (prev === p.id ? null : p.id))}
        >
          {isRec ? '录制中' : '录制'}
        </Button>
        <Button
          size="small"
          onClick={() => onChange(updateBinding(bindings, p.id, ''))}
          disabled={!p.value}
        >
          清空
        </Button>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={{ fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>快捷键</Typography>
      <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.62)' }}>
        这些快捷键默认都是空的（不启用）。点击「录制」后按下组合键即可保存。
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Row id="newNote" title="新建笔记" value={bindings.newNote} />
        <Row id="saveNote" title="保存笔记" value={bindings.saveNote} />
        <Row id="toggleMode" title="切换阅读/编辑" value={bindings.toggleMode} />
        <Row id="toggleSidebar" title="侧边栏展开/收起" value={bindings.toggleSidebar} />
      </Box>
    </Box>
  )
}
