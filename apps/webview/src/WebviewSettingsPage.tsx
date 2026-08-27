import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { buildShortcutFromEvent } from './keyboard'
import { MAX_VIDEO_RATE, type WebviewSettings } from './webviewSettings'

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

export function WebviewSettingsPage() {
  const [settings, setSettings] = useState<WebviewSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null)
  const [recordingDefault, setRecordingDefault] = useState(false)
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

  const startRecording = (index: number | 'default') => {
    recordingRef.current = true
    if (index === 'default') {
      setRecordingDefault(true)
      setRecordingIndex(null)
    } else if (typeof index === 'number') {
      setRecordingIndex(index)
      setRecordingDefault(false)
    }
  }

  const stopRecording = () => {
    recordingRef.current = false
    setRecordingIndex(null)
    setRecordingDefault(false)
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
      if (recordingDefault) {
        setMessage('默认倍速不受快捷键影响，快捷键仅作用于预设')
        stopRecording()
        return
      }
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
  }, [recordingIndex, recordingDefault])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await invoke<WebviewSettings>('set_webview_settings', { settings })
      setSettings(saved)
      setMessage('已保存')
    } catch (e) {
      setError(String((e as { message?: string })?.message || e || '保存失败'))
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
    <div className="webview-settings">
      <h2 className="webview-settings-title">视频倍速设置</h2>
      <p className="webview-settings-hint">生效于浏览窗口内网页视频；预设可绑定快捷键（如 control+KeyA，也支持单个按键如 KeyB），在网页内按快捷键切换/还原。</p>

      {settings ? (
        <>
          <div className="webview-settings-row">
            <label className="webview-settings-field">
              <span>默认倍速</span>
              <input
                type="number"
                min={0.25}
                max={MAX_VIDEO_RATE}
                step={0.25}
                value={formatRate(settings.video.defaultRate)}
                disabled={recordingDefault}
                onChange={e => {
                  const v = clampRate(Number(e.target.value), settings.video.maxRate)
                  update(prev => ({ ...prev, video: { ...prev.video, defaultRate: v } }))
                }}
              />
            </label>
            <label className="webview-settings-field">
              <span>最大倍速</span>
              <input
                type="number"
                min={0.25}
                max={MAX_VIDEO_RATE}
                step={0.25}
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
              />
            </label>
          </div>

          <div className="webview-settings-presets">
            {settings.video.presets.map((p, idx) => (
              <div key={idx} className="webview-settings-preset">
                <label className="webview-settings-field">
                  <span>名称</span>
                  <input
                    type="text"
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
                  />
                </label>
                <label className="webview-settings-field">
                  <span>倍速</span>
                  <input
                    type="number"
                    min={0.25}
                    max={settings.video.maxRate}
                    step={0.25}
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
                  />
                </label>
                <div className="webview-settings-field">
                  <span>快捷键</span>
                  <button type="button" className="webview-settings-recorder" onClick={() => startRecording(idx)} disabled={recordingIndex !== null && recordingIndex !== idx}>
                    {recordingIndex === idx ? '等待按键…' : p.shortcut || '点击录制'}
                  </button>
                </div>
                <button type="button" className="webview-settings-delete" aria-label="删除预设" title="删除预设" onClick={() => removePreset(idx)}>
                  删除
                </button>
              </div>
            ))}
          </div>

          <div className="webview-settings-actions">
            <button type="button" className="webview-settings-add" onClick={addPreset}>
              添加预设
            </button>
            <button type="button" className="webview-settings-save" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>

          {message ? <p className="webview-settings-ok">{message}</p> : null}
          {error ? <p className="webview-settings-err">{error}</p> : null}
        </>
      ) : (
        <p className="webview-settings-hint">加载中…</p>
      )}
    </div>
  )
}
