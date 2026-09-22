import { Box, Button, Dialog, DialogActions, DialogTitle, IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SettingsIcon from '@mui/icons-material/Settings'
import { NEW_WORKSPACE_ID } from '../../domain/constants'
import { ScrollableDialogContent } from '../components/ScrollableDialogContent'
import { WorkspaceEditorForm } from './WorkspaceEditorForm'

export function WorkspaceDialog(props: { open: boolean; controller: any; draft: any }) {
  const { open, controller, draft } = props
  const editWorkspaceId = String((draft as any)?.editWorkspaceId || '')
  const isNew = editWorkspaceId === NEW_WORKSPACE_ID

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal?.()} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SettingsIcon fontSize="small" />
        {isNew ? '新建工作区' : '工作区设置'}
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeModal?.()} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <ScrollableDialogContent>
        <WorkspaceEditorForm controller={controller} draft={draft} />
      </ScrollableDialogContent>
      <DialogActions>
        <Button onClick={() => controller.actions.closeModal?.()}>取消</Button>
        <Button variant="contained" onClick={() => controller.actions.saveWorkspace?.()}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
