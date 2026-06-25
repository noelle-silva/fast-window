import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { createDirectClient } from './directClient'
import {
  invokeCapability,
  queryCapabilityOptions,
  type HostCapabilityConfigField,
} from './hostCapabilityClient'
import type { ResultPopupPayload } from './types'

const appWindow = getCurrentWindow()

type ConfigSelection = Record<string, string>

type FieldOptions = Record<string, Array<{ value: string; label: string }>>

export function ResultPopupApp() {
  const [payload, setPayload] = React.useState<ResultPopupPayload | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const [resultVisible, setResultVisible] = React.useState(true)
  const [configSelections, setConfigSelections] = React.useState<ConfigSelection>({})
  const [fieldOptions, setFieldOptions] = React.useState<FieldOptions>({})
  const [optionLoading, setOptionLoading] = React.useState<Record<string, boolean>>({})
  const [selectionError, setSelectionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null
    let unlistenVisibility: (() => void) | null = null
    void invoke<ResultPopupPayload | null>('quick_bar_result_payload')
      .then(next => {
        if (!cancelled) setPayload(next)
      })
      .catch(e => {
        if (!cancelled) setError(errorMessage(e, '读取结果窗口内容失败'))
      })
    void listen<ResultPopupPayload>('quick-bar-result', event => {
      setError(null)
      setCopyState('idle')
      setResultVisible(true)
      setPayload(event.payload)
    })
      .then(nextUnlisten => {
        if (cancelled) {
          nextUnlisten()
        } else {
          unlisten = nextUnlisten
          void invoke('quick_bar_result_popup_ready').catch(e => {
            if (!cancelled) setError(errorMessage(e, '结果窗口准备失败'))
          })
        }
      })
      .catch(e => {
        if (!cancelled) setError(errorMessage(e, '订阅结果窗口内容失败'))
      })
    void listen<{ visible: boolean }>('quick-bar-result-visibility', event => {
      setResultVisible(event.payload.visible)
    })
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlistenVisibility = nextUnlisten
      })
    return () => {
      cancelled = true
      unlisten?.()
      unlistenVisibility?.()
    }
  }, [])

  const handleClose = React.useCallback(() => {
    void invoke('hide_quick_bar_result_popup').catch(() => {})
  }, [])

  const resultText = payload?.status === 'done' ? (payload.text || '') : ''
  const canCopy = Boolean(resultText.trim())

  React.useEffect(() => {
    if (payload?.status !== 'selecting') return
    setCopyState('idle')
    setConfigSelections({})
    setFieldOptions({})
    setOptionLoading({})
    setSelectionError(null)
  }, [payload])

  const loadFieldOptions = React.useCallback(async (field: HostCapabilityConfigField) => {
    if (payload?.status !== 'selecting') return
    const fields = payload.configFields ?? []
    if (!payload.app || !payload.capabilityId || !canLoadFieldOptions(field, fields, configSelections)) return
    if (optionLoading[field.id] || fieldOptions[field.id]) return
    setOptionLoading(prev => ({ ...prev, [field.id]: true }))
    setSelectionError(null)
    let client: Awaited<ReturnType<typeof createDirectClient>> | null = null
    try {
      client = await createDirectClient()
      const result = await queryCapabilityOptions(client, {
        app: payload.app,
        capabilityId: payload.capabilityId,
        optionSource: field.optionSource,
        config: configToRecord(configSelections, fields),
      })
      setFieldOptions(prev => ({ ...prev, [field.id]: result.options }))
    } catch (optionsError) {
      setSelectionError(`获取选项失败: ${errorMessage(optionsError, '未知错误')}`)
    } finally {
      client?.close()
      setOptionLoading(prev => ({ ...prev, [field.id]: false }))
    }
  }, [configSelections, fieldOptions, optionLoading, payload])

  React.useEffect(() => {
    if (payload?.status !== 'selecting') return
    for (const field of payload.configFields ?? []) {
      if (!canLoadFieldOptions(field, payload.configFields ?? [], configSelections)) continue
      void loadFieldOptions(field)
    }
  }, [configSelections, loadFieldOptions, payload])

  const updateConfigSelection = React.useCallback((field: HostCapabilityConfigField, value: string) => {
    const fields = payload?.configFields ?? []
    const fieldIndex = fields.findIndex(candidate => candidate.id === field.id)
    setSelectionError(null)
    setConfigSelections(prev => {
      const next = { ...prev, [field.id]: value }
      for (const dependentField of fields.slice(fieldIndex + 1)) {
        delete next[dependentField.id]
      }
      return next
    })
    setFieldOptions(prev => {
      const next = { ...prev }
      for (const dependentField of fields.slice(fieldIndex + 1)) {
        delete next[dependentField.id]
      }
      return next
    })
    setOptionLoading(prev => {
      const next = { ...prev }
      for (const dependentField of fields.slice(fieldIndex + 1)) {
        delete next[dependentField.id]
      }
      return next
    })
  }, [payload])

  const handleConfirmSelection = React.useCallback(async () => {
    if (payload?.status !== 'selecting') return
    const fields = payload.configFields ?? []
    if (!payload.app || !payload.capabilityId || !payload.selectedText || !fields.length) {
      setSelectionError('临时选择信息不完整')
      return
    }
    const missingField = firstMissingConfigField(fields, configSelections)
    if (missingField) {
      setSelectionError(`请先选择：${missingField.label}`)
      return
    }

    const title = payload.title
    const loadingPayload: ResultPopupPayload = { title, status: 'loading' }
    setPayload(loadingPayload)
    await invoke('update_quick_bar_result_popup', { payload: loadingPayload }).catch(() => {})
    let client: Awaited<ReturnType<typeof createDirectClient>> | null = null
    try {
      client = await createDirectClient()
      const response = await invokeCapability(client, {
        app: payload.app,
        capabilityId: payload.capabilityId,
        input: payload.selectedText,
        config: configToRecord(configSelections, fields),
      })
      const donePayload: ResultPopupPayload = { title, status: 'done', text: response.text }
      setPayload(donePayload)
      await invoke('update_quick_bar_result_popup', { payload: donePayload })
    } catch (invokeError) {
      const errorPayload: ResultPopupPayload = { title, status: 'error', errorText: errorMessage(invokeError, '能力调用失败') }
      setPayload(errorPayload)
      await invoke('update_quick_bar_result_popup', { payload: errorPayload }).catch(() => {})
    } finally {
      client?.close()
    }
  }, [configSelections, payload])

  const handleCancelSelection = React.useCallback(() => {
    void invoke('hide_quick_bar_result_popup').catch(() => {})
  }, [])

  const handleCopy = React.useCallback(async () => {
    if (!canCopy) return
    try {
      await writeText(resultText)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1400)
    } catch {
      setCopyState('failed')
    }
  }, [canCopy, resultText])

  const handleStartDragging = React.useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return
    void invoke('quick_bar_result_drag_started')
      .then(() => appWindow.startDragging())
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleClose])

  const title = payload?.title || 'Quick Bar 结果'
  return (
    <main className={`quickbar-result-shell${resultVisible ? '' : ' quickbar-result-shell--hidden'}`} aria-label="Quick Bar 结果浮窗" aria-hidden={!resultVisible}>
      <section className="quickbar-result-popup" aria-live="polite">
        <div className="quickbar-result-header">
          <div className="quickbar-result-drag-region" onMouseDown={handleStartDragging}>
            <span className="quickbar-result-title">{title}</span>
            <span className="quickbar-result-subtitle">能力调用结果</span>
          </div>
          <div className="quickbar-result-actions">
            <button type="button" className="quickbar-result-action" onClick={handleCopy} disabled={!canCopy} aria-label="复制结果">
              {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
            </button>
            <button type="button" className="quickbar-result-close" onClick={handleClose} aria-label="关闭结果浮窗">×</button>
          </div>
        </div>
        <div className="quickbar-result-body">
          {error ? (
            <p className="quickbar-result-error">{error}</p>
          ) : !payload || payload.status === 'loading' ? (
            <div className="quickbar-result-spinner" aria-label="能力调用中">
              <svg viewBox="0 0 24 24" width="28" height="28">
                <circle className="quickbar-result-spinner-track" cx="12" cy="12" r="10" fill="none" strokeWidth="3" />
                <circle className="quickbar-result-spinner-ring" cx="12" cy="12" r="10" fill="none" strokeWidth="3" strokeDasharray="40 60" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                </circle>
              </svg>
              <p>能力调用中...</p>
            </div>
          ) : payload.status === 'error' ? (
            <p className="quickbar-result-error">{payload.errorText || '能力调用失败'}</p>
          ) : payload.status === 'selecting' ? (
            <ResultSelectionForm
              payload={payload}
              selections={configSelections}
              fieldOptions={fieldOptions}
              optionLoading={optionLoading}
              error={selectionError}
              onChange={updateConfigSelection}
              onConfirm={handleConfirmSelection}
              onCancel={handleCancelSelection}
            />
          ) : (
            <pre className="quickbar-result-text">{payload.text || '（无返回内容）'}</pre>
          )}
        </div>
      </section>
    </main>
  )
}

function ResultSelectionForm(props: {
  payload: ResultPopupPayload
  selections: ConfigSelection
  fieldOptions: FieldOptions
  optionLoading: Record<string, boolean>
  error: string | null
  onChange: (field: HostCapabilityConfigField, value: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const { payload, selections, fieldOptions, optionLoading, error, onChange, onConfirm, onCancel } = props
  const fields = payload.configFields ?? []
  return (
    <div className="quickbar-result-selection-form">
      <p className="quickbar-result-selection-intro">请选择本次调用要使用的配置。</p>
      <div className="quickbar-result-selection-fields">
        {fields.map(field => (
          <ResultConfigField
            key={field.id}
            field={field}
            value={selections[field.id] || ''}
            options={fieldOptions[field.id]}
            loading={optionLoading[field.id]}
            waitingForPrevious={!canLoadFieldOptions(field, fields, selections)}
            onChange={value => onChange(field, value)}
          />
        ))}
      </div>
      {error ? <p className="quickbar-result-error">{error}</p> : null}
      <div className="quickbar-result-selection-actions">
        <button type="button" className="quickbar-result-selection-secondary" onClick={onCancel}>取消</button>
        <button type="button" className="quickbar-result-selection-primary" onClick={onConfirm}>确定执行</button>
      </div>
    </div>
  )
}

function ResultConfigField(props: {
  field: HostCapabilityConfigField
  value: string
  options?: Array<{ value: string; label: string }>
  loading: boolean
  waitingForPrevious: boolean
  onChange: (value: string) => void
}) {
  const { field, value, options, loading, waitingForPrevious, onChange } = props
  return (
    <label className="quickbar-result-config-field">
      <span className="quickbar-result-config-field-label">{field.label}{field.required ? ' *' : ''}</span>
      {loading ? (
        <span className="quickbar-result-config-field-note">加载选项中...</span>
      ) : options?.length ? (
        <select value={value} onChange={event => onChange(event.target.value)}>
          <option value="">请选择</option>
          {options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : (
        <span className="quickbar-result-config-field-note">{waitingForPrevious ? '请先选择上方配置' : '暂无可用选项'}</span>
      )}
    </label>
  )
}

function configToRecord(selections: ConfigSelection, fields: HostCapabilityConfigField[]): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  for (const field of fields) {
    const value = selections[field.id]
    if (value) config[field.id] = value
  }
  return config
}

function canLoadFieldOptions(field: HostCapabilityConfigField, fields: HostCapabilityConfigField[], selections: ConfigSelection): boolean {
  const fieldIndex = fields.findIndex(candidate => candidate.id === field.id)
  if (fieldIndex <= 0) return true
  return fields.slice(0, fieldIndex).every(previousField => Boolean(selections[previousField.id]))
}

function firstMissingConfigField(fields: HostCapabilityConfigField[], selections: ConfigSelection): HostCapabilityConfigField | null {
  for (const field of fields) {
    if (!selections[field.id]) return field
  }
  return null
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}
