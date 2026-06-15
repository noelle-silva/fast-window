import * as React from 'react'
import { fetchRegistryButtons, removeRegistryButton, updateRegistryButton } from './registryClient'
import type { DirectClient, RegistryButton } from './types'

type ButtonManagerPageProps = {
  client: DirectClient
  onOpenCapabilities: () => void
}

type ButtonBusyAction = 'toggle' | 'delete'

type ButtonBusyState = {
  id: string
  action: ButtonBusyAction
} | null

export function ButtonManagerPage({ client, onOpenCapabilities }: ButtonManagerPageProps) {
  const [buttons, setButtons] = React.useState<RegistryButton[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<ButtonBusyState>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setError(null)
    setConfirmingDeleteId(null)
    try {
      setButtons(await fetchRegistryButtons(client))
    } catch (e) {
      setError(errorMessage(e, '读取按钮列表失败'))
    }
  }, [client])

  React.useEffect(() => {
    let cancelled = false
    setError(null)
    setConfirmingDeleteId(null)
    void fetchRegistryButtons(client)
      .then(list => {
        if (!cancelled) setButtons(list)
      })
      .catch(e => {
        if (!cancelled) setError(errorMessage(e, '读取按钮列表失败'))
      })
    return () => {
      cancelled = true
    }
  }, [client])

  const replaceButton = React.useCallback((nextButton: RegistryButton) => {
    setButtons(current => current?.map(button => button.id === nextButton.id ? nextButton : button) ?? current)
  }, [])

  const toggleButton = React.useCallback(async (button: RegistryButton) => {
    const nextEnabled = button.enabled === false
    setBusy({ id: button.id, action: 'toggle' })
    setError(null)
    setConfirmingDeleteId(null)
    try {
      replaceButton(await updateRegistryButton(client, { id: button.id, enabled: nextEnabled }))
    } catch (e) {
      setError(errorMessage(e, nextEnabled ? '启用按钮失败' : '停用按钮失败'))
    } finally {
      setBusy(null)
    }
  }, [client, replaceButton])

  const deleteButton = React.useCallback(async (button: RegistryButton) => {
    setBusy({ id: button.id, action: 'delete' })
    setError(null)
    setConfirmingDeleteId(null)
    try {
      await removeRegistryButton(client, button.id)
      setButtons(current => current?.filter(item => item.id !== button.id) ?? current)
      setConfirmingDeleteId(null)
    } catch (e) {
      setError(errorMessage(e, '删除按钮失败'))
    } finally {
      setBusy(null)
    }
  }, [client])

  const stats = buttons ? buttonStats(buttons) : null

  return (
    <section className="quickbar-button-manager" aria-label="已注册按钮管理">
      <header className="quickbar-button-manager-header">
        <div>
          <p className="quickbar-eyebrow">Quick Bar Buttons</p>
          <h2>已注册按钮管理</h2>
          <p>这里只管理你已经注册到 Quick Bar 浮动条里的按钮。停用会让按钮暂时不出现在划词浮动条中，删除会移除这条按钮记录。</p>
        </div>
        <div className="quickbar-button-manager-actions">
          <button type="button" onClick={() => void refresh()}>刷新列表</button>
          <button type="button" onClick={onOpenCapabilities}>注册新按钮</button>
        </div>
      </header>

      {stats ? (
        <div className="quickbar-button-manager-stats" aria-label="按钮统计">
          <ButtonStat label="全部按钮" value={stats.total} />
          <ButtonStat label="正在显示" value={stats.enabled} tone="ready" />
          <ButtonStat label="已停用" value={stats.disabled} tone="muted" />
        </div>
      ) : null}

      {error ? <div className="quickbar-error-card" role="alert">{error}</div> : null}

      {!buttons ? (
        <article className="quickbar-panel quickbar-empty-panel">读取中...</article>
      ) : buttons.length === 0 ? (
        <article className="quickbar-panel quickbar-empty-panel">
          <h3>还没有已注册按钮</h3>
          <p>先到能力浏览页选择一个能力，把它注册成 Quick Bar 按钮。</p>
          <div className="quickbar-button-manager-actions">
            <button type="button" onClick={onOpenCapabilities}>去能力浏览注册</button>
          </div>
        </article>
      ) : (
        <div className="quickbar-button-list">
          {buttons.map(button => (
            <ButtonCard
              key={button.id}
              button={button}
              busy={busy?.id === button.id ? busy.action : null}
              confirmingDelete={confirmingDeleteId === button.id}
              onToggle={() => void toggleButton(button)}
              onAskDelete={() => setConfirmingDeleteId(button.id)}
              onCancelDelete={() => setConfirmingDeleteId(null)}
              onConfirmDelete={() => void deleteButton(button)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ButtonStat({ label, value, tone }: { label: string; value: number; tone?: 'ready' | 'muted' }) {
  return (
    <article className={`quickbar-button-stat-card${tone ? ` quickbar-button-stat-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function ButtonCard(props: {
  button: RegistryButton
  busy: ButtonBusyAction | null
  confirmingDelete: boolean
  onToggle: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}) {
  const { button, busy, confirmingDelete, onToggle, onAskDelete, onCancelDelete, onConfirmDelete } = props
  const enabled = button.enabled !== false

  return (
    <article className={`quickbar-button-card${enabled ? '' : ' quickbar-button-card-disabled'}`}>
      <div className="quickbar-button-card-main">
        <div>
          <span className="quickbar-button-card-title">{button.title}</span>
          <p className="quickbar-button-card-meta">来源：{appName(button)} / {button.capabilityId}</p>
          <p className="quickbar-button-card-meta">注册时间：{formatCreatedAt(button.createdAt)}</p>
        </div>
        <span className={`quickbar-button-status ${enabled ? 'quickbar-button-status-enabled' : 'quickbar-button-status-disabled'}`}>
          {enabled ? '正在显示' : '已停用'}
        </span>
      </div>

      <div className="quickbar-button-card-actions">
        <button type="button" aria-pressed={enabled} onClick={onToggle} disabled={busy !== null}>
          {busy === 'toggle' ? '处理中...' : enabled ? '停用' : '启用'}
        </button>
        {confirmingDelete ? (
          <div className="quickbar-button-delete-confirm" role="group" aria-label="确认删除按钮">
            <span>确认删除？</span>
            <button type="button" className="quickbar-button-danger" onClick={onConfirmDelete} disabled={busy !== null}>
              {busy === 'delete' ? '删除中...' : '确认'}
            </button>
            <button type="button" onClick={onCancelDelete} disabled={busy !== null}>取消</button>
          </div>
        ) : (
          <button type="button" className="quickbar-button-danger" onClick={onAskDelete} disabled={busy !== null}>删除</button>
        )}
      </div>
    </article>
  )
}

function buttonStats(buttons: RegistryButton[]) {
  const enabled = buttons.filter(button => button.enabled !== false).length
  return {
    total: buttons.length,
    enabled,
    disabled: buttons.length - enabled,
  }
}

function appName(button: RegistryButton): string {
  const name = button.app.name
  return typeof name === 'string' && name.trim() ? name : button.appId
}

function formatCreatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知'
  return date.toLocaleString()
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}
