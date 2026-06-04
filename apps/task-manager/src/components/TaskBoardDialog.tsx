import { DialogShell } from './DialogShell'
import type { TaskBoard, TaskDraft } from '../types'

type TaskBoardDialogProps = {
  board: TaskBoard
  onCreateTask: () => void
  onPasteTask: (draft: TaskDraft) => void
  onClose: () => void
}

export function TaskBoardDialog({ board, onCreateTask, onPasteTask, onClose }: TaskBoardDialogProps) {
  return (
    <DialogShell
      title={board.title}
      subtitle={board.description || '在这里记录一行一个任务。直接 Ctrl+V 可从剪贴板新建条目。'}
      onClose={onClose}
      action={<button type="button" className="tm-icon-button tm-dialog-add" aria-label="新增任务" onClick={onCreateTask}>+</button>}
    >
      <div className="tm-task-panel" tabIndex={0} onPaste={event => {
        const text = event.clipboardData.getData('text').trim()
        if (!text) return
        event.preventDefault()
        const [title, ...rest] = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        onPasteTask({ title, description: rest.join('\n') })
      }}>
        {board.tasks.length ? (
          <div className="tm-task-list">
            {board.tasks.map((task, index) => (
              <article className="tm-task-row" key={task.id}>
                <span className="tm-task-index">{index + 1}</span>
                <div>
                  <h3>{task.title}</h3>
                  {task.description ? <p>{task.description}</p> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="tm-empty-state">
            <strong>还没有任务</strong>
            <span>点右上角加号，或者直接 Ctrl+V 粘贴文字。</span>
          </div>
        )}
      </div>
    </DialogShell>
  )
}
