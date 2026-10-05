import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Typography } from '@mui/material'
import { type NoteMeta } from '../core'
import type { HyperCortexGateway } from '../gateway'
import { isDraftNoteId } from '../drafts'
import { noteTabKey, type TabKey } from '../tabKey'
import { menuDangerItemSx, menuPaperSx, softButtonSx } from './pluginUiStyles'
import type { NoteDetailSessionHandle } from './NoteDetailSession'
import type { PageId } from './workspacePages'

// 笔记卡片菜单与关闭确认：卡片菜单（复制标题/打开目录/删除）与删除确认对话框、
// 关闭标签未保存确认（去保存/放弃改动并关闭）。由 useNoteSessions 装配调用，
// 只经显式入参连接，不引入隐式全局。

type Params = {
  visible: boolean
  gateway: HyperCortexGateway
  trashEnabled: boolean
  allNotes: NoteMeta[]
  openNoteTabs: NoteMeta[]
  noteSessionHandlesRef: React.MutableRefObject<Record<string, NoteDetailSessionHandle | null>>
  isNoteDirtyById: (noteId: string) => boolean
  isNoteSavingById: (noteId: string) => boolean
  handleDeleteNote: (payload: { note: NoteMeta; mode: 'trash' | 'permanent' }) => Promise<void>
  handleCloseTabs: (noteIds: string[]) => void
  setDetailSelectionSource: React.Dispatch<React.SetStateAction<'tabs' | 'favorites'>>
  setActiveNoteId: React.Dispatch<React.SetStateAction<string>>
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  commitActiveWorkspacePatch: (patch: { activeTabKey: string }) => void
  navigatePage: (next: PageId, opts?: { recordHistory?: boolean }) => void
}

export function useNoteCardMenus(params: Params) {
  const {
    visible,
    gateway,
    trashEnabled,
    allNotes,
    openNoteTabs,
    noteSessionHandlesRef,
    isNoteDirtyById,
    isNoteSavingById,
    handleDeleteNote,
    handleCloseTabs,
    setDetailSelectionSource,
    setActiveNoteId,
    setActiveTabKey,
    commitActiveWorkspacePatch,
    navigatePage,
  } = params

  const [noteCardMenu, setNoteCardMenu] = React.useState<{ anchorEl: HTMLElement; note: NoteMeta } | null>(null)
  const openNoteCardMenu = React.useCallback((e: React.MouseEvent, note: NoteMeta) => {
    e.stopPropagation()
    setNoteCardMenu({ anchorEl: e.currentTarget as HTMLElement, note })
  }, [])
  const closeNoteCardMenu = React.useCallback(() => setNoteCardMenu(null), [])

  const [noteCardDeleteTarget, setNoteCardDeleteTarget] = React.useState<NoteMeta | null>(null)

  const [closeTabPrompt, setCloseTabPrompt] = React.useState<{ noteId: string } | null>(null)
  const requestCloseTabRef = React.useRef<(noteId: string) => void>(() => {})

  const confirmDeleteNoteFromCard = React.useCallback(async () => {
    const target = noteCardDeleteTarget
    if (!target) return
    closeNoteCardMenu()
    const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
    try {
      await handleDeleteNote({ note: target, mode })
      setNoteCardDeleteTarget(null)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '删除失败'))
    }
  }, [closeNoteCardMenu, gateway.host, handleDeleteNote, noteCardDeleteTarget, trashEnabled])

  const requestCopyTitleFromCardMenu = React.useCallback(async () => {
    const note = noteCardMenu?.note
    if (!note) return
    closeNoteCardMenu()
    const title = String(note.title || '').trim() || '未命名'
    try {
      await gateway.clipboard.writeText(title)
      void gateway.host.toast('已复制标题')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '复制失败'))
    }
  }, [gateway, closeNoteCardMenu, noteCardMenu])

  const requestOpenDirFromCardMenu = React.useCallback(async () => {
    const note = noteCardMenu?.note
    if (!note) return
    closeNoteCardMenu()
    if (isDraftNoteId(note.id) || !String(note.dir || '').trim()) {
      void gateway.host.toast('草稿暂无所在目录（请先保存）')
      return
    }
    try {
      await gateway.host.openVaultDir('library', note.dir)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '打开目录失败'))
    }
  }, [gateway, closeNoteCardMenu, noteCardMenu])

  const requestCloseTab = React.useCallback(
    (noteId: string) => {
      const nid = String(noteId || '').trim()
      if (!nid) return
      if (isNoteDirtyById(nid)) return setCloseTabPrompt({ noteId: nid })
      handleCloseTabs([nid])
    },
    [handleCloseTabs, isNoteDirtyById],
  )

  const handleCloseTab = React.useCallback((noteId: string) => requestCloseTab(noteId), [requestCloseTab])

  React.useEffect(() => {
    requestCloseTabRef.current = requestCloseTab
  }, [requestCloseTab])

  const closeTabPromptTargetSaving = !!closeTabPrompt && isNoteSavingById(closeTabPrompt.noteId)

  const closeTabPromptTitle = React.useMemo(() => {
    const nid = String(closeTabPrompt?.noteId || '').trim()
    if (!nid) return '未命名'
    const meta = openNoteTabs.find(t => t.id === nid) || allNotes.find(n => n.id === nid)
    return meta?.title || nid.slice(0, 12) + '…'
  }, [allNotes, closeTabPrompt?.noteId, openNoteTabs])

  const handleCloseTabPromptCancel = React.useCallback(() => setCloseTabPrompt(null), [])

  const handleCloseTabPromptGoSave = React.useCallback(() => {
    const nid = String(closeTabPrompt?.noteId || '').trim()
    if (!nid) return
    setCloseTabPrompt(null)
    setDetailSelectionSource('tabs')
    setActiveNoteId(nid)
    setActiveTabKey(noteTabKey(nid))
    commitActiveWorkspacePatch({ activeTabKey: noteTabKey(nid) })
    navigatePage('note-detail')
    noteSessionHandlesRef.current[nid]?.enterEditMode?.()
  }, [closeTabPrompt?.noteId, commitActiveWorkspacePatch, navigatePage])

  const handleCloseTabPromptDiscardAndClose = React.useCallback(() => {
    const nid = String(closeTabPrompt?.noteId || '').trim()
    if (!nid) return
    setCloseTabPrompt(null)
    noteSessionHandlesRef.current[nid]?.discardChanges?.()
    handleCloseTabs([nid])
  }, [closeTabPrompt?.noteId, handleCloseTabs])

  const noteCardMenuNode = (
    <Menu
      open={visible && !!noteCardMenu}
      onClose={closeNoteCardMenu}
      anchorEl={noteCardMenu?.anchorEl}
      PaperProps={{ sx: menuPaperSx }}
    >
      <MenuItem onClick={() => void requestCopyTitleFromCardMenu()}>
        复制标题
      </MenuItem>
      <MenuItem
        onClick={() => void requestOpenDirFromCardMenu()}
        disabled={!noteCardMenu?.note || isDraftNoteId(noteCardMenu.note.id) || !String(noteCardMenu.note.dir || '').trim()}
      >
        打开所在目录
      </MenuItem>
      <MenuItem
        onClick={() => {
          const target = noteCardMenu?.note
          if (!target) return
          setNoteCardDeleteTarget(target)
          closeNoteCardMenu()
        }}
        sx={menuDangerItemSx}
      >
        删除此笔记…
      </MenuItem>
    </Menu>
  )

  const noteCardDeleteDialog = (
    <Dialog open={visible && !!noteCardDeleteTarget} onClose={() => setNoteCardDeleteTarget(null)} maxWidth="xs" fullWidth>
      <DialogTitle>
        {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
          ? '删除草稿'
          : trashEnabled
            ? '移入回收站'
            : '永久删除'}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
          {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
            ? `确定删除草稿「${noteCardDeleteTarget.title || '未命名'}」吗？这会丢弃当前内容。`
            : trashEnabled
              ? `确定将笔记「${noteCardDeleteTarget?.title || '未命名'}」移入回收站吗？`
              : `回收站当前未启用。确定永久删除笔记「${noteCardDeleteTarget?.title || '未命名'}」吗？此操作不可撤销。`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setNoteCardDeleteTarget(null)}>取消</Button>
        <Button variant="contained" color="error" onClick={() => void confirmDeleteNoteFromCard()}>
          {noteCardDeleteTarget && isDraftNoteId(noteCardDeleteTarget.id)
            ? '删除'
            : trashEnabled
              ? '移入回收站'
              : '永久删除'}
        </Button>
      </DialogActions>
    </Dialog>
  )

  const closeTabPromptDialog = (
    <Dialog open={visible && !!closeTabPrompt} onClose={handleCloseTabPromptCancel} maxWidth="xs" fullWidth>
      <DialogTitle>未保存改动</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.72)' }}>
          笔记「{closeTabPromptTitle}」还有未保存的改动。关闭标签页会丢失这些改动，请先保存或放弃改动。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseTabPromptCancel}>取消</Button>
        <Button variant="text" onClick={handleCloseTabPromptGoSave} sx={softButtonSx}>去保存</Button>
        <Button variant="contained" color="error" onClick={handleCloseTabPromptDiscardAndClose} disabled={closeTabPromptTargetSaving}>放弃改动并关闭</Button>
      </DialogActions>
    </Dialog>
  )

  return {
    openNoteCardMenu,
    noteCardMenuNode,
    noteCardDeleteDialog,
    requestCloseTabRef,
    handleCloseTab,
    closeTabPromptDialog,
    setCloseTabPrompt,
  }
}
