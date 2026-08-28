import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'

type Props = {
  open: boolean
  title: string
  description: string
  onClose: () => void
  onConfirm: (next: { title: string; description: string }) => void
}

export function EditEntityInfoDialog(props: Props): React.ReactNode {
  const { open, title, description, onClose, onConfirm } = props

  const [titleDraft, setTitleDraft] = React.useState(title)
  const [descriptionDraft, setDescriptionDraft] = React.useState(description)

  React.useEffect(() => {
    if (!open) return
    setTitleDraft(title)
    setDescriptionDraft(description)
  }, [open, title, description])

  const cannotSave = !String(titleDraft ?? '').trim()

  const confirm = React.useCallback(() => {
    if (cannotSave) return
    onConfirm({ title: titleDraft, description: descriptionDraft })
  }, [cannotSave, descriptionDraft, onConfirm, titleDraft])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>编辑信息</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 3 }}>
          <TextField
            fullWidth
            autoFocus
            label="标题"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                confirm()
              }
            }}
          />
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="说明"
            value={descriptionDraft}
            onChange={e => setDescriptionDraft(e.target.value)}
            placeholder="补充一点说明"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={cannotSave} onClick={confirm}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
