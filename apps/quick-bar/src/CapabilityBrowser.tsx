import * as React from 'react'
import type { DirectClient } from './types'
import { addRegistryButton } from './registryClient'
import {
  fetchCapabilities,
  queryCapabilityOptions,
  type HostCapabilityItem,
  type HostCapabilityConfigField,
  type HostCapabilityError,
  type HostCapabilityListRequest,
} from './hostCapabilityClient'

type CapabilityBrowserProps = {
  client: DirectClient
}

type ConfigSelection = Record<string, string>

type FieldOptions = Record<string, Array<{ value: string; label: string }>>

type AppCapabilityGroup = {
  appId: string
  appName: string
  capabilities: HostCapabilityItem[]
  errors: HostCapabilityError[]
}

export function CapabilityBrowser(props: CapabilityBrowserProps) {
  const { client } = props
  const [capabilities, setCapabilities] = React.useState<HostCapabilityItem[] | null>(null)
  const [capabilityErrors, setCapabilityErrors] = React.useState<HostCapabilityError[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedAppId, setSelectedAppId] = React.useState<string | null>(null)
  const [selectedCapabilityKey, setSelectedCapabilityKey] = React.useState<string | null>(null)
  const [configSelections, setConfigSelections] = React.useState<ConfigSelection>({})
  const [fieldOptions, setFieldOptions] = React.useState<FieldOptions>({})
  const [optionLoading, setOptionLoading] = React.useState<Record<string, boolean>>({})
  const [buttonTitles, setButtonTitles] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [refreshingAppId, setRefreshingAppId] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const mountedRef = React.useRef(true)

  React.useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const loadCapabilities = React.useCallback(async (request: HostCapabilityListRequest = {}) => {
    const targetAppId = request.appId?.trim() || ''
    if (targetAppId) setRefreshingAppId(targetAppId)
    else setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const result = await fetchCapabilities(client, request)
      if (mountedRef.current) {
        if (targetAppId) {
          setCapabilities(prev => mergeCapabilitiesForApp(prev ?? [], targetAppId, result.capabilities))
          setCapabilityErrors(prev => mergeErrorsForApp(prev, targetAppId, result.errors))
          setMessage(result.capabilities.length ? `已读取：${result.capabilities[0].appName || targetAppId}` : '目标应用当前没有返回可注册能力')
        } else {
          setCapabilities(result.capabilities)
          setCapabilityErrors(result.errors)
        }
      }
    } catch (loadError) {
      if (mountedRef.current) {
        const text = String((loadError as { message?: string })?.message || loadError || '获取能力列表失败')
        if (targetAppId) setMessage(`读取失败: ${text}`)
        else setError(text)
      }
    } finally {
      if (mountedRef.current) {
        if (targetAppId) setRefreshingAppId(null)
        else setLoading(false)
      }
    }
  }, [client])

  React.useEffect(() => {
    void loadCapabilities({ launchPolicy: 'runningOnly' })
  }, [loadCapabilities])

  const visibleCapabilities = capabilities ?? []
  const appGroups = React.useMemo(
    () => groupCapabilitiesByApp(visibleCapabilities, capabilityErrors),
    [visibleCapabilities, capabilityErrors],
  )
  const selectedGroup = appGroups.find(group => group.appId === selectedAppId) ?? null
  const selectedCapability = selectedGroup?.capabilities.find(item => capabilityKey(item) === selectedCapabilityKey)
    ?? selectedGroup?.capabilities[0]
    ?? null

  React.useEffect(() => {
    if (!selectedAppId) return
    const group = appGroups.find(item => item.appId === selectedAppId)
    if (!group) {
      setSelectedAppId(null)
      setSelectedCapabilityKey(null)
      return
    }
    if (group.capabilities.length && !group.capabilities.some(item => capabilityKey(item) === selectedCapabilityKey)) {
      setSelectedCapabilityKey(capabilityKey(group.capabilities[0]))
    }
  }, [appGroups, selectedAppId, selectedCapabilityKey])

  const openGroup = React.useCallback((group: AppCapabilityGroup) => {
    if (!group.capabilities.length) return
    setSelectedAppId(group.appId)
    setSelectedCapabilityKey(capabilityKey(group.capabilities[0]))
    setMessage(null)
  }, [])

  const closeGroup = React.useCallback(() => {
    setSelectedAppId(null)
    setSelectedCapabilityKey(null)
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
        if (!configSelections[optionKey]) {
          setConfigSelections(prev => ({ ...prev, [optionKey]: options[0].value }))
        }
      }
    } catch (optionsError) {
      setMessage(`获取选项失败: ${String((optionsError as { message?: string })?.message || optionsError)}`)
    } finally {
      setOptionLoading(prev => ({ ...prev, [optionKey]: false }))
    }
  }, [client, configSelections, fieldOptions])

  React.useEffect(() => {
    if (!selectedCapability?.configFields?.length) return
    for (const field of selectedCapability.configFields) {
      if (!canLoadFieldOptions(selectedCapability, field, configSelections)) continue
      void loadFieldOptions(selectedCapability, field)
    }
  }, [selectedCapability, loadFieldOptions, configSelections])

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

  const updateButtonTitle = React.useCallback((item: HostCapabilityItem, value: string) => {
    setButtonTitles(prev => ({ ...prev, [capabilityKey(item)]: value }))
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
      const title = (buttonTitles[capabilityKey(item)] ?? item.title ?? item.capabilityId).trim()
      if (!title) {
        setMessage('请填写按钮名称')
        return
      }
      await addRegistryButton(client, {
        app: item.app,
        appId: item.appId,
        capabilityId: item.capabilityId,
        title,
        config: configToRecord(configSelections, item),
      })
      setMessage(`已注册：${title}`)
    } catch (registerError) {
      setMessage(`注册失败: ${String((registerError as { message?: string })?.message || registerError)}`)
    } finally {
      setBusy(false)
    }
  }, [buttonTitles, client, configSelections])

  if (loading) return <section className="quickbar-capability-loading" aria-label="能力列表加载中">加载能力清单...</section>
  if (error) return <section className="quickbar-error-card" role="alert">{error}</section>
  if (!appGroups.length) {
    return <section className="quickbar-capability-empty" aria-label="无可用能力">暂无可用能力。默认只读取已运行 App；请先启动目标 App 后再刷新。</section>
  }

  return (
    <section className="quickbar-capability-browser" aria-label="能力浏览">
      <div className="quickbar-capability-header">
        <div>
          <h2>应用能力</h2>
          <p className="quickbar-muted">一个卡片对应一个 App。打开卡片后选择具体能力并注册为浮动条按钮。</p>
        </div>
        <button
          type="button"
          className="quickbar-capability-refresh"
          disabled={loading || !!refreshingAppId}
          onClick={() => void loadCapabilities({ launchPolicy: 'runningOnly' })}
        >
          刷新已运行 App
        </button>
      </div>

      {message ? (
        <div className={`quickbar-capability-message ${message.startsWith('已') ? 'quickbar-capability-message-ok' : 'quickbar-capability-message-error'}`} role="alert">
          {message}
        </div>
      ) : null}

      <div className="quickbar-app-card-grid">
        {appGroups.map(group => (
          <AppCapabilityCard
            key={group.appId}
            group={group}
            refreshing={refreshingAppId === group.appId}
            onOpen={() => openGroup(group)}
            onRefresh={() => void loadCapabilities({ appId: group.appId, launchPolicy: 'allowLaunch' })}
          />
        ))}
      </div>

      {selectedGroup ? (
        <CapabilityRegisterModal
          group={selectedGroup}
          selectedCapability={selectedCapability}
          selectedCapabilityKey={selectedCapabilityKey}
          configSelections={configSelections}
          fieldOptions={fieldOptions}
          optionLoading={optionLoading}
          buttonTitles={buttonTitles}
          busy={busy}
          onClose={closeGroup}
          onSelectCapability={setSelectedCapabilityKey}
          onConfigChange={updateConfigSelection}
          onTitleChange={updateButtonTitle}
          onRegister={handleRegister}
        />
      ) : null}
    </section>
  )
}

function AppCapabilityCard(props: {
  group: AppCapabilityGroup
  refreshing: boolean
  onOpen: () => void
  onRefresh: () => void
}) {
  const { group, refreshing, onOpen, onRefresh } = props
  const primaryError = group.errors[0]
  return (
    <article className="quickbar-app-card">
      <button type="button" className="quickbar-app-card-main" onClick={onOpen} disabled={!group.capabilities.length}>
        <span className="quickbar-app-card-title">{group.appName || group.appId}</span>
        <span className="quickbar-app-card-meta">{group.capabilities.length ? `${group.capabilities.length} 项能力` : '暂无可注册能力'}</span>
      </button>
      {primaryError ? <p className="quickbar-app-card-error">{primaryError.message || '读取能力失败'}</p> : null}
      {primaryError?.appId && primaryError.canLaunch !== false ? (
        <button type="button" className="quickbar-app-card-action" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? '读取中...' : '启动并读取'}
        </button>
      ) : null}
    </article>
  )
}

function CapabilityRegisterModal(props: {
  group: AppCapabilityGroup
  selectedCapability: HostCapabilityItem | null
  selectedCapabilityKey: string | null
  configSelections: ConfigSelection
  fieldOptions: FieldOptions
  optionLoading: Record<string, boolean>
  buttonTitles: Record<string, string>
  busy: boolean
  onClose: () => void
  onSelectCapability: (key: string) => void
  onConfigChange: (item: HostCapabilityItem, field: HostCapabilityConfigField, value: string) => void
  onTitleChange: (item: HostCapabilityItem, value: string) => void
  onRegister: (item: HostCapabilityItem) => void
}) {
  const {
    group,
    selectedCapability,
    selectedCapabilityKey,
    configSelections,
    fieldOptions,
    optionLoading,
    buttonTitles,
    busy,
    onClose,
    onSelectCapability,
    onConfigChange,
    onTitleChange,
    onRegister,
  } = props

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="quickbar-capability-modal-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="quickbar-capability-modal" role="dialog" aria-modal="true" aria-label={`${group.appName || group.appId} 能力注册`}>
        <header className="quickbar-capability-modal-header">
          <div>
            <h3>{group.appName || group.appId}</h3>
            <p>{group.capabilities.length} 项可注册能力</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭能力选择">×</button>
        </header>

        <div className="quickbar-capability-modal-body">
          <div className="quickbar-capability-modal-list" aria-label="能力列表">
            {group.capabilities.map(item => {
              const itemKey = capabilityKey(item)
              return (
                <button
                  key={itemKey}
                  type="button"
                  className={itemKey === selectedCapabilityKey ? 'quickbar-capability-choice-active' : ''}
                  onClick={() => onSelectCapability(itemKey)}
                >
                  <span>{item.title || item.capabilityId}</span>
                  <small>{item.capabilityId}</small>
                </button>
              )
            })}
          </div>

          <div className="quickbar-capability-modal-detail">
            {selectedCapability ? (
              <>
                <h4>{selectedCapability.title || selectedCapability.capabilityId}</h4>
                {selectedCapability.description ? <p className="quickbar-muted">{selectedCapability.description}</p> : null}

                {selectedCapability.configFields?.length ? (
                  <div className="quickbar-capability-config-fields">
                    {selectedCapability.configFields.map(field => {
                      const fieldKey = configSelectionKey(selectedCapability, field)
                      return (
                        <CapabilityConfigField
                          key={fieldKey}
                          field={field}
                          value={configSelections[fieldKey] || ''}
                          options={fieldOptions[fieldKey]}
                          loading={optionLoading[fieldKey]}
                          waitingForPrevious={!canLoadFieldOptions(selectedCapability, field, configSelections)}
                          onChange={value => onConfigChange(selectedCapability, field, value)}
                        />
                      )
                    })}
                  </div>
                ) : null}

                <label className="quickbar-capability-field">
                  <span className="quickbar-capability-field-label">按钮名称 *</span>
                  <input
                    type="text"
                    value={buttonTitles[capabilityKey(selectedCapability)] ?? selectedCapability.title ?? selectedCapability.capabilityId}
                    onChange={event => onTitleChange(selectedCapability, event.target.value)}
                  />
                </label>

                <div className="quickbar-capability-card-actions">
                  <button type="button" onClick={() => onRegister(selectedCapability)} disabled={busy}>
                    注册为悬浮栏按钮
                  </button>
                </div>
              </>
            ) : (
              <p className="quickbar-muted">这个 App 当前没有可注册能力。</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function groupCapabilitiesByApp(capabilities: HostCapabilityItem[], errors: HostCapabilityError[]): AppCapabilityGroup[] {
  const groups = new Map<string, AppCapabilityGroup>()
  const ensureGroup = (appId: string, appName: string) => {
    const key = appId || appName || 'unknown-app'
    const current = groups.get(key)
    if (current) return current
    const next = { appId: key, appName: appName || appId || '未知应用', capabilities: [], errors: [] }
    groups.set(key, next)
    return next
  }
  for (const item of capabilities) {
    ensureGroup(item.appId, item.appName || item.appId).capabilities.push(item)
  }
  for (const error of errors) {
    ensureGroup(error.appId || '', error.appName || error.appId || '').errors.push(error)
  }
  return [...groups.values()].sort((left, right) => (left.appName || left.appId).localeCompare(right.appName || right.appId))
}

function mergeCapabilitiesForApp(current: HostCapabilityItem[], appId: string, next: HostCapabilityItem[]): HostCapabilityItem[] {
  return current.filter(item => item.appId !== appId).concat(next)
}

function mergeErrorsForApp(current: HostCapabilityError[], appId: string, next: HostCapabilityError[]): HostCapabilityError[] {
  return current.filter(item => item.appId !== appId).concat(next)
}

function CapabilityConfigField(props: {
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
        <select value={value} onChange={event => onChange(event.target.value)}>
          <option value="">请选择</option>
          {options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
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
  return `${capabilityKey(item)}:${field.id}`
}

function capabilityKey(item: HostCapabilityItem): string {
  return `${item.appId}:${item.capabilityId}`
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
    return response.map(option => {
      if (typeof option === 'string') return { value: option, label: option }
      if (typeof option === 'object' && option !== null) {
        const optionRecord = option as Record<string, unknown>
        return { value: String(optionRecord.value ?? optionRecord.id ?? ''), label: String(optionRecord.label ?? optionRecord.name ?? optionRecord.value ?? '') }
      }
      return { value: String(option), label: String(option) }
    })
  }
  if (typeof response === 'object' && response !== null) {
    const responseRecord = response as Record<string, unknown>
    if (responseRecord.options && Array.isArray(responseRecord.options)) {
      return extractOptions(responseRecord.options)
    }
  }
  return []
}
