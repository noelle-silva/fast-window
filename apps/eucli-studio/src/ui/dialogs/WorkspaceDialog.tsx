import * as React from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import SettingsIcon from '@mui/icons-material/Settings'
import { NEW_WORKSPACE_ID } from '../../domain/constants'
import { ScrollableDialogContent } from '../components/ScrollableDialogContent'

export function WorkspaceDialog(props: { open: boolean; controller: any; draft: any }) {
  const { open, controller, draft } = props
  const editWorkspaceId = String((draft as any)?.editWorkspaceId || '')
  const isNew = editWorkspaceId === NEW_WORKSPACE_ID
  const directories = Array.isArray((draft as any)?.workspaceDirectories) ? (draft as any).workspaceDirectories : []
  const actualPrompt = String((draft as any)?.workspaceActualPrompt || '')
  const actualPromptLoading = Boolean((draft as any)?.workspaceActualPromptLoading)
  const actualPromptStale = Boolean((draft as any)?.workspaceActualPromptStale)
  const actualPromptError = String((draft as any)?.workspaceActualPromptError || '')

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
          <TextField
            label="工作区名称"
            value={String((draft as any)?.workspaceName || '')}
            onChange={(e) => controller.actions.setDraft?.('workspaceName', e.target.value)}
            fullWidth
          />

          <TextField
            label="工作区提示词"
            value={String((draft as any)?.workspacePrompt || '')}
            onChange={(e) => controller.actions.setDraft?.('workspacePrompt', e.target.value)}
            fullWidth
            multiline
            minRows={6}
            placeholder="这里写入项目约定、工作规范、额外上下文说明。"
          />

          <Box sx={{ border: '1px solid', borderColor: actualPromptStale ? 'warning.light' : 'divider', borderRadius: 2, p: 1.5, bgcolor: actualPromptStale ? 'rgba(245,158,11,.06)' : 'background.paper' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 1 }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 900 }}>实际提示词</Typography>
                <Typography variant="caption" color="text.secondary">
                  后台按当前工作区资料生成，设置页只展示结果，不在界面里拼装。
                </Typography>
              </Box>
              <Button size="small" variant={actualPromptStale ? 'contained' : 'outlined'} onClick={() => controller.actions.refreshWorkspacePromptPreview?.()} disabled={actualPromptLoading}>
                {actualPromptLoading ? '生成中…' : '刷新实际提示词'}
              </Button>
            </Stack>
            {actualPromptStale ? (
              <Alert severity="warning" sx={{ mb: 1 }}>
                当前填写内容已变化，请刷新后查看最新实际提示词。
              </Alert>
            ) : null}
            {actualPromptError ? (
              <Alert severity="error" sx={{ mb: 1 }}>
                {actualPromptError}
              </Alert>
            ) : null}
            <TextField
              value={actualPrompt || '（当前没有额外工作区提示词会进入对话）'}
              fullWidth
              multiline
              minRows={5}
              InputProps={{ readOnly: true }}
            />
          </Box>

          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 900 }}>目录清单</Typography>
            <Typography variant="caption" color="text.secondary">
              路径需要填写绝对路径，保存时会由后端做真实校验。
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" startIcon={<AddIcon />} onClick={() => controller.actions.addWorkspaceDirectory?.()}>
              添加目录
            </Button>
          </Stack>

          <Divider />

          <Stack spacing={1.25}>
            {(directories.length ? directories : [{ path: '', alias: '', description: '' }]).map((directory: any, index: number) => (
              <Box key={`workspace-dir-${index}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.25 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: 'rgba(59,130,246,.10)', color: 'primary.main', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <FolderOutlinedIcon fontSize="small" />
                    </Box>
                    <Typography sx={{ fontWeight: 900, minWidth: 0 }} noWrap>
                      目录 {index + 1}
                    </Typography>
                  </Stack>
                  <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.removeWorkspaceDirectory?.(index)}>
                    删除
                  </Button>
                </Stack>

                <Stack spacing={1} sx={{ mt: 1 }}>
                  <TextField
                    label="绝对路径"
                    value={String(directory?.path || '')}
                    onChange={(e) => controller.actions.setWorkspaceDirectoryField?.(index, 'path', e.target.value)}
                    fullWidth
                    placeholder="例如：E:\\project"
                  />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      label="别名"
                      value={String(directory?.alias || '')}
                      onChange={(e) => controller.actions.setWorkspaceDirectoryField?.(index, 'alias', e.target.value)}
                      fullWidth
                      placeholder="例如：主仓库"
                    />
                    <TextField
                      label="用途说明"
                      value={String(directory?.description || '')}
                      onChange={(e) => controller.actions.setWorkspaceDirectoryField?.(index, 'description', e.target.value)}
                      fullWidth
                      placeholder="例如：前端主工程目录"
                    />
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>
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
