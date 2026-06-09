import * as React from 'react'
import type { ConnectionSettings, DataDirStatus } from '../types'

type BackendPhase = 'starting' | 'ready' | 'failed'

type SettingsViewProps = {
  status: DataDirStatus | null
  connection: ConnectionSettings | null
  phase: BackendPhase
  busy: boolean
  serverBaseUrl: string
  serverKeyInput: string
  onServerBaseUrlChange: (value: string) => void
  onServerKeyInputChange: (value: string) => void
  onSaveConnection: () => Promise<void> | void
  onClearConnection: () => Promise<void> | void
  onPickDataDir: () => Promise<void> | void
  onRestartBackend: () => Promise<void> | void
  onOpenArchive: () => void
  onOpenTrash: () => void
}

export function SettingsView(props: SettingsViewProps) {
  const {
    status,
    connection,
    phase,
    busy,
    serverBaseUrl,
    serverKeyInput,
    onServerBaseUrlChange,
    onServerKeyInputChange,
    onSaveConnection,
    onClearConnection,
    onPickDataDir,
    onRestartBackend,
    onOpenArchive,
    onOpenTrash,
  } = props

  return (
    <div className="kc-settings" aria-label="知识中心连接设置">
      <div className="kc-settings-grid">
        <article className="kc-card">
          <h2>服务器</h2>
          <label className="kc-field">
            <span>服务器地址</span>
            <input value={serverBaseUrl} onChange={event => onServerBaseUrlChange(event.target.value)} placeholder={connection?.defaultServerBaseUrl || 'http://127.0.0.1:17321'} />
          </label>
          <label className="kc-field">
            <span>访问钥匙</span>
            <input value={serverKeyInput} onChange={event => onServerKeyInputChange(event.target.value)} type="password" placeholder={connection?.hasServerKey ? '已保存，留空表示继续使用原钥匙' : '粘贴服务器访问钥匙'} />
          </label>
          <div className="kc-actions">
            <button type="button" onClick={onSaveConnection} disabled={busy}>保存并连接</button>
            <button type="button" onClick={onClearConnection} disabled={busy}>清空连接</button>
          </div>
          <p className="kc-muted">当前状态：{connection?.hasServerKey ? '访问钥匙已保存' : '访问钥匙未配置'}</p>
        </article>

        <article className="kc-card">
          <h2>客户端本地状态</h2>
          <dl className="kc-facts">
            <dt>本地后台</dt>
            <dd>{phase === 'ready' ? '已就绪' : phase === 'failed' ? '需要处理' : '启动中'}</dd>
            <dt>客户端数据目录</dt>
            <dd>{status?.dataDir || '读取中'}</dd>
            <dt>默认数据目录</dt>
            <dd>{status?.defaultDataDir || '读取中'}</dd>
            <dt>可写状态</dt>
            <dd>{status?.writable ? '可写' : '不可写或未知'}</dd>
          </dl>
          {status?.error ? <p className="kc-danger-text">{status.error}</p> : null}
          <div className="kc-actions">
            <button type="button" onClick={onPickDataDir} disabled={busy}>选择客户端数据目录</button>
            <button type="button" onClick={onRestartBackend} disabled={busy}>重启本地后台</button>
          </div>
        </article>

        <article className="kc-card">
          <h2>资料维护入口</h2>
          <p className="kc-muted">归档和回收站不混入全部笔记，需要时从这里单独进入。</p>
          <div className="kc-actions">
            <button type="button" onClick={onOpenArchive}>查看归档</button>
            <button type="button" onClick={onOpenTrash}>查看回收站</button>
          </div>
        </article>
      </div>
    </div>
  )
}
