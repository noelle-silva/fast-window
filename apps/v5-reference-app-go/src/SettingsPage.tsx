import * as React from 'react'
import { SettingsTabs, type SettingsTabItem } from './components/SettingsTabs'
import { TracklessSlider } from './components/TracklessSlider'
import type { DataDirStatus, DirectClient, FwLaunchInfo, ReferenceSettings } from './types'

type SettingsTab = 'overview' | 'data' | 'backend' | 'example' | 'components'

const SETTINGS_TABS: Array<SettingsTabItem<SettingsTab>> = [
  { id: 'overview', label: '概览' },
  { id: 'data', label: '数据' },
  { id: 'backend', label: '后台' },
  { id: 'example', label: '示例设置' },
  { id: 'components', label: '自绘组件' },
]

type SettingsPageProps = {
  launchInfo: FwLaunchInfo
  initialCommand: string | null
  runtimeCommand: string | null
  status: DataDirStatus | null
  settings: ReferenceSettings | null
  message: string
  health: Record<string, unknown> | null
  client: DirectClient | null
  phase: 'starting' | 'ready' | 'failed'
  busy: boolean
  error: string | null
  onMessageChange: (message: string) => void
  onSaveSettings: () => Promise<void> | void
  onPickDataDir: () => Promise<void> | void
  onRestartBackend: () => Promise<void> | void
}

function FieldValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

export function SettingsPage(props: SettingsPageProps) {
  const {
    launchInfo,
    initialCommand,
    runtimeCommand,
    status,
    settings,
    message,
    health,
    client,
    phase,
    busy,
    error,
    onMessageChange,
    onSaveSettings,
    onPickDataDir,
    onRestartBackend,
  } = props
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('overview')
  const [sliderDemoValue, setSliderDemoValue] = React.useState(64)

  const renderPanel = (tab: SettingsTab, content: React.ReactNode) => (
    <div
      role="tabpanel"
      hidden={activeTab !== tab}
      id={`reference-settings-panel-${tab}`}
      aria-labelledby={`reference-settings-tab-${tab}`}
      className="reference-settings-panel"
    >
      {activeTab === tab ? content : null}
    </div>
  )

  return (
    <section className="reference-settings-page" aria-label="参考应用设置">
      <SettingsTabs items={SETTINGS_TABS} value={activeTab} onChange={setActiveTab} ariaLabel="设置分类" />

      {renderPanel('overview', (
        <div className="reference-settings-stack">
          <article className="reference-panel">
            <h2>启动信息</h2>
            <dl>
              <FieldValue label="启动来源" value={launchInfo.launched ? 'FW launched' : 'Standalone'} />
              <FieldValue label="窗口模式" value={launchInfo.mode} />
              <FieldValue label="初始命令" value={initialCommand || '无'} />
              <FieldValue label="运行中命令" value={runtimeCommand || '无'} />
            </dl>
          </article>
        </div>
      ))}

      {renderPanel('data', (
        <div className="reference-settings-stack">
          <article className="reference-panel">
            <h2>数据目录</h2>
            <dl>
              <FieldValue label="当前目录" value={status?.dataDir || '读取中'} />
              <FieldValue label="默认目录" value={status?.defaultDataDir || '读取中'} />
              <FieldValue label="可写状态" value={status?.writable ? '可写' : '不可写或未知'} />
            </dl>
            {status?.error ? <p className="reference-error-text">{status.error}</p> : null}
            <div className="reference-actions">
              <button type="button" onClick={onPickDataDir} disabled={busy}>选择数据目录</button>
            </div>
          </article>
        </div>
      ))}

      {renderPanel('backend', (
        <div className="reference-settings-stack">
          <article className="reference-panel">
            <h2>后台健康</h2>
            <div className={`reference-status-badge reference-status-${phase}`}>{phase === 'ready' ? 'Backend Ready' : phase === 'failed' ? 'Needs Attention' : 'Starting'}</div>
            <pre>{JSON.stringify(health, null, 2) || '后台连接中'}</pre>
            <div className="reference-actions">
              <button type="button" onClick={onRestartBackend} disabled={busy}>重启后台</button>
            </div>
          </article>
        </div>
      ))}

      {renderPanel('example', (
        <div className="reference-settings-stack">
          <article className="reference-panel">
            <h2>示例设置</h2>
            <label className="reference-field">
              <span>message</span>
              <input value={message} onChange={event => onMessageChange(event.target.value)} />
            </label>
            <div className="reference-actions">
              <button type="button" onClick={onSaveSettings} disabled={!client || busy}>保存设置</button>
            </div>
            <p className="reference-muted">最后保存：{settings?.updatedAt || '尚未保存'}</p>
          </article>
        </div>
      ))}

      {renderPanel('components', (
        <div className="reference-settings-stack">
          <article className="reference-panel">
            <h2>自绘组件</h2>
            <p className="reference-muted">无轨道滑动条：只绘制可拖动游标，不绘制传统轨道。</p>
            <TracklessSlider
              label="示范强度"
              min={0}
              max={100}
              step={1}
              value={sliderDemoValue}
              onChange={setSliderDemoValue}
              formatValue={value => `${value}%`}
            />
          </article>
        </div>
      ))}

      {error ? <div className="reference-error-card" role="alert">{error}</div> : null}
    </section>
  )
}
