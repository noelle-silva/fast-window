import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import type { HyperCortexFavoritesDocV1 } from '../../favorites'
import type { AddKind, AddMode } from './types'
import { folderDeleteHelperText, folderTitle } from './helpers'
import { useWorkspaceVisible } from '../workspaceVisibility'
import { EntityInfoDialog } from '../EntityInfoDialog'

type Props = {
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  addMode: AddMode | null
  addKind: AddKind | null
  deleteFolderConfirmId: string
  onCloseAddDialog: () => void
  onConfirmAddFolder: (info: { title: string; description: string }) => void
  onCloseDeleteFolder: () => void
  onConfirmDeleteFolder: () => void
}

export function IndexPageDialogs(props: Props): React.ReactNode {
  const {
    doc,
    currentFolderId,
    addMode,
    addKind,
    deleteFolderConfirmId,
    onCloseAddDialog,
    onConfirmAddFolder,
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
