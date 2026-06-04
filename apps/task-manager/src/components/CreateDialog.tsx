import * as React from 'react'
import { DialogShell } from './DialogShell'
import type { TaskDraft } from '../types'

type CreateDialogProps = {
  title: string
  submitLabel: string
  onSubmit: (draft: TaskDraft) => void
  onClose: () => void
}

export function CreateDialog({ title, submitLabel, onSubmit, onClose }: CreateDialogProps) {
  const [draft, setDraft] = React.useState<TaskDraft>({ title: '', description: '' })
  const canSave = draft.title.trim().length > 0

  const save = React.useCallback(() => {
    if (!canSave) return
    onSubmit(draft)
  }, [canSave, draft, onSubmit])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  return (
    <DialogShell title={title} subtitle="填写标题与描述，按 Ctrl+S 也可以保存。" onClose={onClose}>
      <form className="tm-create-form" onSubmit={event => {
        event.preventDefault()
        save()
      }}>
        <label>
          <span>标题</span>
          <input autoFocus value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} />
        </label>
        <label>
          <span>描述</span>
          <textarea rows={5} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} />
        </label>
        <div className="tm-form-actions">
          <button type="button" className="tm-secondary-button" onClick={onClose}>取消</button>
          <button type="submit" className="tm-primary-button" disabled={!canSave}>{submitLabel}</button>
        </div>
      </form>
    </DialogShell>
  )
}
