import * as React from 'react'
import type { ExternalAccessKey, ExternalAccessState } from '../types'

const MIN_ACCESS_PORT = 1
const MAX_ACCESS_PORT = 65535
const MASKED_KEY_TEXT = '••••••••••••••••'

type ExternalAccessPanelProps = {
  access: ExternalAccessState | null
  error: string | null
  clientReady: boolean
  onSavePort: (port: number) => Promise<void>
  onCreateKey: (name: string) => Promise<void>
  onUpdateKey: (key: string, name: string) => Promise<void>
  onDeleteKey: (key: string) => Promise<void>
  onCopyText: (text: string) => void
}

function formatDateTime(ms: number): string {
  if (!(Number(ms) > 0)) return ''
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 外部访问管理：配置开放端口并管理访问密钥；每把密钥可独立改名、复制与删除。
// 界面只与本应用后台通信（WebSocket RPC），对外 HTTP 服务由后台提供。
export function ExternalAccessPanel(props: ExternalAccessPanelProps) {
  const { access, error, clientReady, onSavePort, onCreateKey, onUpdateKey, onDeleteKey, onCopyText } = props
  const [portText, setPortText] = React.useState('')
  const [portBusy, setPortBusy] = React.useState(false)
  const [portError, setPortError] = React.useState<string | null>(null)
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({})
  const [createName, setCreateName] = React.useState('')
  const [createBusy, setCreateBusy] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [editTarget, setEditTarget] = React.useState<ExternalAccessKey | null>(null)
  const [editName, setEditName] = React.useState('')
  const [editBusy, setEditBusy] = React.useState(false)
  const [editError, setEditError] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<ExternalAccessKey | null>(null)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const port = access?.port || 0
  const keys = access?.keys || []
  const actionsDisabled = !clientReady || portBusy

  React.useEffect(() => {
    setPortText(access && access.port > 0 ? String(access.port) : '')
  }, [access?.port])

  const savePort = React.useCallback(async () => {
    if (portBusy) return
    const port = Number(String(portText).trim())
    if (!Number.isInteger(port) || port < MIN_ACCESS_PORT || port > MAX_ACCESS_PORT) {
      setPortError(`端口必须是 ${MIN_ACCESS_PORT} 到 ${MAX_ACCESS_PORT} 之间的整数`)
      return
    }
    setPortBusy(true)
    setPortError(null)
    try {
      await onSavePort(port)
    } catch (e) {
      setPortError(String((e as { message?: string })?.message || e || '保存端口失败'))
    } finally {
      setPortBusy(false)
    }
  }, [onSavePort, portBusy, portText])

  const submitCreate = React.useCallback(async () => {
    if (createBusy) return
    const name = createName.trim()
    if (!name) {
      setCreateError('名称不能为空')
      return
    }
    setCreateBusy(true)
    setCreateError(null)
    try {
      await onCreateKey(name)
      setCreateName('')
    } catch (e) {
      setCreateError(String((e as { message?: string })?.message || e || '创建访问密钥失败'))
    } finally {
      setCreateBusy(false)
    }
  }, [createBusy, createName, onCreateKey])

  const openEdit = React.useCallback((entry: ExternalAccessKey) => {
    setEditTarget(entry)
    setEditName(entry.name)
    setEditError(null)
  }, [])

  const submitEdit = React.useCallback(async () => {
    const target = editTarget
    if (!target || editBusy) return
    const name = editName.trim()
    if (!name) {
      setEditError('名称不能为空')
      return
    }
    setEditBusy(true)
    setEditError(null)
    try {
      await onUpdateKey(target.key, name)
      setEditTarget(null)
    } catch (e) {
      setEditError(String((e as { message?: string })?.message || e || '保存访问密钥失败'))
    } finally {
      setEditBusy(false)
    }
  }, [editBusy, editName, editTarget, onUpdateKey])

  const confirmDelete = React.useCallback(async () => {
    const target = deleteTarget
    if (!target || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await onDeleteKey(target.key)
      setDeleteTarget(null)
    } catch (e) {
      setDeleteError(String((e as { message?: string })?.message || e || '删除访问密钥失败'))
    } finally {
      setDeleteBusy(false)
    }
  }, [deleteBusy, deleteTarget, onDeleteKey])

  const toggleReveal = React.useCallback((key: string) => {
    setRevealed(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return (
    <div className="everything-settings-stack">
      <article className="everything-panel">
        <h2>外部访问管理</h2>
        <p className="everything-muted">
          为外部工具开放访问入口：配置开放端口并创建访问密钥。外部工具凭「访问地址 + 访问钥匙」只能调用本应用的只读搜索接口；密钥管理与其他动作一律不对外开放。
        </p>
        {error ? <p className="everything-error-text">{error}</p> : null}

        <div className="everything-access-section">
          <strong className="everything-access-section-title">开放端口</strong>
          <div className="everything-access-port-row">
            <input
              className="everything-access-port-input"
              type="number"
              min={MIN_ACCESS_PORT}
              max={MAX_ACCESS_PORT}
              step={1}
              placeholder={`${MIN_ACCESS_PORT} ~ ${MAX_ACCESS_PORT}`}
              value={portText}
              disabled={!clientReady || portBusy}
              onChange={event => setPortText(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void savePort()
              }}
            />
            <button type="button" className="everything-secondary-button" onClick={() => void savePort()} disabled={actionsDisabled}>
              {portBusy ? '保存中…' : '保存端口'}
            </button>
          </div>
          {portError ? <p className="everything-error-text">{portError}</p> : null}
        </div>

        <div className="everything-access-section">
          <strong className="everything-access-section-title">访问地址</strong>
          <code className="everything-access-endpoint">
            {port > 0 ? `http://127.0.0.1:${port}` : '尚未配置开放端口'}
          </code>
        </div>

        <div className="everything-access-section">
          <strong className="everything-access-section-title">访问密钥</strong>
          <div className="everything-access-create-row">
            <input
              className="everything-access-name-input"
              type="text"
              placeholder="新密钥名称"
              value={createName}
              disabled={!clientReady || createBusy}
              onChange={event => setCreateName(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void submitCreate()
              }}
            />
            <button
              type="button"
              className="everything-secondary-button"
              onClick={() => void submitCreate()}
              disabled={!clientReady || createBusy || !createName.trim()}
            >
              {createBusy ? '创建中…' : '新增密钥'}
            </button>
          </div>
          {createError ? <p className="everything-error-text">{createError}</p> : null}

          {keys.length === 0 ? (
            <p className="everything-muted">尚未创建访问密钥。</p>
          ) : (
            <ul className="everything-access-key-list">
              {keys.map(entry => {
                const show = !!revealed[entry.key]
                return (
                  <li key={entry.key} className="everything-access-key-item">
                    <div className="everything-access-key-main">
                      <span className="everything-access-key-name">{entry.name || '未命名密钥'}</span>
                      <code className="everything-access-key-value">{show ? entry.key : MASKED_KEY_TEXT}</code>
                      <span className="everything-access-key-meta">创建于 {formatDateTime(entry.createdAtMs) || '未知'}</span>
                    </div>
                    <div className="everything-access-key-actions">
                      <button type="button" onClick={() => toggleReveal(entry.key)} aria-label={`切换密钥显示 ${entry.name}`}>
                        {show ? '隐藏' : '显示'}
                      </button>
                      <button type="button" onClick={() => onCopyText(entry.key)} aria-label={`复制密钥 ${entry.name}`}>复制</button>
                      <button type="button" onClick={() => openEdit(entry)} aria-label={`编辑密钥 ${entry.name}`}>编辑</button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null)
                          setDeleteTarget(entry)
                        }}
                        aria-label={`删除密钥 ${entry.name}`}
                      >
                        删除
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </article>

      {editTarget ? (
        <div className="everything-access-inline-dialog" role="dialog" aria-label="编辑访问密钥">
          <strong>编辑访问密钥</strong>
          <input
            className="everything-access-name-input"
            type="text"
            value={editName}
            disabled={editBusy}
            onChange={event => setEditName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void submitEdit()
            }}
          />
          <p className="everything-muted">密钥本体与创建时间保持不变。</p>
          {editError ? <p className="everything-error-text">{editError}</p> : null}
          <div className="everything-actions">
            <button type="button" onClick={() => setEditTarget(null)} disabled={editBusy}>取消</button>
            <button type="button" className="everything-primary-button" onClick={() => void submitEdit()} disabled={editBusy || !editName.trim()}>
              {editBusy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="everything-access-inline-dialog" role="dialog" aria-label="删除访问密钥">
          <strong>删除访问密钥</strong>
          <p className="everything-muted">确定删除密钥「{deleteTarget.name || '未命名密钥'}」吗？删除后不可恢复。</p>
          {deleteError ? <p className="everything-error-text">{deleteError}</p> : null}
          <div className="everything-actions">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>取消</button>
            <button type="button" className="everything-access-danger-button" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              {deleteBusy ? '删除中…' : '删除'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
