import * as React from 'react'
import { SettingsTabs, type SettingsTabItem } from './components/SettingsTabs'
import { fetchRegistryButtons } from './registryClient'
import type { DataDirStatus, DirectClient, FwLaunchInfo, RegistryButton, ShortcutStatus } from './types'

export type SettingsTab = 'overview' | 'shortcut' | 'toolbar' | 'data' | 'backend'

const SETTINGS_TABS: Array<SettingsTabItem<SettingsTab>> = [
  { id: 'overview', label: '概览' },
  { id: 'shortcut', label: '快捷键' },
  { id: 'toolbar', label: '浮动条' },
  { id: 'data', label: '数据' },
  { id: 'backend', label: '后台' },
]

type SettingsPageProps = {
  launchInfo: FwLaunchInfo
  initialCommand: string | null
  runtimeCommand: string | null
  status: DataDirStatus | null
  shortcutStatus: ShortcutStatus | null
  health: Record<string, unknown> | null
  activeTab: SettingsTab
  phase: 'starting' | 'ready' | 'failed'
  busy: boolean
  error: string | null
  onTabChange: (tab: SettingsTab) => void
  onShortcutChange: (shortcut: string) => Promise<void> | void
  onPickDataDir: () => Promise<void> | void
  onRestartBackend: () => Promise<void> | void
  client: DirectClient | null
}

function FieldValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function phaseText(phase: SettingsPageProps['phase']) {
  if (phase === 'ready') return '后台可用'
  if (phase === 'failed') return '需要处理'
  return '启动中'
}

export function SettingsPage(props: SettingsPageProps) {
  const {
    launchInfo,
    initialCommand,
    runtimeCommand,
    status,
    shortcutStatus,
    health,
    activeTab,
    phase,
    busy,
    error,
    onTabChange,
    onShortcutChange,
    onPickDataDir,
    onRestartBackend,
    client,
  } = props

  const renderPanel = (tab: SettingsTab, content: React.ReactNode) => (
    <div
      role="tabpanel"
      hidden={activeTab !== tab}
      id={`quickbar-settings-panel-${tab}`}
      aria-labelledby={`quickbar-settings-tab-${tab}`}
      className="quickbar-settings-panel"
    >
      {activeTab === tab ? content : null}
    </div>
  )

  return (
    <section className="quickbar-settings-page" aria-label="Quick Bar 设置">
      <SettingsTabs items={SETTINGS_TABS} value={activeTab} onChange={onTabChange} ariaLabel="设置分类" />

      {renderPanel('overview', (
        <div className="quickbar-settings-stack">
          <article className="quickbar-panel quickbar-intro-panel">
            <h2>当前目标</h2>
            <p>Quick Bar 第一阶段专注一件事：选中文字后，用应用自己保存的快捷键在选区附近显示轻量浮动条。</p>
          </article>
          <article className="quickbar-panel">
            <h2>启动信息</h2>
            <dl>
              <FieldValue label="启动来源" value={launchInfo.launched ? '平台唤起' : '独立启动'} />
              <FieldValue label="窗口模式" value={launchInfo.mode} />
              <FieldValue label="初始命令" value={initialCommand || '无'} />
              <FieldValue label="运行中命令" value={runtimeCommand || '无'} />
            </dl>
          </article>
        </div>
      ))}

      {renderPanel('shortcut', (
        <div className="quickbar-settings-stack">
          <ShortcutRecorder
            status={shortcutStatus}
            busy={busy}
            onShortcutChange={onShortcutChange}
          />
        </div>
      ))}

      {renderPanel('toolbar', (
        <div className="quickbar-settings-stack">
          <RegistryButtonsPane client={client} />
          {client ? (
            <article className="quickbar-panel">
              <h2>已注册按钮</h2>
              <p className="quickbar-muted">以下为当前已注册到 Quick Bar 悬浮栏的能力按钮。从能力浏览页面选取并注册新按钮。</p>
              <RegistryButtonList client={client} />
            </article>
          ) : (
            <article className="quickbar-panel">
              <h2>已注册按钮</h2>
              <p className="quickbar-muted">后台未连接，无法读取已注册按钮。</p>
            </article>
          )}
        </div>
      ))}

      {renderPanel('data', (
        <div className="quickbar-settings-stack">
          <article className="quickbar-panel">
            <h2>数据目录</h2>
            <dl>
              <FieldValue label="当前目录" value={status?.dataDir || '读取中'} />
              <FieldValue label="默认目录" value={status?.defaultDataDir || '读取中'} />
              <FieldValue label="可写状态" value={status?.writable ? '可写' : '不可写或未知'} />
            </dl>
            {status?.error ? <p className="quickbar-error-text">{status.error}</p> : null}
            <div className="quickbar-actions">
              <button type="button" onClick={onPickDataDir} disabled={busy}>选择数据目录</button>
            </div>
          </article>
        </div>
      ))}

      {renderPanel('backend', (
        <div className="quickbar-settings-stack">
          <article className="quickbar-panel">
            <h2>后台健康</h2>
            <div className={`quickbar-status-badge quickbar-status-${phase}`}>{phaseText(phase)}</div>
            <pre>{JSON.stringify(health, null, 2) || '后台连接中'}</pre>
            <div className="quickbar-actions">
              <button type="button" onClick={onRestartBackend} disabled={busy}>重启后台</button>
            </div>
          </article>
        </div>
      ))}

      {error ? <div className="quickbar-error-card" role="alert">{error}</div> : null}
    </section>
  )
}

function ShortcutRecorder(props: {
  status: ShortcutStatus | null
  busy: boolean
  onShortcutChange: (shortcut: string) => Promise<void> | void
}) {
  const { status, busy, onShortcutChange } = props
  const [recording, setRecording] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [localError, setLocalError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        setDraft('')
        setLocalError(null)
        return
      }
      const next = shortcutFromKeyboardEvent(event)
      if (!next) {
        setLocalError('请按下包含 Ctrl、Alt、Shift 或 Super 的组合键')
        return
      }
      setDraft(next)
      setLocalError(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording])

  const current = status?.shortcut || '读取中'
  const enabledText = status?.enabled ? '已启用' : '未启用'
  const error = localError || status?.error || null

  return (
    <article className="quickbar-panel quickbar-shortcut-panel">
      <h2>唤醒快捷键</h2>
      <p className="quickbar-muted">这个快捷键由 Quick Bar 自己保存和监听。先在外部选中文字，再按这个快捷键显示浮动条。</p>
      <div className="quickbar-shortcut-card">
        <div>
          <span>当前快捷键</span>
          <strong>{recording ? (draft || '请按组合键') : current}</strong>
        </div>
        <em className={status?.enabled ? 'quickbar-shortcut-ok' : 'quickbar-shortcut-warn'}>{enabledText}</em>
      </div>
      {error ? <p className="quickbar-error-text">{error}</p> : null}
      <div className="quickbar-actions">
        <button type="button" onClick={() => {
          setRecording(true)
          setDraft('')
          setLocalError(null)
        }} disabled={busy || recording}>开始录制</button>
        <button type="button" onClick={() => {
          if (!draft) {
            setLocalError('请先录制一个快捷键')
            return
          }
          void Promise.resolve(onShortcutChange(draft))
            .then(() => {
              setRecording(false)
              setDraft('')
            })
            .catch(error => setLocalError(String(error?.message || error || '保存快捷键失败')))
        }} disabled={busy || !recording || !draft}>保存快捷键</button>
        {recording ? <button type="button" onClick={() => {
          setRecording(false)
          setDraft('')
          setLocalError(null)
        }}>取消</button> : null}
      </div>
    </article>
  )
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = shortcutKeyName(event)
  if (!key) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('control')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (event.metaKey) parts.push('super')
  if (!parts.length) return null
  parts.push(key)
  return parts.join('+')
}

function shortcutKeyName(event: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code
  const map: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
  }
  return map[event.code] || null
}

function RegistryButtonsPane({ client }: { client: DirectClient | null }) {
  if (!client) return null
  return (
    <article className="quickbar-panel quickbar-intro-panel">
      <h2>浮动条按钮</h2>
      <p>划词悬浮栏中的按钮，来自你从能力浏览页面选取并注册的能力。每个按钮对应一项能力，点击后调用该能力得到结果。</p>
    </article>
  )
}

function RegistryButtonList({ client }: { client: DirectClient }) {
  const [buttons, setButtons] = React.useState<RegistryButton[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void fetchRegistryButtons(client)
      .then(list => { if (!cancelled) setButtons(list) })
      .catch(e => { if (!cancelled) setError(String((e as { message?: string })?.message || e)) })
    return () => { cancelled = true }
  }, [client])

  if (error) return <p className="quickbar-error-text">读取按钮列表失败: {error}</p>
  if (!buttons) return <p className="quickbar-muted">读取中...</p>
  if (!buttons.length) return <p className="quickbar-muted">暂无已注册按钮。前往能力浏览页面选取能力并注册。</p>
  return (
    <div className="quickbar-action-list">
      {buttons.map(button => (
        <div key={button.id} className="quickbar-action-row">
          <span>{button.title}</span>
          <p>来源: {button.appId} / {button.capabilityId}</p>
        </div>
      ))}
    </div>
  )
}
