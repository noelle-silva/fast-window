import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import type { AssetEntry } from '../../assetTypes'
import type { NoteMeta } from '../../core'
import type { FavoriteFolder, HyperCortexFavoritesDocV1 } from '../../favorites'
import type { AddKind, DeleteEntityTarget, EditFolderTarget } from './types'
import { entityDeleteHelperText, folderDeleteHelperText, folderTitle } from './helpers'

type Props = {
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  addKind: AddKind | null
  folderTitleDraft: string
  noteIdDraft: string
  assetIdDraft: string
  noteSearch: string
  assetSearch: string
  noteIndex?: Record<string, NoteMeta>
  folderSuggestions: FavoriteFolder[]
  folderDisabledReasonById: Record<string, string>
  noteSuggestions: NoteMeta[]
  assetSuggestions: AssetEntry[]
  assetLookupKeyCount: number
  deleteFolderConfirmId: string
  deleteEntityTarget: DeleteEntityTarget | null
  editFolderTarget: EditFolderTarget | null
  editFolderTitleDraft: string
  editFolderDescriptionDraft: string
  onCloseAddDialog: () => void
  onFolderTitleDraftChange: (value: string) => void
  onNoteIdDraftChange: (value: string) => void
  onAssetIdDraftChange: (value: string) => void
  onNoteSearchChange: (value: string) => void
  onAssetSearchChange: (value: string) => void
  onConfirmAddFolder: () => void
  onAddExistingFolder: (folderId: string) => void
  onConfirmAddNote: (id?: string) => void
  onConfirmAddAsset: (id?: string) => void
  renderFolderSuggestionCard: (folder: FavoriteFolder) => React.ReactNode
  onCloseDeleteFolder: () => void
  onConfirmDeleteFolder: () => void
  onCloseDeleteEntity: () => void
  onConfirmDeleteEntity: () => void
  onCloseEditFolder: () => void
  onEditFolderTitleDraftChange: (value: string) => void
  onEditFolderDescriptionDraftChange: (value: string) => void
  onConfirmEditFolder: () => void
}

export function IndexPageDialogs(props: Props): React.ReactNode {
  const {
    doc,
    currentFolderId,
    addKind,
    folderTitleDraft,
    noteIdDraft,
    assetIdDraft,
    noteSearch,
    assetSearch,
    noteIndex,
    folderSuggestions,
    folderDisabledReasonById,
    noteSuggestions,
    assetSuggestions,
    assetLookupKeyCount,
    deleteFolderConfirmId,
    deleteEntityTarget,
    editFolderTarget,
    editFolderTitleDraft,
    editFolderDescriptionDraft,
    onCloseAddDialog,
    onFolderTitleDraftChange,
    onNoteIdDraftChange,
    onAssetIdDraftChange,
    onNoteSearchChange,
    onAssetSearchChange,
    onConfirmAddFolder,
    onAddExistingFolder,
    onConfirmAddNote,
    onConfirmAddAsset,
    renderFolderSuggestionCard,
    onCloseDeleteFolder,
    onConfirmDeleteFolder,
    onCloseDeleteEntity,
    onConfirmDeleteEntity,
    onCloseEditFolder,
    onEditFolderTitleDraftChange,
    onEditFolderDescriptionDraftChange,
    onConfirmEditFolder,
  } = props

  return (
    <>
      <Dialog open={addKind === 'folder'} onClose={onCloseAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>添加收藏夹</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>
            会先创建一个新收藏夹，再把它放进当前收藏夹里。已有收藏夹只会被引用，不代表真实父子归属。
          </Typography>
          <TextField fullWidth autoFocus label="收藏夹标题" value={folderTitleDraft} onChange={e => onFolderTitleDraftChange(e.target.value)} placeholder="例如：项目灵感 / 临时收纳" />

          {folderSuggestions.length ? (
            <Box sx={{ pt: 2 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.55)', pb: 1 }}>最近的收藏夹（可直接引用）</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1 }}>
                {folderSuggestions.map(folder => {
                  const reason = folderDisabledReasonById[folder.id] || ''
                  return (
                    <Box key={folder.id} sx={{ opacity: reason ? 0.5 : 1 }}>
                      <Box onClick={() => (!reason ? onAddExistingFolder(folder.id) : undefined)} sx={{ cursor: reason ? 'not-allowed' : 'pointer' }}>
                        {renderFolderSuggestionCard(folder)}
                      </Box>
                      {reason ? <Typography sx={{ fontSize: 11, color: '#d32f2f', pt: 0.5 }}>{reason}</Typography> : null}
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseAddDialog}>取消</Button>
          <Button variant="contained" onClick={onConfirmAddFolder}>创建并添加</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addKind === 'note'} onClose={onCloseAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>添加笔记</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>你可以输入笔记 ID；如果已经传入笔记索引，也可以在下面搜索并点选。</Typography>
          <TextField
            fullWidth
            autoFocus
            label="笔记 ID"
            value={noteIdDraft}
            onChange={e => onNoteIdDraftChange(e.target.value)}
            placeholder="例如：n_abc123..."
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onConfirmAddNote()
              }
            }}
          />

          {noteIndex ? (
            <Box sx={{ pt: 2 }}>
              <TextField fullWidth label="搜索笔记" value={noteSearch} onChange={e => onNoteSearchChange(e.target.value)} placeholder="按标题或 ID" />
              <Box sx={{ pt: 1.5 }}>
                {noteSuggestions.map(n => (
                  <Box key={n.id} sx={{ pb: 1 }}>
                    <Button fullWidth variant="outlined" sx={{ justifyContent: 'space-between', borderRadius: 4, textTransform: 'none' }} onClick={() => onConfirmAddNote(n.id)}>
                      <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {n.title || '未命名'}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{n.id}</Typography>
                      </Box>
                      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.45)' }}>添加</Typography>
                    </Button>
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseAddDialog}>取消</Button>
          <Button variant="contained" onClick={() => onConfirmAddNote()}>添加</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addKind === 'asset'} onClose={onCloseAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>添加附件</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>
            你可以输入资源 key（例如：assetId 或 assetId.ext）；如果已经传入附件索引，也可以在下面搜索并点选。
          </Typography>
          <TextField
            fullWidth
            autoFocus
            label="附件 key"
            value={assetIdDraft}
            onChange={e => onAssetIdDraftChange(e.target.value)}
            placeholder="例如：a_abc123.png"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onConfirmAddAsset()
              }
            }}
          />

          {assetLookupKeyCount ? (
            <Box sx={{ pt: 2 }}>
              <TextField fullWidth label="搜索附件" value={assetSearch} onChange={e => onAssetSearchChange(e.target.value)} placeholder="按文件名或 key" />
              <Box sx={{ pt: 1.25 }}>
                {assetSuggestions.map(a => {
                  const key = a.ext ? `${a.assetId}.${a.ext}` : a.assetId
                  const title = String(a.displayName || a.fileName || key)
                  return (
                    <Box key={key} sx={{ pb: 1 }}>
                      <Button fullWidth variant="outlined" sx={{ justifyContent: 'space-between', borderRadius: 4, textTransform: 'none' }} onClick={() => onConfirmAddAsset(key)}>
                        <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                          <Typography sx={{ fontSize: 13, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {title}
                          </Typography>
                          <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{key}</Typography>
                        </Box>
                        <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'rgba(0,0,0,.45)' }}>添加</Typography>
                      </Button>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseAddDialog}>取消</Button>
          <Button variant="contained" onClick={() => onConfirmAddAsset()}>添加</Button>
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

      <Dialog open={!!editFolderTarget} onClose={onCloseEditFolder} maxWidth="sm" fullWidth>
        <DialogTitle>编辑收藏夹信息</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 3 }}>
            <TextField
              fullWidth
              autoFocus
              label="收藏夹标题"
              value={editFolderTitleDraft}
              onChange={e => onEditFolderTitleDraftChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onConfirmEditFolder()
                }
              }}
            />
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="收藏夹说明"
              value={editFolderDescriptionDraft}
              onChange={e => onEditFolderDescriptionDraftChange(e.target.value)}
              placeholder="写一点这个收藏夹用来收纳什么"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseEditFolder}>取消</Button>
          <Button variant="contained" onClick={onConfirmEditFolder}>保存</Button>
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
