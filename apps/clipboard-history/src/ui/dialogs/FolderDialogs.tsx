import * as React from 'react'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import NoteAddRoundedIcon from '@mui/icons-material/NoteAddRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import { Box, Button, Chip, ClickAwayListener, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, TextField, Typography } from '@mui/material'
import type { ClipboardImageDraft, CollectionFolderNode } from '../../shared/types'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'
import { ScrollArea } from '../components/ScrollArea'

type FolderDialogsProps = {
  controller: ClipboardHistoryController
}

export function FolderDialogs(props: FolderDialogsProps) {
  const { controller } = props
  return (
    <>
      <FolderContextMenu controller={controller} />
      <CreateFolderDialog controller={controller} />
      <CreateItemDialog controller={controller} />
      <EditNodeDialog controller={controller} />
      <MovePickerDialog controller={controller} />
    </>
  )
}

const centeredDialogSx = {
  zIndex: 1600,
  '& .MuiDialog-container': {
    alignItems: 'center',
    justifyContent: 'center',
  },
  '& .MuiDialog-paper': {
    m: 2,
    borderRadius: 2,
    boxShadow: 24,
  },
}

function CreateFolderDialog(props: FolderDialogsProps) {
  const { controller } = props
  const { state } = controller

  return (
    <Dialog
      open={state.showFolderEditor}
      onClose={controller.resetFolderDraft}
      fullWidth
      maxWidth="xs"
      sx={centeredDialogSx}
      slotProps={{ backdrop: { sx: { bgcolor: 'rgba(10, 12, 18, 0.52)' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FolderRoundedIcon fontSize="small" />
        新建收藏夹
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="收藏夹名称"
          placeholder="输入收藏夹名称"
          value={state.draftFolderName}
          onChange={(event) => controller.setDraftFolderName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void controller.createFolder(state.draftFolderName)
          }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={controller.resetFolderDraft}>取消</Button>
        <Button variant="contained" onClick={() => void controller.createFolder(state.draftFolderName)}>创建</Button>
      </DialogActions>
    </Dialog>
  )
}

function CreateItemDialog(props: FolderDialogsProps) {
  const { controller } = props
  const { state } = controller

  const handlePaste = React.useCallback((event: React.ClipboardEvent) => {
    const file = Array.from(event.clipboardData.files || []).find((item) => item.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    void imageDraftFromFile(file).then(controller.setDraftImage).catch(error => {
      void controller.host.toast(String((error as any)?.message || error || '读取粘贴图片失败'))
    })
  }, [controller])

  return (
    <Dialog
      open={state.showItemEditor}
      onClose={controller.resetItemDraft}
      fullWidth
      maxWidth="sm"
      sx={centeredDialogSx}
      slotProps={{ backdrop: { sx: { bgcolor: 'rgba(10, 12, 18, 0.52)' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <NoteAddRoundedIcon fontSize="small" />
        新建条目
      </DialogTitle>
      <DialogContent onPaste={handlePaste}>
        <Stack spacing={1.25} sx={{ mt: 1 }}>
          <TextField
            autoFocus
            fullWidth
            label="标题（可选）"
            placeholder="标题（可选）"
            value={state.draftTitle}
            onChange={(event) => controller.setDraftTitle(event.target.value)}
          />
          {state.draftImage ? (
            <ImageDraftPreview image={state.draftImage} controller={controller} onClear={() => controller.setDraftImage(null)} />
          ) : (
            <TextField
              multiline
              minRows={6}
              fullWidth
              label="正文"
              placeholder="输入文本，或直接 Ctrl+V 粘贴图片"
              value={state.draftContent}
              onChange={(event) => controller.setDraftContent(event.target.value)}
            />
          )}
          <ImageDraftActions
            image={state.draftImage}
            onPaste={() => void controller.pasteDraftImage()}
            onPick={() => void controller.pickDraftImage()}
            onClear={() => controller.setDraftImage(null)}
          />
          <Typography variant="caption" color="text.secondary">提示：条目卡片点击即可复制，拖拽卡片可排序。图片会保存为托管资源，不会塞进文本正文。</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={controller.resetItemDraft}>取消</Button>
        <Button variant="contained" onClick={() => void controller.createItem()}>添加</Button>
      </DialogActions>
    </Dialog>
  )
}

function ImageDraftPreview(props: { image: ClipboardImageDraft; controller: ClipboardHistoryController; onClear: () => void }) {
  const { image, controller, onClear } = props
  const src = image.dataUrl || (image.reference || image.path ? controller.collectionImageUrl({
    type: 'image',
    reference: image.reference || '',
    path: image.path || '',
    mime: image.mime,
    width: image.width,
    height: image.height,
    sourceName: image.sourceName,
  }) : '')
  return (
    <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'action.hover' }}>
      <Stack spacing={1} alignItems="center">
        {src ? (
          <Box component="img" src={src} alt="待收藏图片预览" sx={{ display: 'block', maxWidth: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 1 }} />
        ) : (
          <Box sx={{ width: '100%', minHeight: 160, display: 'grid', placeItems: 'center', color: 'text.secondary' }}>已保存图片</Box>
        )}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent="center">
          <Chip size="small" icon={<ImageRoundedIcon fontSize="small" />} label="图片" />
          <Chip size="small" label={`${image.width} x ${image.height}`} />
          {image.sourceName ? <Chip size="small" label={image.sourceName} /> : null}
          <Button size="small" onClick={onClear}>清除图片</Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

function ImageDraftActions(props: { image: ClipboardImageDraft | null; onPaste: () => void; onPick: () => void; onClear: () => void }) {
  const { image, onPaste, onPick, onClear } = props
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Button variant="outlined" startIcon={<ImageRoundedIcon fontSize="small" />} onClick={onPaste}>
        粘贴图片
      </Button>
      <Button variant="outlined" startIcon={<UploadFileRoundedIcon fontSize="small" />} onClick={onPick}>
        选择图片
      </Button>
      {image ? <Button onClick={onClear}>改为文本</Button> : null}
    </Stack>
  )
}

function imageDraftFromFile(file: File): Promise<ClipboardImageDraft> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const img = new Image()
      img.onload = () => resolve({
        dataUrl,
        mime: file.type || 'image/png',
        width: img.naturalWidth,
        height: img.naturalHeight,
        sourceName: file.name,
      })
      img.onerror = () => reject(new Error('图片尺寸读取失败'))
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
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
          sx={{ justifyContent: 'flex-start', borderRadius: 0, px: 1.5 }}
          onClick={() => controller.openEditDialog(node.id)}
        >
          编辑
        </Button>
        {node.type === 'item' ? (
          <Button
            fullWidth
            startIcon={<ContentCopyRoundedIcon fontSize="small" />}
            sx={{ justifyContent: 'flex-start', borderRadius: 0, px: 1.5 }}
            onClick={() => controller.openMovePicker(node.id, 'copy')}
          >
            复制到...
          </Button>
        ) : null}
        <Button
          fullWidth
          startIcon={<DriveFileMoveRoundedIcon fontSize="small" />}
          sx={{ justifyContent: 'flex-start', borderRadius: 0, px: 1.5 }}
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
  const itemImage = !isFolder ? editDialog.itemImage : null

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
            {itemImage ? (
              <ImageDraftPreview image={itemImage} controller={controller} onClear={() => controller.setEditDialogDraft({ itemImage: null, itemContent: '' })} />
            ) : (
              <TextField
                multiline
                minRows={5}
                fullWidth
                label="正文内容（不能为空）"
                value={editDialog.itemContent}
                onChange={(event) => controller.setEditDialogDraft({ itemContent: event.target.value })}
              />
            )}
            <ImageDraftActions
              image={itemImage}
              onPaste={() => void controller.pasteEditDialogImage()}
              onPick={() => void controller.pickEditDialogImage()}
              onClear={() => controller.setEditDialogDraft({ itemImage: null, itemContent: '' })}
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
          <Paper sx={{ overflow: 'hidden', bgcolor: 'action.hover', boxShadow: 'none' }}>
            {!folders.length ? (
              <Box sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 12 }}>没有可用的目标收藏夹</Box>
            ) : (
              <ScrollArea ariaLabel="目标收藏夹列表" viewportSx={{ maxHeight: '42vh' }}>
                <List dense disablePadding>
                  {folders.map((folder) => (
                    <React.Fragment key={folder.id}>
                      <ListItemButton onClick={() => void controller.pickMoveTarget(folder.id)}>
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <FolderRoundedIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={folder.label} />
                      </ListItemButton>
                    </React.Fragment>
                  ))}
                </List>
              </ScrollArea>
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
