import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import type { AssetEntry } from '../assetTypes'
import type { NoteMeta } from '../core'
import { getFolderById, removeRef, updateFolderInfo, deleteFolder, type HyperCortexFavoritesDocV1 } from '../favorites'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { EditEntityInfoDialog } from './EditEntityInfoDialog'
import { FavoritesTreePickerDialog } from './FavoritesTreePickerDialog'
import { entityDeleteHelperText } from './index-page/helpers'
import { useFavoriteTargets } from './useFavoriteTargets'
import { useWorkspaceVisible } from './workspaceVisibility'

// 收藏夹条目的统一实体操作：右键菜单、编辑信息、删除确认、收藏到…，四处编排收敛到一处。
// 索引页卡片与右侧收藏夹导航栏共用同一套，仅由调用方注入能力回调。

export type FavoritesEntityTarget =
  | { kind: 'folder'; refId: string; folderId: string }
  | { kind: 'note'; refId: string; note: NoteMeta }
  | { kind: 'asset'; refId: string; asset: AssetEntry }
  | { kind: 'stale'; refId: string }

export type FavoritesEntityCapabilities = {
  doc: HyperCortexFavoritesDocV1
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
  toast: (message: string) => void
  /** 提供时菜单出现「打开/进入」项；索引页卡片点击即打开，不提供。 */
  onOpenFolder?: (folderId: string) => void
  onOpenNote?: (note: NoteMeta) => void
  onOpenAsset?: (asset: AssetEntry) => void
  onUpdateNoteInfo?: (note: NoteMeta, patch: { title: string; description: string }) => Promise<void> | void
  onUpdateAssetInfo?: (asset: AssetEntry, patch: { displayName: string; remark: string }) => Promise<void> | void
  onDeleteFolderEntity?: (folderId: string) => void
  onDeleteNoteEntity?: (note: NoteMeta) => void
  onDeleteAssetEntity?: (asset: AssetEntry) => void
}

function assetTargetId(asset: AssetEntry): string {
  return asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
}

function targetTitle(target: FavoritesEntityTarget, doc: HyperCortexFavoritesDocV1): string {
  if (target.kind === 'folder') return getFolderById(doc, target.folderId)?.title || '未命名收藏夹'
  if (target.kind === 'note') return target.note.title || '未命名笔记'
  if (target.kind === 'asset') return String(target.asset.displayName || target.asset.fileName || target.asset.assetId || '附件')
  return '已丢失的条目'
}

function targetDescription(target: FavoritesEntityTarget, doc: HyperCortexFavoritesDocV1): string {
  if (target.kind === 'folder') return getFolderById(doc, target.folderId)?.description || ''
  if (target.kind === 'note') return target.note.description || ''
  if (target.kind === 'asset') return target.asset.remark || ''
  return ''
}

export function useFavoritesEntityActions(caps: FavoritesEntityCapabilities) {
  const workspaceVisible = useWorkspaceVisible()
  const capsRef = React.useRef(caps)
  capsRef.current = caps

  const [menu, setMenu] = React.useState<{ x: number; y: number; target: FavoritesEntityTarget } | null>(null)
  const [editTarget, setEditTarget] = React.useState<FavoritesEntityTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<FavoritesEntityTarget | null>(null)

  const favoritesTargets = useFavoriteTargets({
    doc: caps.doc,
    onDocChange: caps.onDocChange,
    toast: caps.toast,
  })

  const openMenu = React.useCallback((event: React.MouseEvent, target: FavoritesEntityTarget) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, target })
  }, [])

  const closeMenu = React.useCallback(() => setMenu(null), [])

  const removeRefById = React.useCallback((refId: string) => {
    const { doc, onDocChange } = capsRef.current
    const next = removeRef(doc, refId)
    if (next !== doc) onDocChange(next)
  }, [])

  const items = React.useMemo<ContextMenuItem[]>(() => {
    const target = menu?.target
    if (!target) return []
    const c = capsRef.current
    const out: ContextMenuItem[] = []
    if (target.kind === 'folder' && c.onOpenFolder) {
      out.push({ id: 'open', label: '进入收藏夹', icon: <OpenInNewRoundedIcon fontSize="small" />, onSelect: () => c.onOpenFolder?.(target.folderId) })
    } else if (target.kind === 'note' && c.onOpenNote) {
      out.push({ id: 'open', label: '打开笔记', icon: <OpenInNewRoundedIcon fontSize="small" />, onSelect: () => c.onOpenNote?.(target.note) })
    } else if (target.kind === 'asset' && c.onOpenAsset) {
      out.push({ id: 'open', label: '打开附件', icon: <OpenInNewRoundedIcon fontSize="small" />, onSelect: () => c.onOpenAsset?.(target.asset) })
    }
    if (target.kind !== 'stale') {
      const favoriteId = target.kind === 'folder' ? target.folderId : target.kind === 'note' ? target.note.id : assetTargetId(target.asset)
      out.push({
        id: 'favorite',
        label: '收藏到…',
        icon: <StarBorderRoundedIcon fontSize="small" />,
        onSelect: () => favoritesTargets.openPicker({ kind: target.kind, id: favoriteId }),
      })
      out.push({ id: 'edit', label: '编辑信息', icon: <EditRoundedIcon fontSize="small" />, onSelect: () => setEditTarget(target) })
    }
    out.push({ id: 'remove', label: '从当前页移除引用', icon: <DeleteOutlineRoundedIcon fontSize="small" />, onSelect: () => removeRefById(target.refId) })
    if (target.kind !== 'stale') {
      out.push({ id: 'delete', label: '删除实体', danger: true, icon: <DeleteForeverRoundedIcon fontSize="small" />, onSelect: () => setDeleteTarget(target) })
    }
    return out
  }, [favoritesTargets, menu?.target, removeRefById])

  const confirmEdit = React.useCallback(
    (next: { title: string; description: string }) => {
      const target = editTarget
      if (!target) return
      const c = capsRef.current
      if (target.kind === 'folder') {
        const nextDoc = updateFolderInfo(c.doc, target.folderId, next)
        if (!nextDoc) {
          c.toast('收藏夹标题不能为空')
          return
        }
        if (nextDoc !== c.doc) c.onDocChange(nextDoc)
      } else if (target.kind === 'note') {
        void c.onUpdateNoteInfo?.(target.note, next)
      } else if (target.kind === 'asset') {
        void c.onUpdateAssetInfo?.(target.asset, { displayName: next.title, remark: next.description })
      }
      setEditTarget(null)
    },
    [editTarget],
  )

  const confirmDelete = React.useCallback(() => {
    const target = deleteTarget
    if (!target) return
    setDeleteTarget(null)
    const c = capsRef.current
    if (target.kind === 'folder') {
      const nextDoc = deleteFolder(c.doc, target.folderId)
      if (nextDoc) c.onDocChange(nextDoc)
      c.onDeleteFolderEntity?.(target.folderId)
      return
    }
    if (target.kind === 'note') {
      c.onDeleteNoteEntity?.(target.note)
      return
    }
    if (target.kind === 'asset') {
      c.onDeleteAssetEntity?.(target.asset)
    }
  }, [deleteTarget])

  const node = (
    <>
      <ContextMenu open={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} items={items} onClose={closeMenu} />
      {editTarget ? (
        <EditEntityInfoDialog
          open
          title={targetTitle(editTarget, caps.doc)}
          description={targetDescription(editTarget, caps.doc)}
          onClose={() => setEditTarget(null)}
          onConfirm={confirmEdit}
        />
      ) : null}
      <Dialog open={workspaceVisible && !!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除目标实体</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.72)', lineHeight: 1.7 }}>
            {deleteTarget && deleteTarget.kind !== 'stale' ? entityDeleteHelperText(deleteTarget.kind) : ''}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.45)', pt: 1 }}>当前目标：{deleteTarget ? targetTitle(deleteTarget, caps.doc) : '未命名'}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>删除实体</Button>
        </DialogActions>
      </Dialog>
      {favoritesTargets.target ? (
        <FavoritesTreePickerDialog
          open={favoritesTargets.pickerOpen}
          doc={caps.doc}
          kind={favoritesTargets.target.kind}
          targetId={favoritesTargets.target.id}
          onClose={favoritesTargets.closePicker}
          onSave={favoritesTargets.saveResult}
        />
      ) : null}
    </>
  )

  return { openMenu, node }
}
