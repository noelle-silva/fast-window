import * as React from 'react'
import { Menu, MenuItem } from '@mui/material'
import { useWorkspaceVisible } from '../workspaceVisibility'

type Props = {
  addExistingAnchorEl: HTMLElement | null
  createNewAnchorEl: HTMLElement | null
  onClose: () => void
  onAddExistingFolder: () => void
  onAddExistingNote: () => void
  onAddExistingAsset: () => void
  onCreateFolder: () => void
  onCreateNote: () => void
  onUploadAsset: () => void
}

export function IndexPageAddMenus(props: Props): React.ReactNode {
  const {
    addExistingAnchorEl,
    createNewAnchorEl,
    onClose,
    onAddExistingFolder,
    onAddExistingNote,
    onAddExistingAsset,
    onCreateFolder,
    onCreateNote,
    onUploadAsset,
  } = props
  const workspaceVisible = useWorkspaceVisible()

  return (
    <>
      <Menu open={workspaceVisible && !!addExistingAnchorEl} onClose={onClose} anchorEl={addExistingAnchorEl} PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}>
        <MenuItem onClick={onAddExistingFolder}>已有收藏夹</MenuItem>
        <MenuItem onClick={onAddExistingNote}>已有笔记</MenuItem>
        <MenuItem onClick={onAddExistingAsset}>已有附件</MenuItem>
      </Menu>

      <Menu open={workspaceVisible && !!createNewAnchorEl} onClose={onClose} anchorEl={createNewAnchorEl} PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}>
        <MenuItem onClick={onCreateFolder}>新收藏夹</MenuItem>
        <MenuItem onClick={onCreateNote}>新笔记</MenuItem>
        <MenuItem onClick={onUploadAsset}>上传附件</MenuItem>
      </Menu>
    </>
  )
}
