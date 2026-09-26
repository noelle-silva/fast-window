import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'

type ToolWorkDirectoryPromptDialogProps = {
  controller: any
  state: any
}

// ToolWorkDirectoryPromptDialog 首次引导：展示默认落点并允许就地改目录；
// 确认或关闭都记为已引导，之后不再打扰（设置页随时可改）。
export function ToolWorkDirectoryPromptDialog(props: ToolWorkDirectoryPromptDialogProps) {
  const { controller, state } = props
  const open = state?.promptOpen === true
  const saving = state?.saving === true
  const error = String(state?.error || '')
  return (
    <Dialog open={open} onClose={() => controller.actions.dismissToolWorkDirectoryPrompt?.()} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FolderOutlinedIcon fontSize="small" />
        AI 工具的工作目录
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            没有工作区的会话里，所有 AI 工具都会在下面这个目录中干活，不再触碰 eucli-box 的部署位置。你可以改成任意位置；以后随时能在「AI 工具管理」里修改。
          </Typography>
          <TextField
            size="small"
            label="工作目录绝对路径"
            value={String(state?.draft || '')}
            onChange={(event) => controller.actions.setToolWorkDirectoryDraft?.(event.target.value)}
            disabled={saving}
            fullWidth
          />
          {error ? <Typography variant="caption" color="error">{error}</Typography> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={() => controller.actions.dismissToolWorkDirectoryPrompt?.()} disabled={saving}>
          关闭
        </Button>
        <Button onClick={() => controller.actions.useDefaultToolWorkDirectoryPrompt?.()} disabled={saving}>
          使用默认位置
        </Button>
        <Button variant="contained" onClick={() => controller.actions.confirmToolWorkDirectoryPrompt?.()} disabled={saving}>
          {saving ? '保存中…' : '使用这个目录'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
