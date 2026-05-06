import * as React from 'react'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import { Box, Button, ClickAwayListener, Dialog, DialogActions, DialogContent, DialogTitle, Divider, List, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, TextField, Typography } from '@mui/material'
import type { CollectionFolderNode } from '../../shared/types'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'

type FolderDialogsProps = {
  controller: ClipboardHistoryController
}

export function FolderDialogs(props: FolderDialogsProps) {
  const { controller } = props
  return (
    <>
      <FolderContextMenu controller={controller} />
      <EditNodeDialog controller={controller} />
      <MovePickerDialog controller={controller} />
    </>
  )
}

function FolderContextMenu(props: FolderDialogsProps) {
  const { controller } = props
  const { ctxMenu } = controller.state
  const node = ctxMenu.open ? controller.getNode(ctxMenu.nodeId) : null
  if (!ctxMenu.open || !node || (node.type !== 'folder' && node.type !== 'item')) return null

  return (
    <ClickAwayListener onClickAway={controller.closeContextMenu}>
      <Paper
        role="menu"
        sx={{
          position: 'fixed',
          left: Math.max(8, Math.min(ctxMenu.x, window.innerWidth - 240)),
          top: Math.max(8, Math.min(ctxMenu.y, window.innerHeight - 160)),
          minWidth: 220,
          overflow: 'hidden',
          zIndex: 90,
        }}
      >
        <Button
          fullWidth
          startIcon={<EditRoundedIcon fontSize="small" />}
          sx={{ justifyContent: 'flex-start', border: 0, borderRadius: 0, px: 1.5 }}
          onClick={() => controller.openEditDialog(node.id)}
        >
          编辑
        </Button>
        {node.type === 'item' ? (
          <Button
            fullWidth
            startIcon={<ContentCopyRoundedIcon fontSize="small" />}
            sx={{ justifyContent: 'flex-start', border: 0, borderRadius: 0, px: 1.5 }}
            onClick={() => controller.openMovePicker(node.id, 'copy')}
          >
            复制到...
          </Button>
        ) : null}
        <Button
          fullWidth
          startIcon={<DriveFileMoveRoundedIcon fontSize="small" />}
          sx={{ justifyContent: 'flex-start', border: 0, borderRadius: 0, px: 1.5 }}
          onClick={() => controller.openMovePicker(node.id, 'move')}
        >
          移动到...
        </Button>
      </Paper>
    </ClickAwayListener>
  )
}

function EditNodeDialog(props: FolderDialogsProps) {
  const { controller } = props
  const { editDialog } = controller.state
  const node = editDialog.open ? controller.getNode(editDialog.nodeId) : null
  const isFolder = node?.type === 'folder'

  return (
    <Dialog open={!!editDialog.open && !!node} onClose={controller.closeDialogs} fullWidth maxWidth="sm">
      <DialogTitle>{isFolder ? '编辑收藏夹' : '编辑条目'}</DialogTitle>
      <DialogContent>
        {isFolder ? (
          <TextField
            autoFocus
            fullWidth
            label="收藏夹名称"
            value={editDialog.folderName}
            onChange={(event) => controller.setEditDialogDraft({ folderName: event.target.value })}
            sx={{ mt: 1 }}
          />
        ) : (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              fullWidth
              label="备注（标题）"
              value={editDialog.itemTitle}
              onChange={(event) => controller.setEditDialogDraft({ itemTitle: event.target.value })}
            />
            <TextField
              multiline
              minRows={5}
              fullWidth
              label="正文内容（不能为空）"
              value={editDialog.itemContent}
              onChange={(event) => controller.setEditDialogDraft({ itemContent: event.target.value })}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={controller.closeDialogs}>取消</Button>
        <Button variant="contained" onClick={() => void controller.saveEditDialog()}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}

function MovePickerDialog(props: FolderDialogsProps) {
  const { controller } = props
  const { movePicker, collections } = controller.state
  const moving = movePicker.open ? controller.getNode(movePicker.movingId) : null
  const action = movePicker.action === 'copy' ? 'copy' : 'move'
  const kindLabel = moving?.type === 'folder' ? '收藏夹' : '条目'
  const name = moving?.type === 'folder' ? moving.name : moving?.type === 'item' ? moving.title || '' : ''
  const query = movePicker.query.trim().toLowerCase()

  const folders = React.useMemo(() => {
    if (!collections || !moving) return []
    return Object.values(collections.nodes || {})
      .filter((n): n is CollectionFolderNode => !!n && n.type === 'folder')
      .filter((n) => props.controller.canMoveInto(n.id, moving.id))
      .map((n) => ({ id: n.id, label: props.controller.folderLabelById(n.id) }))
      .filter((x) => query ? x.label.toLowerCase().includes(query) : true)
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
  }, [collections, props.controller, moving, query])

  return (
    <Dialog open={!!movePicker.open && !!moving} onClose={controller.closeDialogs} fullWidth maxWidth="sm">
      <DialogTitle>{action === 'copy' ? '复制' : '移动'}{kindLabel}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25} sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">将「{name}」{action === 'copy' ? '复制到' : '移动到'}：</Typography>
            {moving?.type === 'folder' && action === 'move' ? (
              <Typography variant="caption" color="text.secondary">不能移动到自身或子收藏夹</Typography>
            ) : null}
          </Box>
          <TextField
            autoFocus
            fullWidth
            placeholder="搜索目标收藏夹（按路径）"
            value={movePicker.query}
            onChange={(event) => controller.setMovePickerQuery(event.target.value)}
          />
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            {!folders.length ? (
              <Box sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 12 }}>没有可用的目标收藏夹</Box>
            ) : (
              <List dense disablePadding sx={{ maxHeight: '42vh', overflow: 'auto' }}>
                {folders.map((folder, index) => (
                  <React.Fragment key={folder.id}>
                    {index ? <Divider /> : null}
                    <ListItemButton onClick={() => void controller.pickMoveTarget(folder.id)}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <FolderRoundedIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={folder.label} />
                    </ListItemButton>
                  </React.Fragment>
                ))}
              </List>
            )}
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={controller.closeDialogs}>取消</Button>
      </DialogActions>
    </Dialog>
  )
}
