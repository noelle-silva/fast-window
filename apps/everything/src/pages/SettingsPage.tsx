import * as React from 'react'
import { channelLabel, modeLabel } from '../format'
import { SettingsTabs, type SettingsTabItem } from '../components/SettingsTabs'
import { TracklessSlider } from '../components/TracklessSlider'
import type { DataDirStatus, HealthInfo, SetupInfo } from '../types'

type SettingsTab = 'index' | 'runtime' | 'search' | 'commands'

const SETTINGS_TABS: Array<SettingsTabItem<SettingsTab>> = [
  { id: 'index', label: '索引' },
  { id: 'runtime', label: '运行' },
  { id: 'search', label: '搜索' },
  { id: 'commands', label: '命令' },
]

type SearchLimitRange = {
  min: number
  max: number
  step: number
}

type SettingsPageProps = {
  status: DataDirStatus | null
  health: HealthInfo | null
  setup: SetupInfo | null
  busy: boolean
  clientReady: boolean
  initialCommand: string | null
  runtimeCommand: string | null
  searchLimit: number
  searchLimitRange: SearchLimitRange
  onEnableGlobal: () => void
  onRestartRuntime: () => void
  onSearchLimitChange: (value: number) => void
}

function ReadyText(props: { ready?: boolean; readyText: string; pendingText: string }) {
  const { ready, readyText, pendingText } = props
  return <span className={ready ? 'everything-status-badge everything-status-ready' : 'everything-status-badge everything-status-starting'}>{ready ? readyText : pendingText}</span>
}

function FieldValue(props: { label: string; value: React.ReactNode }) {
  const { label, value } = props
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

export function SettingsPage(props: SettingsPageProps) {
  const {
    status,
    health,
    setup,
    busy,
    clientReady,
    initialCommand,
    runtimeCommand,
    searchLimit,
    searchLimitRange,
    onEnableGlobal,
    onRestartRuntime,
    onSearchLimitChange,
  } = props
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('index')
  const configured = Boolean(setup?.configured)
  const actionsDisabled = !clientReady || busy

  const renderPanel = (tab: SettingsTab, content: React.ReactNode) => (
    <div
      role="tabpanel"
      hidden={activeTab !== tab}
      id={`everything-settings-panel-${tab}`}
      aria-labelledby={`everything-settings-tab-${tab}`}
      className="everything-settings-panel"
    >
      {activeTab === tab ? content : null}
    </div>
  )

  return (
    <section className="everything-page everything-settings-page" aria-label="Everything 设置">
      <SettingsTabs items={SETTINGS_TABS} value={activeTab} onChange={setActiveTab} ariaLabel="设置分类" />

      {renderPanel('index', (
        <div className="everything-settings-stack">
          <article className="everything-panel">
            <div className="everything-panel-title-row">
              <h2>全局索引授权</h2>
              <span>{configured ? '已配置' : '待配置'}</span>
            </div>
            <p className="everything-muted">复用已授权的 Everything 全局服务；如果尚未授权，Windows 会弹出一次权限确认。</p>
            <div className="everything-actions">
              <button type="button" className="everything-setup-primary" onClick={onEnableGlobal} disabled={actionsDisabled}>{configured ? '确认全局索引' : '启用全局索引'}</button>
            </div>
          </article>
        </div>
      ))}

      {renderPanel('runtime', (
        <div className="everything-settings-stack">
          <article className="everything-panel">
            <div className="everything-panel-title-row">
              <h2>运行状态</h2>
              <ReadyText ready={health?.runtime.ready} readyText="运行中" pendingText="启动中" />
            </div>
            <dl>
              <FieldValue label="Vendor" value={health?.vendor.ready ? `Everything ${health.vendor.runtimeVersion}` : health?.vendor.error || '读取中'} />
              <FieldValue label="Runtime" value={health?.runtime.ready ? `运行中 ${health.runtime.version || ''}` : health?.runtime.error || '启动中'} />
              <FieldValue label="通道" value={channelLabel(health?.channel)} />
              <FieldValue label="实例" value={setup?.state.instanceName || '等待授权后生成'} />
              <FieldValue label="服务" value={setup?.state.serviceName || '等待授权后生成'} />
              <FieldValue label="数据目录" value={status?.dataDir || '读取中'} />
              <FieldValue label="可写" value={status?.writable ? '是' : '否'} />
            </dl>
            {status?.error ? <p className="everything-error-text">{status.error}</p> : null}
            <div className="everything-actions">
              <button type="button" onClick={onRestartRuntime} disabled={actionsDisabled || !configured}>重启 Runtime</button>
            </div>
          </article>
        </div>
      ))}

      {renderPanel('search', (
        <div className="everything-settings-stack">
          <article className="everything-panel">
            <h2>搜索体验</h2>
            <p className="everything-muted">控制每次搜索最多返回的结果数量。这个设置会立即影响顶部搜索栏发起的新搜索。</p>
            <TracklessSlider
              label="结果上限"
              min={searchLimitRange.min}
              max={searchLimitRange.max}
              step={searchLimitRange.step}
              value={searchLimit}
              onChange={onSearchLimitChange}
              formatValue={value => `${value} 项`}
            />
          </article>
        </div>
      ))}

      {renderPanel('commands', (
        <div className="everything-settings-stack">
          <article className="everything-panel">
            <h2>命令状态</h2>
            <dl>
              <FieldValue label="首次命令" value={initialCommand || '无'} />
              <FieldValue label="运行命令" value={runtimeCommand || '无'} />
              <FieldValue label="索引方式" value={configured ? modeLabel(setup?.state.mode) : '未配置'} />
            </dl>
          </article>
        </div>
      ))}
    </section>
  )
}
