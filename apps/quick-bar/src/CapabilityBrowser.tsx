import * as React from 'react'
import type { DirectClient } from './types'
import { addRegistryButton } from './registryClient'
import {
  fetchCapabilities,
  queryCapabilityOptions,
  type HostCapabilityItem,
  type HostCapabilityConfigField,
  type HostCapabilityError,
} from './hostCapabilityClient'

type CapabilityBrowserProps = {
  client: DirectClient
}

type ConfigSelection = Record<string, string>

type FieldOptions = Record<string, Array<{ value: string; label: string }>>

export function CapabilityBrowser(props: CapabilityBrowserProps) {
  const { client } = props
  const [capabilities, setCapabilities] = React.useState<HostCapabilityItem[] | null>(null)
  const [capabilityErrors, setCapabilityErrors] = React.useState<HostCapabilityError[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [configSelections, setConfigSelections] = React.useState<ConfigSelection>({})
  const [fieldOptions, setFieldOptions] = React.useState<FieldOptions>({})
  const [optionLoading, setOptionLoading] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchCapabilities(client)
        if (!cancelled) {
          setCapabilities(result.capabilities)
          setCapabilityErrors(result.errors)
        }
      } catch (e) {
        if (!cancelled) setError(String((e as { message?: string })?.message || e || '获取能力列表失败'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [client])

  const toggleExpand = React.useCallback((capabilityId: string) => {
    setExpandedId(prev => prev === capabilityId ? null : capabilityId)
  }, [])

  const loadFieldOptions = React.useCallback(async (item: HostCapabilityItem, field: HostCapabilityConfigField) => {
    const optionKey = configSelectionKey(item, field)
    if (fieldOptions[optionKey]) return
    setOptionLoading(prev => ({ ...prev, [optionKey]: true }))
    try {
      const result = await queryCapabilityOptions(client, {
        app: item.app,
        capabilityId: item.capabilityId,
        optionSource: field.optionSource,
        config: configToRecord(configSelections, item),
      })
      const options = extractOptions(result.response)
      if (options.length > 0) {
        setFieldOptions(prev => ({ ...prev, [optionKey]: options }))
        if (!configSelections[optionKey] && options.length > 0) {
          setConfigSelections(prev => ({ ...prev, [optionKey]: options[0].value }))
        }
      }
    } catch (e) {
      setMessage(`获取选项失败: ${String((e as { message?: string })?.message || e)}`)
    } finally {
      setOptionLoading(prev => ({ ...prev, [optionKey]: false }))
    }
  }, [client, fieldOptions, configSelections])

  React.useEffect(() => {
    const active = capabilities?.find(c => {
      const capId = `${c.appId}:${c.capabilityId}`
      return capId === expandedId
    })
    if (!active?.configFields?.length) return
    for (const field of active.configFields) {
      if (!canLoadFieldOptions(active, field, configSelections)) continue
      void loadFieldOptions(active, field)
    }
  }, [expandedId, capabilities, loadFieldOptions, configSelections])

  const updateConfigSelection = React.useCallback((item: HostCapabilityItem, field: HostCapabilityConfigField, value: string) => {
    const fields = item.configFields ?? []
    const fieldIndex = fields.findIndex(candidate => candidate.id === field.id)
    setConfigSelections(prev => {
      const next = { ...prev, [configSelectionKey(item, field)]: value }
      for (const dependentField of fields.slice(fieldIndex + 1)) {
        delete next[configSelectionKey(item, dependentField)]
      }
      return next
    })
    setFieldOptions(prev => {
      const next = { ...prev }
      for (const dependentField of fields.slice(fieldIndex + 1)) {
        delete next[configSelectionKey(item, dependentField)]
      }
      return next
    })
  }, [])

  const handleRegister = React.useCallback(async (item: HostCapabilityItem) => {
    setBusy(true)
    setMessage(null)
    try {
      const missingField = firstMissingConfigField(configSelections, item)
      if (missingField) {
        setMessage(`请先选择：${missingField.label}`)
        return
      }
      await addRegistryButton(client, {
        app: item.app,
        appId: item.appId,
        capabilityId: item.capabilityId,
        title: item.title || item.capabilityId,
        config: configToRecord(configSelections, item),
      })
      setMessage(`已注册：${item.title || item.capabilityId}`)
    } catch (e) {
      setMessage(`注册失败: ${String((e as { message?: string })?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }, [client, configSelections])

  if (loading) return <section className="quickbar-capability-loading" aria-label="能力列表加载中">加载能力清单...</section>
  if (error) return <section className="quickbar-error-card" role="alert">{error}</section>
  const visibleCapabilities = capabilities ?? []
  if (!visibleCapabilities.length && !capabilityErrors.length) {
    return <section className="quickbar-capability-empty" aria-label="无可用能力">暂无可用能力。请确认已有能力 App 可以启动并回答能力清单。</section>
  }

  return (
    <section className="quickbar-capability-browser" aria-label="能力浏览">
      <h2>可用能力</h2>
      <p className="quickbar-muted">以下能力来自宿主现场询问已注册 App 的当前回答。选择能力并完成配置后，即可注册为悬浮栏按钮。</p>

      {capabilityErrors.length ? (
        <div className="quickbar-capability-errors" role="alert" aria-label="部分能力读取失败">
          {capabilityErrors.map(error => (
            <div key={`${error.appId}:${error.message}`} className="quickbar-capability-message quickbar-capability-message-error">
              {error.appId ? `${error.appId}: ` : ''}{error.message || '读取能力失败'}
            </div>
          ))}
        </div>
      ) : null}

      {message ? (
        <div className={`quickbar-capability-message ${message.startsWith('已') ? 'quickbar-capability-message-ok' : 'quickbar-capability-message-error'}`} role="alert">
          {message}
        </div>
      ) : null}

      <div className="quickbar-capability-list">
        {visibleCapabilities.map(item => {
          const capId = `${item.appId}:${item.capabilityId}`
          const expanded = expandedId === capId
          return (
            <article key={capId} className={`quickbar-capability-card ${expanded ? 'quickbar-capability-card-expanded' : ''}`}>
              <button
                type="button"
                className="quickbar-capability-card-header"
                onClick={() => toggleExpand(capId)}
                aria-expanded={expanded}
              >
                <div className="quickbar-capability-card-info">
                  <span className="quickbar-capability-card-title">{item.title || item.capabilityId}</span>
                  <span className="quickbar-capability-card-source">{item.appName || item.appId}</span>
                </div>
                <span className="quickbar-capability-card-chevron" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
              </button>

              {expanded ? (
                <div className="quickbar-capability-card-body">
                  {item.description ? <p>{item.description}</p> : null}

                  {item.configFields?.length ? (
                    <div className="quickbar-capability-config-fields">
                      {item.configFields.map(field => {
                        const fieldKey = configSelectionKey(item, field)
                        return (
                          <CapabilityConfigField
                            key={fieldKey}
                            item={item}
                            field={field}
                            value={configSelections[fieldKey] || ''}
                            options={fieldOptions[fieldKey]}
                            loading={optionLoading[fieldKey]}
                            waitingForPrevious={!canLoadFieldOptions(item, field, configSelections)}
                            onChange={value => updateConfigSelection(item, field, value)}
                          />
                        )
                      })}
                    </div>
                  ) : null}

                  <div className="quickbar-capability-card-actions">
                    <button
                      type="button"
                      onClick={() => handleRegister(item)}
                      disabled={busy}
                    >
                      注册为悬浮栏按钮
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function CapabilityConfigField(props: {
  item: HostCapabilityItem
  field: HostCapabilityConfigField
  value: string
  options?: Array<{ value: string; label: string }>
  loading: boolean
  waitingForPrevious: boolean
  onChange: (value: string) => void
}) {
  const { field, value, options, loading, waitingForPrevious, onChange } = props
  return (
    <label className="quickbar-capability-field">
      <span className="quickbar-capability-field-label">{field.label}{field.required ? ' *' : ''}</span>
      {loading ? (
        <span className="quickbar-capability-field-loading">加载选项中...</span>
      ) : options?.length ? (
        <select value={value} onChange={e => onChange(e.target.value)}>
          <option value="">请选择</option>
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <span className="quickbar-capability-field-loading">{waitingForPrevious ? '请先选择上方配置' : '暂无可用选项'}</span>
      )}
    </label>
  )
}

function configToRecord(selections: ConfigSelection, item: HostCapabilityItem): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  for (const field of item.configFields ?? []) {
    const value = selections[configSelectionKey(item, field)]
    if (value) config[field.id] = value
  }
  return config
}

function configSelectionKey(item: HostCapabilityItem, field: HostCapabilityConfigField): string {
  return `${item.appId}:${item.capabilityId}:${field.id}`
}

function canLoadFieldOptions(item: HostCapabilityItem, field: HostCapabilityConfigField, selections: ConfigSelection): boolean {
  const fields = item.configFields ?? []
  const fieldIndex = fields.findIndex(candidate => candidate.id === field.id)
  if (fieldIndex <= 0) return true
  return fields.slice(0, fieldIndex).every(previousField => Boolean(selections[configSelectionKey(item, previousField)]))
}

function firstMissingConfigField(selections: ConfigSelection, item: HostCapabilityItem): HostCapabilityConfigField | null {
  for (const field of item.configFields ?? []) {
    if (!selections[configSelectionKey(item, field)]) return field
  }
  return null
}

function extractOptions(response: unknown): Array<{ value: string; label: string }> {
  if (!response) return []
  if (Array.isArray(response)) {
    return response.map(opt => {
      if (typeof opt === 'string') return { value: opt, label: opt }
      if (typeof opt === 'object' && opt !== null) {
        const o = opt as Record<string, unknown>
        return { value: String(o.value ?? o.id ?? ''), label: String(o.label ?? o.name ?? o.value ?? '') }
      }
      return { value: String(opt), label: String(opt) }
    })
  }
  if (typeof response === 'object' && response !== null) {
    const obj = response as Record<string, unknown>
    if (obj.options && Array.isArray(obj.options)) {
      return extractOptions(obj.options)
    }
  }
  return []
}
