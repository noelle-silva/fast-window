import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import type { FavoriteFolder, HyperCortexFavoritesDocV1 } from '../../favorites'
import type { AddKind, AddMode } from './types'
import { folderDeleteHelperText, folderTitle } from './helpers'
import { useWorkspaceVisible } from '../workspaceVisibility'
import { EntityInfoDialog } from '../EntityInfoDialog'

type Props = {
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  addMode: AddMode | null
  addKind: AddKind | null
  folderSuggestions: FavoriteFolder[]
  folderDisabledReasonById: Record<string, string>
  deleteFolderConfirmId: string
  onCloseAddDialog: () => void
  onConfirmAddFolder: (info: { title: string; description: string }) => void
  onAddExistingFolder: (folderId: string) => void
  renderFolderSuggestionCard: (folder: FavoriteFolder) => React.ReactNode
  onCloseDeleteFolder: () => void
  onConfirmDeleteFolder: () => void
}

export function IndexPageDialogs(props: Props): React.ReactNode {
  const {
    doc,
    currentFolderId,
    addMode,
    addKind,
    folderSuggestions,
    folderDisabledReasonById,
    deleteFolderConfirmId,
    onCloseAddDialog,
    onConfirmAddFolder,
    onAddExistingFolder,
    renderFolderSuggestionCard,
    onCloseDeleteFolder,
    onConfirmDeleteFolder,
  } = props
  const workspaceVisible = useWorkspaceVisible()

  return (
    <>
      <EntityInfoDialog
        open={workspaceVisible && addMode === 'create' && addKind === 'folder'}
        mode="create"
        title=""
        description=""
        onClose={onCloseAddDialog}
        onConfirm={onConfirmAddFolder}
      />

      <Dialog open={workspaceVisible && addMode === 'existing' && addKind === 'folder'} onClose={onCloseAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>添加已有收藏夹</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>这里只会引用已有收藏夹，不代表真实父子归属。</Typography>
          {folderSuggestions.length ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1 }}>
              {folderSuggestions.map(folder => {
                const reason = folderDisabledReasonById[folder.id] || ''
                return (
                  <Box key={folder.id} sx={{ opacity: reason ? 0.5 : 1 }}>
                    <Box onClick={() => (!reason ? onAddExistingFolder(folder.id) : undefined)} sx={{ cursor: reason ? 'not-allowed' : 'pointer' }}>
                      {renderFolderSuggestionCard(folder)}
                    </Box>
                    {reason ? <Typography sx={{ fontSize: 11, color: 'var(--hc-danger)', pt: 0.5 }}>{reason}</Typography> : null}
                  </Box>
                )
              })}
            </Box>
          ) : (
            <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>还没有可添加的已有收藏夹。</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseAddDialog}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={workspaceVisible && !!deleteFolderConfirmId} onClose={onCloseDeleteFolder} maxWidth="xs" fullWidth>
        <DialogTitle>删除当前收藏夹实体</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.72)', lineHeight: 1.7 }}>{folderDeleteHelperText(deleteFolderConfirmId)}</Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.45)', pt: 1 }}>当前目标：{folderTitle(doc, deleteFolderConfirmId || currentFolderId)}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseDeleteFolder}>取消</Button>
          <Button color="error" variant="contained" onClick={onConfirmDeleteFolder}>删除实体</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
