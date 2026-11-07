import { Box, Button, DialogActions, DialogContent, DialogTitle, IconButton } from '@mui/material'
import { DependableDialog } from '../components/DependableOverlay'
import CloseIcon from '@mui/icons-material/Close'
import SettingsIcon from '@mui/icons-material/Settings'
import { NEW_WORKSPACE_ID } from '../../domain/constants'
import { WorkspaceEditorForm } from './workspaceEditor/WorkspaceEditorForm'

export function WorkspaceDialog(props: { open: boolean; controller: any; draft: any; roles: any[] }) {
  const { open, controller, draft, roles } = props
  const editWorkspaceId = String((draft as any)?.editWorkspaceId || '')
  const isNew = editWorkspaceId === NEW_WORKSPACE_ID

  return (
    <DependableDialog open={open} onClose={() => controller.actions.closeModal?.()} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SettingsIcon fontSize="small" />
        {isNew ? '新建工作区' : '工作区设置'}
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeModal?.()} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      {/*
        内容区给一个确定高度、自己不滚动：滚动交给各分类面板。
        「提示词」的文本框靠 flex 吃掉剩余空间，父级高度必须是确定值，
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
        <WorkspaceEditorForm controller={controller} draft={draft} roles={roles} />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => controller.actions.closeModal?.()}>取消</Button>
        <Button variant="contained" onClick={() => controller.actions.saveWorkspace?.()}>
          保存
        </Button>
      </DialogActions>
    </DependableDialog>
  )
}
