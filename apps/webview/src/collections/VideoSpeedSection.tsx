import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { buildShortcutFromEvent } from '../keyboard'
import { useToast } from './toast'
import { MAX_VIDEO_RATE, type WebviewSettings } from '../webviewSettings'

function formatRate(rate: number): string {
  return String(Number.isFinite(rate) ? rate : 1).replace(/\.00$/, '')
}

function clampRate(rate: number, max: number): number {
  const max2 = Math.min(MAX_VIDEO_RATE, Math.max(0.25, max))
  const v = Number.isFinite(rate) ? rate : 1
  return Math.min(max2, Math.max(0.25, v))
}

function emptySettings(): WebviewSettings {
  return { video: { defaultRate: 1, maxRate: MAX_VIDEO_RATE, presets: [] } }
}

export function VideoSpeedSection() {
  const { showToast } = useToast()
  const [settings, setSettings] = useState<WebviewSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null)
  const recordingRef = useRef(false)

  const refresh = useCallback(async () => {
    const next = await invoke<WebviewSettings>('get_webview_settings').catch(() => null)
    setSettings(next ?? emptySettings())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const update = (updater: (prev: WebviewSettings) => WebviewSettings) => {
    setSettings(prev => updater(prev ?? emptySettings()))
  }

  const stopRecording = () => {
    recordingRef.current = false
    setRecordingIndex(null)
  }

  const startRecording = (index: number) => {
    recordingRef.current = true
    setRecordingIndex(index)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!recordingRef.current) return
      if (e.key === 'Escape') {
        stopRecording()
        return
      }
      const shot = buildShortcutFromEvent(e)
      if (!shot) return
      e.preventDefault()
      e.stopPropagation()
      const idx = recordingIndex
      if (idx === null) return
      update(prev => {
        const presets = prev.video.presets.map((p, i) => (i === idx ? { ...p, shortcut: shot } : p))
        return { ...prev, video: { ...prev.video, presets } }
      })
      stopRecording()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recordingIndex])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const saved = await invoke<WebviewSettings>('set_webview_settings', { settings })
      setSettings(saved)
      showToast('已保存并同步到浏览窗口', 'success')
    } catch (e) {
      showToast(String((e as { message?: string })?.message || e || '保存失败'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const addPreset = () => {
    update(prev => {
      const max = prev.video.maxRate
      const rate = clampRate(prev.video.defaultRate === 1 ? 1.5 : prev.video.defaultRate, max)
      return {
        ...prev,
        video: {
          ...prev.video,
          presets: [...prev.video.presets, { label: '', rate, shortcut: null }],
        },
      }
    })
  }

  const removePreset = (index: number) => {
    update(prev => ({
      ...prev,
      video: { ...prev.video, presets: prev.video.presets.filter((_, i) => i !== index) },
    }))
  }

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
      <Stack spacing={1.75}>
        <Box>
          <Typography fontWeight={900}>视频倍速</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>生效于浏览窗口内网页视频；预设可绑定单键（如 KeyQ）或组合键（如 control+KeyA），在网页内按快捷键切换/还原，输入框内不触发。</Typography>
        </Box>
        {settings ? (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="默认倍速"
                type="number"
                size="small"
                value={formatRate(settings.video.defaultRate)}
                onChange={e => {
                  const v = clampRate(Number(e.target.value), settings.video.maxRate)
                  update(prev => ({ ...prev, video: { ...prev.video, defaultRate: v } }))
                }}
                inputProps={{ min: 0.25, max: MAX_VIDEO_RATE, step: 0.25 }}
                sx={{ width: { xs: '100%', sm: 150 } }}
              />
              <TextField
                label="最大倍速"
                type="number"
                size="small"
                value={formatRate(settings.video.maxRate)}
                onChange={e => {
                  const max = clampRate(Number(e.target.value), MAX_VIDEO_RATE)
                  update(prev => ({
                    ...prev,
                    video: {
                      maxRate: max,
                      defaultRate: clampRate(prev.video.defaultRate, max),
                      presets: prev.video.presets.map(p => ({ ...p, rate: clampRate(p.rate, max) })),
                    },
                  }))
                }}
                inputProps={{ min: 0.25, max: MAX_VIDEO_RATE, step: 0.25 }}
                sx={{ width: { xs: '100%', sm: 150 } }}
              />
            </Stack>

            {settings.video.presets.length ? (
              <Stack spacing={1}>
                {settings.video.presets.map((p, idx) => (
                  <Paper key={idx} elevation={0} sx={{ p: 1.25, borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.72)' }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                      <TextField
                        label="名称"
                        size="small"
                        value={p.label}
                        placeholder={`${p.rate}x`}
                        onChange={e => {
                          update(prev => ({
                            ...prev,
                            video: {
                              ...prev.video,
                              presets: prev.video.presets.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                            },
                          }))
                        }}
                        sx={{ flex: 1, minWidth: 0 }}
                      />
                      <TextField
                        label="倍速"
                        type="number"
                        size="small"
                        value={formatRate(p.rate)}
                        onChange={e => {
                          const rate = clampRate(Number(e.target.value), settings.video.maxRate)
                          update(prev => ({
                            ...prev,
                            video: {
                              ...prev.video,
                              presets: prev.video.presets.map((x, i) => (i === idx ? { ...x, rate } : x)),
                            },
                          }))
                        }}
                        inputProps={{ min: 0.25, max: settings.video.maxRate, step: 0.25 }}
                        sx={{ width: { xs: '100%', sm: 110 } }}
                      />
                      <Button
                        variant={recordingIndex === idx ? 'contained' : 'outlined'}
                        onClick={() => startRecording(idx)}
                        disabled={recordingIndex !== null && recordingIndex !== idx}
                        sx={{ minWidth: 140, flex: '0 0 auto' }}
                      >
                        {recordingIndex === idx ? '等待按键…' : p.shortcut || '录制快捷键'}
                      </Button>
                      <IconButton aria-label="删除预设" title="删除预设" color="error" onClick={() => removePreset(idx)}>
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            ) : (
              <Chip size="small" label="还没有倍速预设，添加一个后可以绑定快捷键" sx={{ alignSelf: 'flex-start' }} />
            )}

            <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
              <Button startIcon={<AddRoundedIcon />} onClick={addPreset} disabled={saving}>添加预设</Button>
              <Button variant="contained" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button>
            </Stack>
          </>
        ) : (
          <Typography color="text.secondary">加载中…</Typography>
        )}
      </Stack>
    </Paper>
  )
}
