import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import type { FavoriteFolder, HyperCortexFavoritesDocV1 } from '../../favorites'
import type { AddKind, AddMode, DeleteEntityTarget } from './types'
import { entityDeleteHelperText, folderDeleteHelperText, folderTitle } from './helpers'

type Props = {
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  addMode: AddMode | null
  addKind: AddKind | null
  folderTitleDraft: string
  folderDescriptionDraft: string
  folderSuggestions: FavoriteFolder[]
  folderDisabledReasonById: Record<string, string>
  deleteFolderConfirmId: string
  deleteEntityTarget: DeleteEntityTarget | null
  onCloseAddDialog: () => void
  onFolderTitleDraftChange: (value: string) => void
  onFolderDescriptionDraftChange: (value: string) => void
  onConfirmAddFolder: () => void
  onAddExistingFolder: (folderId: string) => void
  renderFolderSuggestionCard: (folder: FavoriteFolder) => React.ReactNode
  onCloseDeleteFolder: () => void
  onConfirmDeleteFolder: () => void
  onCloseDeleteEntity: () => void
  onConfirmDeleteEntity: () => void
}

export function IndexPageDialogs(props: Props): React.ReactNode {
  const {
    doc,
    currentFolderId,
    addMode,
    addKind,
    folderTitleDraft,
    folderDescriptionDraft,
    folderSuggestions,
    folderDisabledReasonById,
    deleteFolderConfirmId,
    deleteEntityTarget,
    onCloseAddDialog,
    onFolderTitleDraftChange,
    onFolderDescriptionDraftChange,
    onConfirmAddFolder,
    onAddExistingFolder,
    renderFolderSuggestionCard,
    onCloseDeleteFolder,
    onConfirmDeleteFolder,
    onCloseDeleteEntity,
    onConfirmDeleteEntity,
  } = props

  return (
    <>
      <Dialog open={addMode === 'create' && addKind === 'folder'} onClose={onCloseAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>创建新收藏夹</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>会先创建一个真实收藏夹，再把它作为卡片放进当前索引页。</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField fullWidth autoFocus label="收藏夹标题" value={folderTitleDraft} onChange={e => onFolderTitleDraftChange(e.target.value)} placeholder="例如：项目灵感 / 临时收纳" />
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="收藏夹说明"
              value={folderDescriptionDraft}
              onChange={e => onFolderDescriptionDraftChange(e.target.value)}
              placeholder="写一点这个收藏夹用来收纳什么"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseAddDialog}>取消</Button>
          <Button variant="contained" onClick={onConfirmAddFolder}>创建并添加</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addMode === 'existing' && addKind === 'folder'} onClose={onCloseAddDialog} maxWidth="sm" fullWidth>
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

      <Dialog open={!!deleteFolderConfirmId} onClose={onCloseDeleteFolder} maxWidth="xs" fullWidth>
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

      <Dialog open={!!deleteEntityTarget} onClose={onCloseDeleteEntity} maxWidth="xs" fullWidth>
        <DialogTitle>删除目标实体</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.72)', lineHeight: 1.7 }}>
            {deleteEntityTarget ? entityDeleteHelperText(deleteEntityTarget.kind) : ''}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.45)', pt: 1 }}>当前目标：{deleteEntityTarget?.title || '未命名'}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseDeleteEntity}>取消</Button>
          <Button color="error" variant="contained" onClick={onConfirmDeleteEntity}>删除实体</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
