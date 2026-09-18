import * as React from 'react'
import { Avatar, Box, Checkbox, Collapse, IconButton, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { ChatSessionRunIndicator, type ChatSessionRunIndicatorKind } from '../components/ChatSessionRunIndicator'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_ITEM_TOP_SX } from '../softPopoverStyles'
import { snippetText } from '../utils/text'
import { isRenderableNode } from '../utils/renderable'
import { useEvent } from './useEvent'

type TargetKind = 'role' | 'group' | 'workspace'

export function useFavoriteFolders(deps: {
  controller: any
  data: any
  roles: any[]
  groups: any[]
  workspaces: any[]
  clearChatSessionRunNotice: (targetKind: TargetKind, targetId: string, chatId: string) => void
  requestSwitch: (chatId: any, opts?: any) => void
  closeChatPicker: () => void
  chatSessionRunIndicatorKind: (targetKind: TargetKind, targetId: string, chat: any, selected: boolean) => ChatSessionRunIndicatorKind | ''
  activeTargetKind: TargetKind
  activeChatTargetId: any
  activeChatId: any
}) {
  const {
    controller,
    data,
    roles,
    groups,
    workspaces,
    clearChatSessionRunNotice,
    requestSwitch,
    closeChatPicker,
    chatSessionRunIndicatorKind,
    activeTargetKind,
    activeChatTargetId,
    activeChatId,
  } = deps

  const favorites = (data as any)?.favorites && typeof (data as any).favorites === 'object' ? (data as any).favorites : { folders: [], chatRefsByFolderId: {} }
  const favoriteFolders = Array.isArray((favorites as any)?.folders) ? ((favorites as any).folders as any[]) : []
  const favoriteChatRefsByFolderId =
    (favorites as any)?.chatRefsByFolderId && typeof (favorites as any)?.chatRefsByFolderId === 'object' ? (favorites as any).chatRefsByFolderId : {}

  const [favoriteSearchOpen, setFavoriteSearchOpen] = React.useState(false)
  const [favoriteSearchText, setFavoriteSearchText] = React.useState('')
  const favoriteSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const [favoriteFolderExpanded, setFavoriteFolderExpanded] = React.useState<Record<string, boolean>>({})
  const [favoriteDialog, setFavoriteDialog] = React.useState<{ open: boolean; targetKind: TargetKind; targetId: string; chatId: string; title: string }>({
    open: false,
    targetKind: 'role',
    targetId: '',
    chatId: '',
    title: '',
  })
  const [favoriteCheckedFolderIds, setFavoriteCheckedFolderIds] = React.useState<string[]>([])
  const [createFavoriteFolder, setCreateFavoriteFolder] = React.useState<{ open: boolean; parentId: string; name: string }>({
    open: false,
    parentId: '',
    name: '',
  })
  const [favoriteFolderMenu, setFavoriteFolderMenu] = React.useState<{ folderId: string; parentId: string; x: number; y: number }>({ folderId: '', parentId: '', x: 0, y: 0 })
  const [renameFavoriteFolder, setRenameFavoriteFolder] = React.useState<{ open: boolean; folderId: string; name: string }>({ open: false, folderId: '', name: '' })
  const [confirmDeleteFavoriteFolder, setConfirmDeleteFavoriteFolder] = React.useState<{ open: boolean; folderId: string; mode: 'keep' | 'tree' }>({
    open: false,
    folderId: '',
    mode: 'keep',
  })
  const [moveFavoriteFolderContents, setMoveFavoriteFolderContents] = React.useState<{ open: boolean; folderId: string; targetFolderId: string }>({
    open: false,
    folderId: '',
    targetFolderId: '',
  })
  const [moveFavoriteFolderDialog, setMoveFavoriteFolderDialog] = React.useState<{ open: boolean; folderId: string; parentId: string }>({
    open: false,
    folderId: '',
    parentId: '',
  })
  const [confirmClearFavoriteFolder, setConfirmClearFavoriteFolder] = React.useState<{ open: boolean; folderId: string }>({ open: false, folderId: '' })
  const [favoriteChatMenu, setFavoriteChatMenu] = React.useState<{
    folderId: string
    targetKind: TargetKind
    targetId: string
    chatId: string
    title: string
    x: number
    y: number
  }>({
    folderId: '',
    targetKind: 'role',
    targetId: '',
    chatId: '',
    title: '',
    x: 0,
    y: 0,
  })

  const favoriteChildrenMap = React.useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const f of favoriteFolders) {
      const pid = String((f as any)?.parentId || '')
      if (!map[pid]) map[pid] = []
      map[pid].push(f)
    }
    for (const list of Object.values(map)) {
      list.sort((a: any, b: any) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0))
    }
    return map
  }, [favoriteFolders])

  const collectFavoriteFolderSubtreeIds = React.useCallback(
    (folderId: string) => {
      const fid = String(folderId || '')
      if (!fid) return []
      const out: string[] = []
      const stack = [fid]
      while (stack.length) {
        const cur = String(stack.pop() || '')
        if (!cur || out.includes(cur)) continue
        out.push(cur)
        const children = favoriteChildrenMap[cur] || []
        for (const child of children) {
          const cid = String(child?.id || '')
          if (cid) stack.push(cid)
        }
      }
      return out
    },
    [favoriteChildrenMap],
  )

  const getChatByFavoriteRef = React.useCallback(
    (targetKind: TargetKind, targetId: string, chatId: string) => {
      const tid = String(targetId || '')
      const cid = String(chatId || '')
      if (!tid || !cid) return null
      if (targetKind === 'group') {
        const box = (data as any)?.chatsByGroup?.[tid]
        const chats = Array.isArray(box?.chats) ? box.chats : []
        const chat = chats.find((c: any) => String(c?.id || '') === cid) || null
        const meta = Array.isArray(box?.chatMetas) ? box.chatMetas.find((c: any) => String(c?.id || '') === cid) : null
        return chat && meta ? { ...chat, ...meta } : chat || meta || null
      }
      if (targetKind === 'workspace') {
        const box = (data as any)?.chatsByWorkspace?.[tid]
        const chats = Array.isArray(box?.chats) ? box.chats : []
        const chat = chats.find((c: any) => String(c?.id || '') === cid) || null
        const meta = Array.isArray(box?.chatMetas) ? box.chatMetas.find((c: any) => String(c?.id || '') === cid) : null
        return chat && meta ? { ...chat, ...meta } : chat || meta || null
      }
      const box = data?.chatsByRole?.[tid]
      const chats = Array.isArray(box?.chats) ? box.chats : []
      const chat = chats.find((c: any) => String(c?.id || '') === cid) || null
      const meta = Array.isArray(box?.chatMetas) ? box.chatMetas.find((c: any) => String(c?.id || '') === cid) : null
      return chat && meta ? { ...chat, ...meta } : chat || meta || null
    },
    [data],
  )

  const getFavoriteTargetMeta = React.useCallback(
    (targetKind: TargetKind, targetId: string) => {
      const tid = String(targetId || '')
      if (!tid) return null
      if (targetKind === 'group') {
        const g = groups.find((it: any) => String(it?.id || '') === tid) || null
        if (!g) return null
        return {
          name: String(g?.name || '群聊'),
          avatar: String(g?.avatar || '👥'),
          avatarImage: String(g?.avatarImage || ''),
        }
      }
      if (targetKind === 'workspace') {
        const workspace = workspaces.find((it: any) => String(it?.id || '') === tid) || null
        if (!workspace) return null
        return {
          name: String(workspace?.name || '工作区'),
          avatar: '📁',
          avatarImage: '',
        }
      }
      const r = roles.find((it: any) => String(it?.id || '') === tid) || null
      if (!r) return null
      return {
        name: String(r?.name || '角色'),
        avatar: String(r?.avatar || '🙂'),
        avatarImage: String(r?.avatarImage || ''),
      }
    },
    [groups, roles, workspaces],
  )

  const openCreateFavoriteFolder = useEvent((parentId = '') => {
    setCreateFavoriteFolder({ open: true, parentId: String(parentId || ''), name: '' })
  })
  const closeCreateFavoriteFolder = useEvent(() => setCreateFavoriteFolder({ open: false, parentId: '', name: '' }))
  const closeFavoriteFolderMenu = useEvent(() => setFavoriteFolderMenu({ folderId: '', parentId: '', x: 0, y: 0 }))
  const openRenameFavoriteFolder = useEvent((folderId: string) => {
    const fid = String(folderId || '')
    const folder = favoriteFolders.find((f: any) => String(f?.id || '') === fid) || null
    if (!folder) return
    closeFavoriteFolderMenu()
    setRenameFavoriteFolder({ open: true, folderId: fid, name: String(folder?.name || '') })
  })
  const closeRenameFavoriteFolder = useEvent(() => setRenameFavoriteFolder({ open: false, folderId: '', name: '' }))
  const submitRenameFavoriteFolder = useEvent(() => {
    const fid = String(renameFavoriteFolder.folderId || '')
    const name = String(renameFavoriteFolder.name || '').trim()
    if (!fid || !name) return
    controller.actions.renameFavoriteFolder?.(fid, name)
    closeRenameFavoriteFolder()
  })
  const openDeleteFavoriteFolderConfirm = useEvent((folderId: string, mode: 'keep' | 'tree') => {
    closeFavoriteFolderMenu()
    setConfirmDeleteFavoriteFolder({ open: true, folderId: String(folderId || ''), mode })
  })
  const closeDeleteFavoriteFolderConfirm = useEvent(() => setConfirmDeleteFavoriteFolder({ open: false, folderId: '', mode: 'keep' }))
  const closeMoveFavoriteFolderContents = useEvent(() => setMoveFavoriteFolderContents({ open: false, folderId: '', targetFolderId: '' }))
  const closeMoveFavoriteFolderDialog = useEvent(() => setMoveFavoriteFolderDialog({ open: false, folderId: '', parentId: '' }))
  const closeConfirmClearFavoriteFolder = useEvent(() => setConfirmClearFavoriteFolder({ open: false, folderId: '' }))
  const submitDeleteFavoriteFolder = useEvent(() => {
    const fid = String(confirmDeleteFavoriteFolder.folderId || '')
    if (!fid) return
    const folder = favoriteFolders.find((f: any) => String(f?.id || '') === fid) || null
    const isTop = !String((folder as any)?.parentId || '').trim()
    const refs = Array.isArray((favoriteChatRefsByFolderId as any)?.[fid]) ? (favoriteChatRefsByFolderId as any)[fid] : []
    if (confirmDeleteFavoriteFolder.mode === 'tree') {
      controller.actions.deleteFavoriteFolderTree?.(fid)
      closeDeleteFavoriteFolderConfirm()
      return
    }
    if (isTop && refs.length) {
      const fallback = favoriteFolders.find((f: any) => String(f?.id || '') !== fid) || null
      setMoveFavoriteFolderContents({ open: true, folderId: fid, targetFolderId: String((fallback as any)?.id || '') })
      closeDeleteFavoriteFolderConfirm()
      return
    }
    controller.actions.deleteFavoriteFolderKeepContents?.(fid)
    closeDeleteFavoriteFolderConfirm()
  })
  const submitMoveFavoriteFolderContents = useEvent(() => {
    const fid = String(moveFavoriteFolderContents.folderId || '')
    const targetFolderId = String(moveFavoriteFolderContents.targetFolderId || '')
    if (!fid || !targetFolderId) return
    controller.actions.deleteFavoriteFolderKeepContents?.(fid, targetFolderId)
    closeMoveFavoriteFolderContents()
  })
  const submitClearFavoriteFolder = useEvent(() => {
    const fid = String(confirmClearFavoriteFolder.folderId || '')
    if (!fid) return
    controller.actions.clearFavoriteFolderRefs?.(fid)
    closeConfirmClearFavoriteFolder()
  })
  const submitMoveFavoriteFolder = useEvent(() => {
    const fid = String(moveFavoriteFolderDialog.folderId || '')
    if (!fid) return
    controller.actions.moveFavoriteFolder?.(fid, moveFavoriteFolderDialog.parentId)
    const moved = favoriteFolders.find((f: any) => String(f?.id || '') === fid) || null
    const nextParentId = String(moveFavoriteFolderDialog.parentId || '')
    setFavoriteFolderExpanded((p) => {
      const next = { ...p, [fid]: true }
      if (nextParentId) next[nextParentId] = true
      const prevParentId = String((moved as any)?.parentId || '')
      if (prevParentId) next[prevParentId] = true
      return next
    })
    closeMoveFavoriteFolderDialog()
  })
  const collapseAllFavoriteFolders = useEvent(() => {
    const next: Record<string, boolean> = {}
    for (const folder of favoriteFolders) {
      const fid = String(folder?.id || '')
      if (fid) next[fid] = false
    }
    setFavoriteFolderExpanded(next)
  })
  const toggleFavoriteFolderExpanded = useEvent((folderId: string) => {
    const fid = String(folderId || '')
    if (!fid) return
    setFavoriteFolderExpanded((p) => ({ ...p, [fid]: !p[fid] }))
  })
  const toggleFavoriteFolderChecked = useEvent((folderId: string) => {
    const fid = String(folderId || '')
    if (!fid) return
    setFavoriteCheckedFolderIds((p) => (p.includes(fid) ? p.filter((x) => x !== fid) : p.concat(fid)))
  })
  const openFavoriteDialog = useEvent((targetKind: TargetKind, targetId: string, chatId: string, title: string) => {
    const tid = String(targetId || '')
    const cid = String(chatId || '')
    if (!tid || !cid) return
    const ids = Array.isArray(controller.actions.getChatFavoriteFolderIds?.(targetKind, tid, cid))
      ? controller.actions.getChatFavoriteFolderIds(targetKind, tid, cid)
      : []
    setFavoriteCheckedFolderIds(ids.map((x: any) => String(x || '')).filter(Boolean))
    setFavoriteDialog({ open: true, targetKind, targetId: tid, chatId: cid, title: String(title || '') })
  })
  const closeFavoriteDialog = useEvent(() => {
    setFavoriteDialog({ open: false, targetKind: 'role', targetId: '', chatId: '', title: '' })
    setFavoriteCheckedFolderIds([])
  })
  const saveFavoriteDialog = useEvent(() => {
    const { targetKind, targetId, chatId } = favoriteDialog
    if (!targetId || !chatId) return
    controller.actions.setChatFavoriteFolders?.(targetKind, targetId, chatId, favoriteCheckedFolderIds)
    closeFavoriteDialog()
  })
  const submitCreateFavoriteFolder = useEvent(() => {
    const name = String(createFavoriteFolder.name || '').trim()
    if (!name) return
    const parentId = String(createFavoriteFolder.parentId || '')
    const id = controller.actions.createFavoriteFolder?.(name, parentId)
    if (id) {
      setFavoriteFolderExpanded((p) => {
        const next = { ...p, [String(id || '')]: true }
        if (parentId) next[parentId] = true
        return next
      })
      closeCreateFavoriteFolder()
    }
  })
  const openFavoritedChat = useEvent((targetKind: TargetKind, targetId: string, chatId: string) => {
    const tid = String(targetId || '')
    const cid = String(chatId || '')
    if (!tid || !cid) return
    clearChatSessionRunNotice(targetKind, tid, cid)
    if (targetKind === 'group') controller.actions.setActiveGroup?.(tid)
    else if (targetKind === 'workspace') controller.actions.setActiveWorkspace?.(tid)
    else controller.actions.setActiveRole?.(tid)
    requestSwitch(cid, { force: true })
    closeChatPicker()
  })
  const closeFavoriteChatMenu = useEvent(() => setFavoriteChatMenu({ folderId: '', targetKind: 'role', targetId: '', chatId: '', title: '', x: 0, y: 0 }))
  const onFavoriteChatContextMenu = useEvent(
    (e: React.MouseEvent, folderId: string, targetKind: TargetKind, targetId: string, chatId: string, title: string) => {
      const fid = String(folderId || '')
      const kind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'
      const tid = String(targetId || '')
      const cid = String(chatId || '')
      if (!fid || !tid || !cid) return
      e.preventDefault()
      e.stopPropagation()
      setFavoriteChatMenu({ folderId: fid, targetKind: kind, targetId: tid, chatId: cid, title: String(title ?? ''), x: e.clientX, y: e.clientY })
    },
  )

  React.useEffect(() => {
    if (!favoriteDialog.open) return
    setFavoriteCheckedFolderIds((p) => p.filter((id) => favoriteFolders.some((f: any) => String(f?.id || '') === String(id || ''))))
  }, [favoriteDialog.open, favoriteFolders])

  React.useEffect(() => {
    if (!moveFavoriteFolderContents.open) return
    const fid = String(moveFavoriteFolderContents.folderId || '')
    setMoveFavoriteFolderContents((p) => {
      const cur = String(p.targetFolderId || '')
      if (cur && cur !== fid && favoriteFolders.some((f: any) => String(f?.id || '') === cur)) return p
      const fallback = favoriteFolders.find((f: any) => String(f?.id || '') !== fid) || null
      return { ...p, targetFolderId: String((fallback as any)?.id || '') }
    })
  }, [moveFavoriteFolderContents.open, moveFavoriteFolderContents.folderId, favoriteFolders])

  React.useEffect(() => {
    if (!moveFavoriteFolderDialog.open) return
    const fid = String(moveFavoriteFolderDialog.folderId || '')
    const subtree = new Set(collectFavoriteFolderSubtreeIds(fid))
    setMoveFavoriteFolderDialog((p) => {
      const cur = String(p.parentId || '')
      if (!cur) return p
      if (cur !== fid && !subtree.has(cur) && favoriteFolders.some((f: any) => String(f?.id || '') === cur)) return p
      return { ...p, parentId: '' }
    })
  }, [moveFavoriteFolderDialog.open, moveFavoriteFolderDialog.folderId, favoriteFolders, collectFavoriteFolderSubtreeIds])

  const renderFavoriteFolderPicker = React.useCallback(
    (parentId = '', depth = 0): React.ReactNode => {
      const items = favoriteChildrenMap[String(parentId || '')] || []
      return items.map((folder: any) => {
        const fid = String(folder?.id || '')
        const children = favoriteChildrenMap[fid] || []
        const expanded = !!favoriteFolderExpanded[fid]
        return (
          <React.Fragment key={`pick-${fid}`}>
            <ListItemButton sx={{ ...SOFT_POPOVER_ITEM_SX, pl: 1 + depth * 2, pr: 1 }} onClick={() => toggleFavoriteFolderChecked(fid)}>
              <Checkbox
                size="small"
                edge="start"
                checked={favoriteCheckedFolderIds.includes(fid)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleFavoriteFolderChecked(fid)}
              />
              {children.length ? (
                <IconButton
                  size="small"
                  edge="start"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavoriteFolderExpanded(fid)
                  }}
                  sx={{ mr: 0.5 }}
                >
                  {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
              ) : (
                <Box sx={{ width: 28 }} />
              )}
              <FolderOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', ml: 0.5, mr: 1 }} />
              <ListItemText primary={String(folder?.name || '未命名文件夹')} />
            </ListItemButton>
            {children.length ? <Collapse in={expanded}>{renderFavoriteFolderPicker(fid, depth + 1)}</Collapse> : null}
          </React.Fragment>
        )
      })
    },
    [favoriteChildrenMap, favoriteFolderExpanded, favoriteCheckedFolderIds, toggleFavoriteFolderExpanded, toggleFavoriteFolderChecked],
  )

  const renderFavoriteFolderSinglePicker = React.useCallback(
    (selectedId: string, onSelect: (folderId: string) => void, options?: { includeRoot?: boolean; filter?: (folder: any) => boolean }, parentId = '', depth = 0): React.ReactNode => {
      const items = favoriteChildrenMap[String(parentId || '')] || []
      const nodes: React.ReactNode[] = []
      if (!parentId && options?.includeRoot) {
        nodes.push(
          <ListItemButton key="pick-root" sx={{ ...SOFT_POPOVER_ITEM_SX, pl: 1, pr: 1 }} selected={!selectedId} onClick={() => onSelect('')}>
            <Box sx={{ width: 20 }} />
            <FolderOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', ml: 0.5, mr: 1 }} />
            <ListItemText primary="顶层" secondary="移动到最外层" />
          </ListItemButton>,
        )
      }
      for (const folder of items) {
        if (options?.filter && !options.filter(folder)) continue
        const fid = String(folder?.id || '')
        const children = favoriteChildrenMap[fid] || []
        const visibleChildren = options?.filter ? children.filter((child: any) => options.filter?.(child)) : children
        const expanded = !!favoriteFolderExpanded[fid]
        nodes.push(
          <React.Fragment key={`single-pick-${fid}`}>
            <ListItemButton sx={{ ...SOFT_POPOVER_ITEM_SX, pl: 1 + depth * 2, pr: 1 }} selected={selectedId === fid} onClick={() => onSelect(fid)}>
              {visibleChildren.length ? (
                <IconButton
                  size="small"
                  edge="start"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavoriteFolderExpanded(fid)
                  }}
                  sx={{ mr: 0.5 }}
                >
                  {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
              ) : (
                <Box sx={{ width: 28 }} />
              )}
              <FolderOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', ml: 0.5, mr: 1 }} />
              <ListItemText primary={String(folder?.name || '未命名文件夹')} />
            </ListItemButton>
            {visibleChildren.length ? <Collapse in={expanded}>{renderFavoriteFolderSinglePicker(selectedId, onSelect, options, fid, depth + 1)}</Collapse> : null}
          </React.Fragment>,
        )
      }
      return nodes
    },
    [favoriteChildrenMap, favoriteFolderExpanded, toggleFavoriteFolderExpanded],
  )

  const renderFavoriteFolderTree = React.useCallback(
    (parentId = '', depth = 0): React.ReactNode => {
      const q = String(favoriteSearchText || '').trim().toLowerCase()
      const itemMatches = (folder: any, refs: any[]) => {
        if (!q) return true
        const folderName = String(folder?.name || '').toLowerCase()
        if (folderName.includes(q)) return true
        for (const ref of refs) {
          const targetKindText = String(ref?.targetKind || '').trim()
          const targetKind = targetKindText === 'group' ? 'group' : targetKindText === 'workspace' ? 'workspace' : 'role'
          const targetId = String(ref?.targetId || '')
          const chatId = String(ref?.chatId || '')
          const chat = getChatByFavoriteRef(targetKind as any, targetId, chatId)
          const targetMeta = getFavoriteTargetMeta(targetKind as any, targetId)
          const hay = [
            String((chat as any)?.title || ''),
            snippetText((chat as any)?.lastMessagePreview || (Array.isArray((chat as any)?.messages) ? (chat as any).messages : []).slice(-1)[0]?.content || ''),
            String(targetMeta?.name || ''),
          ]
            .join('\n')
            .toLowerCase()
          if (hay.includes(q)) return true
        }
        return false
      }
      const renderNode = (folder: any, depth2: number): React.ReactNode => {
        const fid = String(folder?.id || '')
        const children = favoriteChildrenMap[fid] || []
        const refs = Array.isArray((favoriteChatRefsByFolderId as any)?.[fid]) ? (favoriteChatRefsByFolderId as any)[fid] : []
        const visibleChildren = children
          .map((child: any) => renderNode(child, depth2 + 1))
          .filter(isRenderableNode)
        const visibleRefs = refs
          .map((ref: any) => {
            const targetKindText = String(ref?.targetKind || '').trim()
            const targetKind = targetKindText === 'group' ? 'group' : targetKindText === 'workspace' ? 'workspace' : 'role'
            const targetId = String(ref?.targetId || '')
            const chatId = String(ref?.chatId || '')
            const chat = getChatByFavoriteRef(targetKind as any, targetId, chatId)
            if (!chat) return null
            const targetMeta = getFavoriteTargetMeta(targetKind as any, targetId)
            const targetName = String(targetMeta?.name || (targetKind === 'group' ? '群聊' : targetKind === 'workspace' ? '工作区' : '角色'))
            const snippet = snippetText((chat as any)?.lastMessagePreview || (Array.isArray((chat as any)?.messages) ? (chat as any).messages : []).slice(-1)[0]?.content || '')
            const selected = targetKind === activeTargetKind && String(targetId || '') === activeChatTargetId && String(chatId || '') === activeChatId
            const indicatorKind = chatSessionRunIndicatorKind(targetKind as any, targetId, chat, selected)
            if (q) {
              const hay = [String((chat as any)?.title || ''), snippet, targetName].join('\n').toLowerCase()
              if (!hay.includes(q)) return null
            }
            return (
              <ListItemButton
                key={`${fid}:${targetKind}:${targetId}:${chatId}`}
                selected={selected}
                sx={{ ...SOFT_POPOVER_ITEM_TOP_SX, pl: 3 + depth2 * 2, pr: 1, gap: 1 }}
                onClick={() => openFavoritedChat(targetKind as any, targetId, chatId)}
                onContextMenu={(e) => onFavoriteChatContextMenu(e, fid, targetKind as any, targetId, chatId, String((chat as any)?.title || ''))}
              >
                <Stack spacing={0.5} alignItems="center" sx={{ width: 48, flex: '0 0 48px', pt: 0.25 }}>
                  <Avatar src={String(targetMeta?.avatarImage || '') || undefined} sx={{ width: 28, height: 28, fontSize: 14 }}>
                    {String(targetMeta?.avatar || (targetKind === 'group' ? '👥' : targetKind === 'workspace' ? '📁' : '🙂'))}
                  </Avatar>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%' }}>
                    {targetName}
                  </Typography>
                </Stack>
                <ListItemText sx={{ minWidth: 0, mt: 0.25 }} primary={String((chat as any)?.title || (targetKind === 'group' ? '群聊' : targetKind === 'workspace' ? '工作区会话' : '新聊天'))} secondary={snippet} />
                {indicatorKind ? <ChatSessionRunIndicator kind={indicatorKind} /> : null}
              </ListItemButton>
            )
          })
          .filter(isRenderableNode)
        if (!itemMatches(folder, refs) && !visibleChildren.length && !visibleRefs.length) return null
        const expanded = q ? true : favoriteFolderExpanded[fid] ?? true
        return (
          <React.Fragment key={fid}>
            <ListItemButton
              sx={{ ...SOFT_POPOVER_ITEM_SX, pl: 1 + depth2 * 2, pr: 1 }}
              onClick={() => toggleFavoriteFolderExpanded(fid)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const folderParentId = String(folder?.parentId || '')
                setFavoriteFolderMenu({ folderId: fid, x: e.clientX, y: e.clientY, parentId: folderParentId })
              }}
            >
              {visibleChildren.length || visibleRefs.length ? expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" /> : <Box sx={{ width: 20 }} />}
              <FolderOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', ml: 0.5, mr: 1 }} />
              <ListItemText primary={String(folder?.name || '未命名文件夹')} secondary={visibleRefs.length ? `${visibleRefs.length} 条收藏` : undefined} />
            </ListItemButton>
            <Collapse in={expanded}>
              {visibleChildren}
              {visibleRefs}
            </Collapse>
          </React.Fragment>
        )
      }
      const items = favoriteChildrenMap[String(parentId || '')] || []
      return items.map((folder: any) => renderNode(folder, depth)).filter(isRenderableNode)
    },
    [
      favoriteChildrenMap,
      favoriteChatRefsByFolderId,
      favoriteFolderExpanded,
      favoriteSearchText,
      getChatByFavoriteRef,
      getFavoriteTargetMeta,
      activeTargetKind,
      activeChatTargetId,
      activeChatId,
      chatSessionRunIndicatorKind,
      openFavoritedChat,
      toggleFavoriteFolderExpanded,
    ],
  )

  return {
    favoriteFolders,
    favoriteChatRefsByFolderId,
    favoriteChildrenMap,
    collectFavoriteFolderSubtreeIds,
    getChatByFavoriteRef,
    getFavoriteTargetMeta,
    favoriteSearchOpen,
    setFavoriteSearchOpen,
    favoriteSearchText,
    setFavoriteSearchText,
    favoriteSearchInputRef,
    favoriteFolderExpanded,
    favoriteDialog,
    setFavoriteDialog,
    favoriteCheckedFolderIds,
    setFavoriteCheckedFolderIds,
    createFavoriteFolder,
    setCreateFavoriteFolder,
    favoriteFolderMenu,
    setFavoriteFolderMenu,
    renameFavoriteFolder,
    setRenameFavoriteFolder,
    confirmDeleteFavoriteFolder,
    setConfirmDeleteFavoriteFolder,
    moveFavoriteFolderContents,
    setMoveFavoriteFolderContents,
    moveFavoriteFolderDialog,
    setMoveFavoriteFolderDialog,
    confirmClearFavoriteFolder,
    setConfirmClearFavoriteFolder,
    favoriteChatMenu,
    setFavoriteChatMenu,
    openCreateFavoriteFolder,
    closeCreateFavoriteFolder,
    closeFavoriteFolderMenu,
    openRenameFavoriteFolder,
    closeRenameFavoriteFolder,
    submitRenameFavoriteFolder,
    openDeleteFavoriteFolderConfirm,
    closeDeleteFavoriteFolderConfirm,
    closeMoveFavoriteFolderContents,
    closeMoveFavoriteFolderDialog,
    closeConfirmClearFavoriteFolder,
    submitDeleteFavoriteFolder,
    submitMoveFavoriteFolderContents,
    submitClearFavoriteFolder,
    submitMoveFavoriteFolder,
    collapseAllFavoriteFolders,
    toggleFavoriteFolderExpanded,
    toggleFavoriteFolderChecked,
    openFavoriteDialog,
    closeFavoriteDialog,
    saveFavoriteDialog,
    submitCreateFavoriteFolder,
    openFavoritedChat,
    closeFavoriteChatMenu,
    onFavoriteChatContextMenu,
    renderFavoriteFolderPicker,
    renderFavoriteFolderSinglePicker,
    renderFavoriteFolderTree,
  }
}
