import * as React from 'react'
import { TextField } from '@mui/material'

export type AddTaskInputProps = {
  onAdd: (title: string) => void
  onCancel: () => void
}

export const AddTaskInput = React.memo(function AddTaskInput(props: AddTaskInputProps) {
  const { onAdd, onCancel } = props
  const [title, setTitle] = React.useState('')

  const submit = React.useCallback(() => {
    const next = title.trim()
    if (!next) return
    onAdd(next)
    setTitle('')
  }, [onAdd, title])

  return (
    <TextField
      autoFocus
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          submit()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setTitle('')
          onCancel()
        }
      }}
      placeholder="添加任务..."
      size="small"
      fullWidth
      sx={{
        '& .MuiInputBase-root': { fontSize: 14 },
      }}
    />
  )
})

