import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import type { FavoriteFolder, HyperCortexFavoritesDocV1 } from '../../favorites'
import { getFolderRefIssue } from '../../favoritesGraph'
import { useWorkspaceVisible } from '../workspaceVisibility'
import { FolderSuggestionCard } from './FolderSuggestionCard'

// 索引页「添加已有收藏夹」挑选弹窗：把某一层可引用的收藏夹按最近更新排序展示，
// 自引用与循环引用目标就地标注并禁用。索引页与右侧收藏夹栏共用同一挑选流程。

type Props = {
  open: boolean
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  onClose: () => void
  onAddExistingFolder: (folderId: string) => void
}

export function AddExistingFolderDialog(props: Props): React.ReactNode {
  const { open, doc, currentFolderId, onClose, onAddExistingFolder } = props
  const workspaceVisible = useWorkspaceVisible()

  const suggestions = React.useMemo<FavoriteFolder[]>(() => {
    const all = Object.values(doc.folders || {})
      .filter(f => f && f.id && f.id !== 'root' && f.id !== currentFolderId)
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
    return all.slice(0, 12)
  }, [doc, currentFolderId])

  const disabledReasonById = React.useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const folder of suggestions) {
      const issue = getFolderRefIssue(doc, currentFolderId, folder.id)
      if (issue === 'cycle') out[folder.id] = '会形成循环引用，不能添加'
      else if (issue === 'self-reference') out[folder.id] = '不能引用自己'
    }
    return out
  }, [currentFolderId, doc, suggestions])

  return (
    <Dialog open={workspaceVisible && open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>添加已有收藏夹</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>这里只会引用已有收藏夹，不代表真实父子归属。</Typography>
        {suggestions.length ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1 }}>
            {suggestions.map(folder => {
              const reason = disabledReasonById[folder.id] || ''
              return (
                <Box key={folder.id} sx={{ opacity: reason ? 0.5 : 1 }}>
                  <Box onClick={() => (!reason ? onAddExistingFolder(folder.id) : undefined)} sx={{ cursor: reason ? 'not-allowed' : 'pointer' }}>
                    <FolderSuggestionCard doc={doc} folder={folder} />
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
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
