import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'

type FavoriteFolderDraftState = { open: boolean; parentId: string; name: string }
type FavoriteFolderRenameState = { open: boolean; folderId: string; name: string }
type FavoriteFolderDeleteState = { open: boolean; folderId: string; mode: 'keep' | 'tree' }
type FavoriteFolderMoveContentsState = { open: boolean; folderId: string; targetFolderId: string }
type FavoriteFolderMoveState = { open: boolean; folderId: string; parentId: string }
type FavoriteFolderClearState = { open: boolean; folderId: string }
type FavoriteDialogState = { open: boolean; targetKind: 'role' | 'group' | 'workspace'; targetId: string; chatId: string; title: string }

export function FavoriteFoldersDialogs(props: {
  loading: boolean
  favoriteFolders: any[]
  createFavoriteFolder: FavoriteFolderDraftState
  setCreateFavoriteFolder: React.Dispatch<React.SetStateAction<FavoriteFolderDraftState>>
  closeCreateFavoriteFolder: () => void
  submitCreateFavoriteFolder: () => void
  openCreateFavoriteFolder: (parentId?: string) => void
  renameFavoriteFolder: FavoriteFolderRenameState
  setRenameFavoriteFolder: React.Dispatch<React.SetStateAction<FavoriteFolderRenameState>>
  closeRenameFavoriteFolder: () => void
  submitRenameFavoriteFolder: () => void
  confirmDeleteFavoriteFolder: FavoriteFolderDeleteState
  closeDeleteFavoriteFolderConfirm: () => void
  submitDeleteFavoriteFolder: () => void
  moveFavoriteFolderContents: FavoriteFolderMoveContentsState
  setMoveFavoriteFolderContents: React.Dispatch<React.SetStateAction<FavoriteFolderMoveContentsState>>
  closeMoveFavoriteFolderContents: () => void
  submitMoveFavoriteFolderContents: () => void
  confirmClearFavoriteFolder: FavoriteFolderClearState
  closeConfirmClearFavoriteFolder: () => void
  submitClearFavoriteFolder: () => void
  moveFavoriteFolderDialog: FavoriteFolderMoveState
  setMoveFavoriteFolderDialog: React.Dispatch<React.SetStateAction<FavoriteFolderMoveState>>
  closeMoveFavoriteFolderDialog: () => void
  submitMoveFavoriteFolder: () => void
  collectFavoriteFolderSubtreeIds: (folderId: string) => string[]
  favoriteDialog: FavoriteDialogState
  closeFavoriteDialog: () => void
  saveFavoriteDialog: () => void
  renderFavoriteFolderPicker: (parentId?: string, depth?: number) => React.ReactNode
  renderFavoriteFolderSinglePicker: (
    selectedId: string,
    onSelect: (folderId: string) => void,
    options?: { includeRoot?: boolean; filter?: (folder: any) => boolean },
    parentId?: string,
    depth?: number,
  ) => React.ReactNode
}) {
  const {
    loading,
    favoriteFolders,
    createFavoriteFolder,
    setCreateFavoriteFolder,
    closeCreateFavoriteFolder,
    submitCreateFavoriteFolder,
    openCreateFavoriteFolder,
    renameFavoriteFolder,
    setRenameFavoriteFolder,
    closeRenameFavoriteFolder,
    submitRenameFavoriteFolder,
    confirmDeleteFavoriteFolder,
    closeDeleteFavoriteFolderConfirm,
    submitDeleteFavoriteFolder,
    moveFavoriteFolderContents,
    setMoveFavoriteFolderContents,
    closeMoveFavoriteFolderContents,
    submitMoveFavoriteFolderContents,
    confirmClearFavoriteFolder,
    closeConfirmClearFavoriteFolder,
    submitClearFavoriteFolder,
    moveFavoriteFolderDialog,
    setMoveFavoriteFolderDialog,
    closeMoveFavoriteFolderDialog,
    submitMoveFavoriteFolder,
    collectFavoriteFolderSubtreeIds,
    favoriteDialog,
    closeFavoriteDialog,
    saveFavoriteDialog,
    renderFavoriteFolderPicker,
    renderFavoriteFolderSinglePicker,
  } = props

  return (
    <>
      <Dialog open={createFavoriteFolder.open} onClose={closeCreateFavoriteFolder} maxWidth="xs" fullWidth>
        <DialogTitle>{createFavoriteFolder.parentId ? '新建子文件夹' : '新建文件夹'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <TextField
              autoFocus
              size="small"
              label="文件夹名"
              value={createFavoriteFolder.name}
              onChange={(e) => setCreateFavoriteFolder((p) => ({ ...p, name: e.target.value }))}
              placeholder="例如：工作 / 灵感 / 需求"
              fullWidth
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitCreateFavoriteFolder()
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCreateFavoriteFolder}>取消</Button>
          <Button variant="contained" onClick={submitCreateFavoriteFolder} disabled={!String(createFavoriteFolder.name || '').trim() || loading}>
            创建
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={renameFavoriteFolder.open} onClose={closeRenameFavoriteFolder} maxWidth="xs" fullWidth>
        <DialogTitle>重命名文件夹</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <TextField
              autoFocus
              size="small"
              label="文件夹名"
              value={renameFavoriteFolder.name}
              onChange={(e) => setRenameFavoriteFolder((p) => ({ ...p, name: e.target.value }))}
              fullWidth
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRenameFavoriteFolder()
                }
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRenameFavoriteFolder}>取消</Button>
          <Button variant="contained" onClick={submitRenameFavoriteFolder} disabled={!String(renameFavoriteFolder.name || '').trim() || loading}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDeleteFavoriteFolder.open} onClose={closeDeleteFavoriteFolderConfirm} maxWidth="xs" fullWidth>
        <DialogTitle>{confirmDeleteFavoriteFolder.mode === 'tree' ? '删除文件夹及其子内容？' : '删除文件夹（内容保留）？'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {confirmDeleteFavoriteFolder.mode === 'tree'
              ? '这会删除当前文件夹、它的子文件夹，以及这一整棵树里的收藏关系。'
              : '这会删除当前文件夹，并尽量保留内容：子文件夹会上移到上一层；当前文件夹里的收藏会移动到父文件夹。若它是带收藏的顶层文件夹，下一步会让你选择迁移目标。'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteFavoriteFolderConfirm}>取消</Button>
          <Button variant="contained" color="error" onClick={submitDeleteFavoriteFolder} disabled={!confirmDeleteFavoriteFolder.folderId || loading}>
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={moveFavoriteFolderContents.open} onClose={closeMoveFavoriteFolderContents} maxWidth="xs" fullWidth>
        <DialogTitle>选择内容迁移目标</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              这个顶层文件夹里有收藏内容。删除前，请先选择一个文件夹来承接这些内容和子文件夹。
            </Typography>
            {!favoriteFolders.filter((f: any) => String(f?.id || '') !== String(moveFavoriteFolderContents.folderId || '')).length ? (
              <Box sx={{ py: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  当前没有可承接内容的其他文件夹。
                </Typography>
              </Box>
            ) : (
              <List dense sx={{ py: 0 }}>
                {renderFavoriteFolderSinglePicker(
                  String(moveFavoriteFolderContents.targetFolderId || ''),
                  (folderId) => setMoveFavoriteFolderContents((p) => ({ ...p, targetFolderId: folderId })),
                  { filter: (folder: any) => String(folder?.id || '') !== String(moveFavoriteFolderContents.folderId || '') },
                )}
              </List>
            )}
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => openCreateFavoriteFolder('')} sx={{ alignSelf: 'flex-start' }}>
              新建文件夹
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeMoveFavoriteFolderContents}>取消</Button>
          <Button
            variant="contained"
            onClick={submitMoveFavoriteFolderContents}
            disabled={!String(moveFavoriteFolderContents.targetFolderId || '').trim() || loading}
          >
            确认迁移并删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmClearFavoriteFolder.open} onClose={closeConfirmClearFavoriteFolder} maxWidth="xs" fullWidth>
        <DialogTitle>清空当前文件夹收藏？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            只会清空这个文件夹里直接挂着的聊天收藏，不会删除文件夹本身，也不会影响子文件夹。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirmClearFavoriteFolder}>取消</Button>
          <Button variant="contained" color="error" onClick={submitClearFavoriteFolder} disabled={!confirmClearFavoriteFolder.folderId || loading}>
            清空
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={moveFavoriteFolderDialog.open} onClose={closeMoveFavoriteFolderDialog} maxWidth="xs" fullWidth>
        <DialogTitle>移动到...</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              选择这个文件夹的新父文件夹。点“顶层”就是把它移动回最外层。
            </Typography>
            <List dense sx={{ py: 0 }}>
              {renderFavoriteFolderSinglePicker(
                String(moveFavoriteFolderDialog.parentId || ''),
                (folderId) => setMoveFavoriteFolderDialog((p) => ({ ...p, parentId: folderId })),
                {
                  includeRoot: true,
                  filter: (folder: any) => {
                    const fid = String(folder?.id || '')
                    if (!fid || fid === String(moveFavoriteFolderDialog.folderId || '')) return false
                    return !collectFavoriteFolderSubtreeIds(String(moveFavoriteFolderDialog.folderId || '')).includes(fid)
                  },
                },
              )}
            </List>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => openCreateFavoriteFolder('')} sx={{ alignSelf: 'flex-start' }}>
              新建文件夹
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeMoveFavoriteFolderDialog}>取消</Button>
          <Button variant="contained" onClick={submitMoveFavoriteFolder} disabled={!moveFavoriteFolderDialog.folderId || loading}>
            确认移动
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={favoriteDialog.open} onClose={closeFavoriteDialog} maxWidth="xs" fullWidth>
        <DialogTitle>收藏到文件夹</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {String(favoriteDialog.title || '未命名会话')}
            </Typography>
            {!favoriteFolders.length ? (
              <Box sx={{ py: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  还没有收藏夹，请先新建文件夹。
                </Typography>
              </Box>
            ) : (
              <List dense sx={{ py: 0 }}>{renderFavoriteFolderPicker('', 0)}</List>
            )}
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => openCreateFavoriteFolder('')} sx={{ alignSelf: 'flex-start' }}>
              新建文件夹
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeFavoriteDialog}>取消</Button>
          <Button variant="contained" onClick={saveFavoriteDialog} disabled={!favoriteDialog.targetId || !favoriteDialog.chatId || loading}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
