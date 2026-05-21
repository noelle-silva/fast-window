import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { Box, Button, Dialog, Stack, TextField, Typography } from '@mui/material'
import type { AiOnceController } from '../hooks/useAiOnceController'

type SpaceDialogsProps = {
  controller: AiOnceController
}

export function SpaceDialogs(props: SpaceDialogsProps) {
  const { controller } = props
  const { state } = controller

  return (
    <>
      <Dialog open={state.dialog === 'space'} onClose={controller.closeDialog} fullWidth maxWidth="xs">
        <Box sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>新建空间</Typography>
              <Typography variant="body2" color="text.secondary">为空间取一个清晰名称，创建后会自动带一个默认模板。</Typography>
            </Box>
            <TextField label="空间名称" autoFocus value={state.spaceName} onChange={event => controller.setSpaceName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void controller.createSpace() }} />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={controller.closeDialog}>取消</Button>
              <Button variant="contained" startIcon={<SaveRoundedIcon fontSize="small" />} onClick={() => void controller.createSpace()} disabled={state.busy || state.asking}>
                创建
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Dialog>

      <Dialog open={state.spaceRename.open} onClose={controller.closeDialog} fullWidth maxWidth="xs">
        <Box sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>重命名空间</Typography>
              <Typography variant="body2" color="text.secondary">空间名称会显示在空间列表和工作台侧栏。</Typography>
            </Box>
            <TextField label="空间名称" autoFocus value={state.spaceRename.name} onChange={event => controller.setSpaceRenameName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void controller.saveSpaceRename() }} />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={controller.closeDialog}>取消</Button>
              <Button variant="contained" startIcon={<SaveRoundedIcon fontSize="small" />} onClick={() => void controller.saveSpaceRename()} disabled={state.busy || state.asking}>
                保存
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Dialog>

      <Dialog open={state.confirmDeleteSpace.open} onClose={controller.cancelDeleteSpace} fullWidth maxWidth="xs">
        <Box sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>删除空间？</Typography>
              <Typography variant="body2" color="text.secondary">将删除「{state.confirmDeleteSpace.name}」及其模板配置，并同步清理该空间的历史记录和图片。</Typography>
            </Box>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={controller.cancelDeleteSpace}>取消</Button>
              <Button color="error" variant="contained" startIcon={<DeleteOutlineRoundedIcon fontSize="small" />} onClick={() => void controller.confirmDeleteSpace()} disabled={state.busy || state.asking}>
                删除
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Dialog>

    </>
  )
}
