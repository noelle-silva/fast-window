import { Box, Button, Dialog, DialogActions, DialogTitle, IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SettingsIcon from '@mui/icons-material/Settings'
import { ScrollableDialogContent } from '../components/ScrollableDialogContent'
import { GroupEditorForm } from './GroupEditorForm'

export function GroupDialog(props: { open: boolean; controller: any; roles: any[]; draft: any }) {
  const { open, controller, roles, draft } = props

  const editGroupId = String((draft as any)?.editGroupId || '')
  const isNew = editGroupId === '__new_group__'
  const avatarCropSrc = String((draft as any)?.groupAvatarImageCropSrc || '').trim()

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SettingsIcon fontSize="small" />
        {isNew ? '新建群组' : '群组设置'}
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeModal()} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <ScrollableDialogContent>
        <GroupEditorForm controller={controller} roles={roles} draft={draft} />
      </ScrollableDialogContent>
      <DialogActions>
        <Button onClick={() => controller.actions.closeModal()}>取消</Button>
        <Button variant="contained" onClick={() => controller.actions.saveGroup?.()} disabled={!!avatarCropSrc}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
