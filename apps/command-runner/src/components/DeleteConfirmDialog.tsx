import { ConfirmDialog } from './ConfirmDialog'

type DeleteConfirmDialogProps = {
  title: string
  message: string
  disabled?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

// DeleteConfirmDialog 是「删除」场景对通用确认原语的封装：红色确认按钮与删除文案。
export function DeleteConfirmDialog({ title, message, disabled = false, onConfirm, onClose }: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      title={title}
      message={message}
      confirmLabel="确认删除"
      pendingLabel="删除中"
      confirmColor="error"
      disabled={disabled}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
