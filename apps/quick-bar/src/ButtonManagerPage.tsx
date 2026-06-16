import * as React from 'react'
import { CircleOff, PencilLine, Plus, Power, Save, Trash2, X } from 'lucide-react'
import { fetchRegistryButtons, removeRegistryButton, updateRegistryButton } from './registryClient'
import type { DirectClient, RegistryButton } from './types'
import { ButtonIconPicker } from './ButtonIconPicker'
import { ButtonIconGlyph, randomButtonIconId, resolveButtonIconId } from './buttonIcons'
import { QuickActionButton } from './QuickActionButton'

type ButtonManagerPageProps = {
  client: DirectClient
  onOpenCapabilities: () => void
}

type ButtonBusyAction = 'rename' | 'icon' | 'toggle' | 'delete'

type ButtonBusyState = {
  id: string
  action: ButtonBusyAction
} | null

export function ButtonManagerPage({ client, onOpenCapabilities }: ButtonManagerPageProps) {
  const [buttons, setButtons] = React.useState<RegistryButton[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<ButtonBusyState>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = React.useState<string | null>(null)
  const [titleDrafts, setTitleDrafts] = React.useState<Record<string, string>>({})
  const [iconDrafts, setIconDrafts] = React.useState<Record<string, string>>({})
  const [editingIconButton, setEditingIconButton] = React.useState<RegistryButton | null>(null)

  const refresh = React.useCallback(async () => {
    setError(null)
    setConfirmingDeleteId(null)
    try {
      const list = await fetchRegistryButtons(client)
      setButtons(list)
      setTitleDrafts(titleDraftsFromButtons(list))
      setIconDrafts(iconDraftsFromButtons(list))
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
        if (!cancelled) {
          setButtons(list)
          setTitleDrafts(titleDraftsFromButtons(list))
          setIconDrafts(iconDraftsFromButtons(list))
        }
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
    setTitleDrafts(current => ({ ...current, [nextButton.id]: nextButton.title }))
    setIconDrafts(current => ({ ...current, [nextButton.id]: nextButton.icon }))
  }, [])

  const updateTitleDraft = React.useCallback((button: RegistryButton, value: string) => {
    setTitleDrafts(current => ({ ...current, [button.id]: value }))
  }, [])

  const updateIconDraft = React.useCallback((button: RegistryButton, value: string) => {
    setIconDrafts(current => ({ ...current, [button.id]: value }))
  }, [])

  const renameButton = React.useCallback(async (button: RegistryButton) => {
    const nextTitle = (titleDrafts[button.id] ?? button.title).trim()
    if (!nextTitle) {
      setError('按钮名称不能为空')
      return
    }
    if (nextTitle === button.title) return
    setBusy({ id: button.id, action: 'rename' })
    setError(null)
    setConfirmingDeleteId(null)
    try {
      replaceButton(await updateRegistryButton(client, { id: button.id, title: nextTitle }))
    } catch (e) {
      setError(errorMessage(e, '修改按钮名称失败'))
    } finally {
      setBusy(null)
    }
  }, [client, replaceButton, titleDrafts])

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
      setTitleDrafts(current => {
        const next = { ...current }
        delete next[button.id]
        return next
      })
      setIconDrafts(current => {
        const next = { ...current }
        delete next[button.id]
        return next
      })
      setConfirmingDeleteId(null)
    } catch (e) {
      setError(errorMessage(e, '删除按钮失败'))
    } finally {
      setBusy(null)
    }
  }, [client])

  const editIconButton = React.useCallback((button: RegistryButton) => {
    setEditingIconButton(button)
    setConfirmingDeleteId(null)
  }, [])

  const saveIconButton = React.useCallback(async () => {
    if (!editingIconButton) return
    setBusy({ id: editingIconButton.id, action: 'icon' })
    setError(null)
    try {
      replaceButton(await updateRegistryButton(client, {
        id: editingIconButton.id,
        icon: resolveButtonIconId(iconDrafts[editingIconButton.id] ?? editingIconButton.icon, editingIconButton.id),
      }))
      setEditingIconButton(null)
    } catch (e) {
      setError(errorMessage(e, '修改按钮图标失败'))
    } finally {
      setBusy(null)
    }
  }, [client, editingIconButton, iconDrafts, replaceButton])

  return (
    <section className="quickbar-button-manager" aria-label="已注册按钮管理">
      {error ? <div className="quickbar-error-card" role="alert">{error}</div> : null}

      {editingIconButton ? (
        <div className="quickbar-capability-modal-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setEditingIconButton(null)
        }}>
          <section className="quickbar-capability-modal quickbar-button-icon-modal" role="dialog" aria-modal="true" aria-label="按钮图标编辑">
            <header className="quickbar-capability-modal-header">
              <div>
                <h3>编辑按钮图标</h3>
                <p>{editingIconButton.title}</p>
              </div>
              <button type="button" className="quickbar-modal-close-button" onClick={() => setEditingIconButton(null)} aria-label="关闭图标编辑">
                <X size={18} />
              </button>
            </header>
            <div className="quickbar-capability-modal-body quickbar-button-icon-modal-body">
              <ButtonIconPicker
                title="选择图标"
                description="按钮条里只显示图标，鼠标放上去才显示按钮名字。"
                seed={editingIconButton.id}
                value={iconDrafts[editingIconButton.id] ?? editingIconButton.icon}
                onPick={iconId => updateIconDraft(editingIconButton, iconId)}
                onRandom={() => updateIconDraft(editingIconButton, randomButtonIconId(iconDrafts[editingIconButton.id] ?? editingIconButton.icon))}
              />
              <div className="quickbar-button-icon-modal-actions">
                <QuickActionButton variant="ghost" icon={<X size={15} />} onClick={() => setEditingIconButton(null)} disabled={busy !== null}>取消</QuickActionButton>
                <QuickActionButton variant="primary" icon={<Save size={15} />} onClick={() => void saveIconButton()} disabled={busy !== null}>保存图标</QuickActionButton>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {!buttons ? (
        <article className="quickbar-panel quickbar-empty-panel">读取中...</article>
      ) : buttons.length === 0 ? (
        <article className="quickbar-panel quickbar-empty-panel">
          <h3>还没有已注册按钮</h3>
          <p>先到能力浏览页选择一个能力，把它注册成 Quick Bar 按钮。</p>
          <QuickActionButton variant="primary" icon={<Plus size={15} />} onClick={onOpenCapabilities}>去能力浏览注册</QuickActionButton>
        </article>
      ) : (
        <div className="quickbar-button-list">
          {buttons.map(button => (
            <ButtonCard
              key={button.id}
              button={button}
              busy={busy?.id === button.id ? busy.action : null}
              confirmingDelete={confirmingDeleteId === button.id}
              titleDraft={titleDrafts[button.id] ?? button.title}
              onTitleDraftChange={value => updateTitleDraft(button, value)}
              onRename={() => void renameButton(button)}
              onToggle={() => void toggleButton(button)}
              onAskDelete={() => setConfirmingDeleteId(button.id)}
              onCancelDelete={() => setConfirmingDeleteId(null)}
              onConfirmDelete={() => void deleteButton(button)}
              onEditIcon={() => editIconButton(button)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ButtonCard(props: {
  button: RegistryButton
  busy: ButtonBusyAction | null
  confirmingDelete: boolean
  titleDraft: string
  onTitleDraftChange: (value: string) => void
  onRename: () => void
  onToggle: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onEditIcon: () => void
}) {
  const { button, busy, confirmingDelete, titleDraft, onTitleDraftChange, onRename, onToggle, onAskDelete, onCancelDelete, onConfirmDelete, onEditIcon } = props
  const enabled = button.enabled !== false
  const titleChanged = titleDraft.trim() !== button.title

  return (
    <article className={`quickbar-button-card${enabled ? '' : ' quickbar-button-card-disabled'}`}>
      <div className="quickbar-button-card-main">
        <div className="quickbar-button-card-title-block">
          <div className="quickbar-button-card-title-row">
            <span className="quickbar-button-card-icon-surface">
              <ButtonIconGlyph className="quickbar-button-card-icon" iconId={button.icon} seed={button.id} size={22} />
            </span>
            <span className="quickbar-button-card-title">{button.title}</span>
          </div>
          <p className="quickbar-button-card-meta">来源：{appName(button)} / {button.capabilityId}</p>
          <p className="quickbar-button-card-meta">注册时间：{formatCreatedAt(button.createdAt)}</p>
        </div>
        <span className={`quickbar-button-status ${enabled ? 'quickbar-button-status-enabled' : 'quickbar-button-status-disabled'}`}>
          {enabled ? '正在显示' : '已停用'}
        </span>
      </div>

      <div className="quickbar-button-title-edit">
        <label>
          <span>按钮名称</span>
          <input value={titleDraft} onChange={event => onTitleDraftChange(event.target.value)} />
        </label>
        <QuickActionButton variant="primary" compact icon={<Save size={15} />} onClick={onRename} disabled={busy !== null || !titleChanged}>
          {busy === 'rename' ? '保存中...' : '保存名称'}
        </QuickActionButton>
      </div>

      <div className="quickbar-button-card-actions">
        <QuickActionButton variant={enabled ? 'subtle' : 'primary'} compact icon={enabled ? <CircleOff size={15} /> : <Power size={15} />} aria-pressed={enabled} onClick={onToggle} disabled={busy !== null}>
          {busy === 'toggle' ? '处理中...' : enabled ? '停用' : '启用'}
        </QuickActionButton>
        <QuickActionButton variant="secondary" compact icon={<PencilLine size={15} />} onClick={onEditIcon} disabled={busy !== null}>{busy === 'icon' ? '保存图标中...' : '编辑图标'}</QuickActionButton>
        {confirmingDelete ? (
          <div className="quickbar-button-delete-confirm" role="group" aria-label="确认删除按钮">
            <span>确认删除？</span>
            <QuickActionButton variant="danger" compact icon={<Trash2 size={15} />} onClick={onConfirmDelete} disabled={busy !== null}>
              {busy === 'delete' ? '删除中...' : '确认'}
            </QuickActionButton>
            <QuickActionButton variant="ghost" compact icon={<X size={15} />} onClick={onCancelDelete} disabled={busy !== null}>取消</QuickActionButton>
          </div>
        ) : (
          <QuickActionButton variant="danger" compact icon={<Trash2 size={15} />} onClick={onAskDelete} disabled={busy !== null}>删除</QuickActionButton>
        )}
      </div>
    </article>
  )
}

function titleDraftsFromButtons(buttons: RegistryButton[]): Record<string, string> {
  return Object.fromEntries(buttons.map(button => [button.id, button.title]))
}

function iconDraftsFromButtons(buttons: RegistryButton[]): Record<string, string> {
  return Object.fromEntries(buttons.map(button => [button.id, button.icon]))
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
