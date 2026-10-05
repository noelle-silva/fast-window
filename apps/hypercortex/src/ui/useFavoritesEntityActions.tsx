import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded'
import type { AssetEntry } from '../assetTypes'
import type { NoteMeta } from '../core'
import { collectRefsForTarget, findRefById, getFolderById, moveRef, removeRef, removeRefsByIds, updateFolderInfo, type FavoriteItemRef, type HyperCortexFavoritesDocV1 } from '../favorites'
import { ContextMenu, type ContextMenuItem, type ContextMenuLeaf } from './ContextMenu'
import { EntityInfoDialog } from './EntityInfoDialog'
import { FavoritesTreePickerDialog, type FavoritesSaveResult } from './FavoritesTreePickerDialog'
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
  /** 开启「移动到…」：把引用从当前收藏夹迁移到另一个收藏夹（区别于「收藏到…」的复制）。 */
  canMoveRefs?: boolean
  onUpdateNoteInfo?: (note: NoteMeta, patch: { title: string; description: string }) => Promise<void> | void
  onUpdateAssetInfo?: (asset: AssetEntry, patch: { displayName: string; remark: string }) => Promise<void> | void
  /** 删除收藏夹本体；实现方负责把别处指向它的所有引用一并移除并随本体打包。 */
  onDeleteFolderEntity?: (folderId: string) => void
  /** 删除笔记本体；refs 为该笔记在收藏夹里的全部引用，随本体一并打包进回收站。返回是否已删除。 */
  onDeleteNoteEntity?: (note: NoteMeta, refs?: FavoriteItemRef[]) => Promise<boolean> | boolean
  /** 删除附件本体；refs 为该附件在收藏夹里的全部引用，随本体一并打包进回收站。返回是否已删除。 */
  onDeleteAssetEntity?: (asset: AssetEntry, refs?: FavoriteItemRef[]) => Promise<boolean> | boolean
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

/**
 * 删除本体并在删除完成后批量移除其收藏引用：引用移除一律排在本体删除之后，
 * 让删除在关闭标签/续接那一刻看到完全相同的页面上下文；
 * 删除失败或取消确认（deleted 为假）时不动引用。
 */
export function deleteEntityThenRemoveRefs(opts: {
  refIds: readonly string[]
  deleteEntity: () => Promise<boolean> | boolean | void
  removeRefs: (refIds: readonly string[]) => void
}): void {
  const pending = opts.deleteEntity()
  Promise.resolve(pending).then(deleted => {
    if (opts.refIds.length && deleted) opts.removeRefs(opts.refIds)
  })
}

export function useFavoritesEntityActions(caps: FavoritesEntityCapabilities) {
  const workspaceVisible = useWorkspaceVisible()
  const capsRef = React.useRef(caps)
  capsRef.current = caps

  const [menu, setMenu] = React.useState<{ x: number; y: number; target: FavoritesEntityTarget } | null>(null)
  const [editTarget, setEditTarget] = React.useState<FavoritesEntityTarget | null>(null)
  // 删除请求：目标；确认后连同该对象在收藏夹里的所有引用一并删除并随本体打包。
  const [deleteRequest, setDeleteRequest] = React.useState<{ target: FavoritesEntityTarget } | null>(null)
  const [removeRefTarget, setRemoveRefTarget] = React.useState<FavoritesEntityTarget | null>(null)
  // 移动目标：待迁移的引用及其当前所在收藏夹（引用自带 folderId）。
  const [moveTarget, setMoveTarget] = React.useState<FavoriteItemRef | null>(null)

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

  const removeRefsByIdsFromDoc = React.useCallback((refIds: readonly string[]) => {
    const { doc, onDocChange } = capsRef.current
    const next = removeRefsByIds(doc, refIds)
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
      if (c.canMoveRefs) {
        out.push({
          id: 'move',
          label: '移动到…',
          icon: <DriveFileMoveRoundedIcon fontSize="small" />,
          onSelect: () => {
            const ref = findRefById(c.doc, target.refId)
            if (ref) setMoveTarget(ref)
          },
        })
      }
      out.push({ id: 'edit', label: '编辑信息', icon: <EditRoundedIcon fontSize="small" />, onSelect: () => setEditTarget(target) })
    }
    // 「删除引用」与「删除引用与本体」两项统一归入「删除」父项，悬停展开二级菜单；两者都需要二次确认。
    const removeLeaf: ContextMenuLeaf = {
      id: 'remove',
      label: '删除引用',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      onSelect: () => setRemoveRefTarget(target),
    }
    const deleteChildren: ContextMenuLeaf[] = [removeLeaf]
    if (target.kind !== 'stale') {
      deleteChildren.push({
        id: 'delete-with-ref',
        label: '删除引用与本体',
        danger: true,
        icon: <DeleteSweepRoundedIcon fontSize="small" />,
        onSelect: () => setDeleteRequest({ target }),
      })
    }
    out.push({ id: 'delete-group', label: '删除', danger: true, icon: <DeleteOutlineRoundedIcon fontSize="small" />, children: deleteChildren })
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

  const confirmRemoveRef = React.useCallback(() => {
    const target = removeRefTarget
    if (!target) return
    setRemoveRefTarget(null)
    removeRefById(target.refId)
  }, [removeRefById, removeRefTarget])

  const confirmMove = React.useCallback(
    (result: FavoritesSaveResult) => {
      const ref = moveTarget
      if (!ref) return
      const c = capsRef.current
      const { doc, outcome, movedCount, skippedCount } = moveRef(c.doc, ref.id, result.selectedFolderIds)
      setMoveTarget(null)
      if (outcome !== 'moved') {
        c.toast('移动失败：没有可用的目标收藏夹')
        return
      }
      if (doc !== c.doc) c.onDocChange(doc)
      if (skippedCount > 0) c.toast(`已移动到 ${movedCount} 个收藏夹，${skippedCount} 个因循环引用被跳过`)
      else c.toast(movedCount > 1 ? `已移动到 ${movedCount} 个收藏夹` : '已移动')
    },
    [moveTarget],
  )

  const confirmDelete = React.useCallback(() => {
    const request = deleteRequest
    if (!request) return
    setDeleteRequest(null)
    const target = request.target
    if (target.kind === 'stale') return
    const c = capsRef.current
    if (target.kind === 'folder') {
      // 收藏夹实体与引用同属一份文档：删除实体与移除全部引用由实现方合并为一次文档更新（原子，避免竞态）。
      c.onDeleteFolderEntity?.(target.folderId)
      return
    }
    // 「删除引用与本体」：把该对象在收藏夹里的所有引用一并移除，并随本体打包进回收站。
    const targetId = target.kind === 'note' ? target.note.id : assetTargetId(target.asset)
    const refs = collectRefsForTarget(c.doc, target.kind, targetId)
    deleteEntityThenRemoveRefs({
      refIds: refs.map(ref => ref.id),
      deleteEntity: () => (target.kind === 'note' ? c.onDeleteNoteEntity?.(target.note, refs) : c.onDeleteAssetEntity?.(target.asset, refs)),
      removeRefs: removeRefsByIdsFromDoc,
    })
  }, [deleteRequest, removeRefsByIdsFromDoc])

  const node = (
    <>
      <ContextMenu open={!!menu} x={menu?.x ?? 0} y={menu?.y ?? 0} items={items} onClose={closeMenu} />
      {editTarget ? (
        <EntityInfoDialog
          open
          mode="edit"
          title={targetTitle(editTarget, caps.doc)}
          description={targetDescription(editTarget, caps.doc)}
          onClose={() => setEditTarget(null)}
          onConfirm={confirmEdit}
        />
      ) : null}
      <Dialog open={workspaceVisible && !!removeRefTarget} onClose={() => setRemoveRefTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除引用</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.72)', lineHeight: 1.7 }}>
            确定删除这条引用吗？只会从当前收藏夹移除该引用，本体不会删除。
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.45)', pt: 1 }}>当前目标：{removeRefTarget ? targetTitle(removeRefTarget, caps.doc) : '未命名'}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveRefTarget(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={confirmRemoveRef}>删除引用</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={workspaceVisible && !!deleteRequest} onClose={() => setDeleteRequest(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除引用与本体</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.72)', lineHeight: 1.7 }}>
            {deleteRequest && deleteRequest.target.kind !== 'stale' ? entityDeleteHelperText(deleteRequest.target.kind) : ''}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.45)', pt: 1 }}>当前目标：{deleteRequest ? targetTitle(deleteRequest.target, caps.doc) : '未命名'}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteRequest(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={confirmDelete}>删除引用与本体</Button>
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
      {moveTarget ? (
        <FavoritesTreePickerDialog
          open
          mode="move"
          doc={caps.doc}
          kind={moveTarget.kind}
          targetId={moveTarget.targetId}
          sourceFolderId={moveTarget.folderId}
          onClose={() => setMoveTarget(null)}
          onSave={confirmMove}
        />
      ) : null}
    </>
  )

  return { openMenu, node }
}
