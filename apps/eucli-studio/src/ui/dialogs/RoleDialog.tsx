import * as React from 'react'
import { Box, Button, DialogActions, DialogContent, IconButton, MenuItem, Stack } from '@mui/material'
import { DependableDialog, DependableMenu } from '../components/DependableOverlay'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { RoleEditorForm } from './roleEditor/RoleEditorForm'

export function RoleDialog(props: { open: boolean; controller: any; providers: any[]; modelGroups: any[]; draft: any; models: any; tools: any; hookPrompts?: any; placeholders?: any; systemPlugins?: any }) {
  const { open, controller, providers, modelGroups, draft, models, tools, hookPrompts, placeholders, systemPlugins } = props
  const [moreMenuEl, setMoreMenuEl] = React.useState<HTMLElement | null>(null)

  const editRoleId = String(draft?.editRoleId || '')
  const isNew = editRoleId === '__new__'
  const avatarCropSrc = String(draft?.roleAvatarImageCropSrc || '').trim()

  return (
    <DependableDialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="md">
      {/*
        内容区给一个确定高度、自己不滚动：滚动交给各分类面板。
        「提示词编辑」的文本框靠 flex 吃掉剩余空间，父级高度必须是确定值，
        只给 max-height 的话高度仍由内容决定，flex: 1 就没有可分配的空间，框会塌成一条缝。
      */}
      <DialogContent
        sx={{
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
          height: 'min(820px, calc(100vh - 240px))',
        }}
      >
        <RoleEditorForm controller={controller} providers={providers} modelGroups={modelGroups} draft={draft} models={models} tools={tools} hookPrompts={hookPrompts} placeholders={placeholders} systemPlugins={systemPlugins} defaultCategory={isNew ? 'other' : undefined} />
      </DialogContent>
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
        <DependableMenu anchorEl={moreMenuEl} open={!!moreMenuEl} onClose={() => setMoreMenuEl(null)}>
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
        </DependableMenu>
      </DialogActions>
    </DependableDialog>
  )
}
