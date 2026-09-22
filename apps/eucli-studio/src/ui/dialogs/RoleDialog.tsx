import * as React from 'react'
import { Box, Button, Dialog, DialogActions, IconButton, Menu, MenuItem, Stack } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { ScrollableDialogContent } from '../components/ScrollableDialogContent'
import { RoleEditorForm } from './RoleEditorForm'

export function RoleDialog(props: { open: boolean; controller: any; providers: any[]; modelGroups: any[]; draft: any; models: any; tools: any; hookPrompts?: any }) {
  const { open, controller, providers, modelGroups, draft, models, tools, hookPrompts } = props
  const [moreMenuEl, setMoreMenuEl] = React.useState<HTMLElement | null>(null)

  const editRoleId = String(draft?.editRoleId || '')
  const isNew = editRoleId === '__new__'
  const avatarCropSrc = String(draft?.roleAvatarImageCropSrc || '').trim()

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="md">
      <ScrollableDialogContent>
        <RoleEditorForm controller={controller} providers={providers} modelGroups={modelGroups} draft={draft} models={models} tools={tools} hookPrompts={hookPrompts} />
      </ScrollableDialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        {isNew ? (
          <Box />
        ) : (
          <IconButton size="small" aria-label="更多操作" onClick={(e) => setMoreMenuEl(e.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
        <Stack direction="row" spacing={1}>
          <Button onClick={() => controller.actions.closeModal()}>取消</Button>
          <Button variant="contained" onClick={() => controller.actions.saveRole()} disabled={!!avatarCropSrc}>
            保存
          </Button>
        </Stack>
        <Menu anchorEl={moreMenuEl} open={!!moreMenuEl} onClose={() => setMoreMenuEl(null)}>
          <MenuItem
            sx={{ color: 'error.main', gap: 1 }}
            onClick={() => {
              setMoreMenuEl(null)
              controller.actions.askDeleteRole(editRoleId)
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
            删除角色
          </MenuItem>
        </Menu>
      </DialogActions>
    </Dialog>
  )
}
