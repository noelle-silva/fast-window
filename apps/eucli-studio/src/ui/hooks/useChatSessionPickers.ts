import * as React from 'react'
import { sortChatListItemsForDisplay } from '../../domain/chatListOrdering'
import { chatHistoryMatchesSearch } from '../utils/text'
import { useEvent } from './useEvent'
import { useLazyListWindow } from './useLazyListWindow'

const CHAT_HISTORY_PAGE_SIZE = 20
const CHAT_HISTORY_BOTTOM_THRESHOLD_RATIO = 0.25

type TargetKind = 'role' | 'group' | 'workspace'

export function useChatSessionPickers(deps: {
  controller: any
  data: any
  loading: boolean
  page: 'chat' | 'settings'
  setPage: React.Dispatch<React.SetStateAction<'chat' | 'settings'>>
  setSettingsTab: (tab: any) => void
  activeTargetKind: TargetKind
  activeGroup: any
  activeWorkspace: any
  activeRole: any
  activeChatTargetId: any
  setFavoriteChatMenu: React.Dispatch<React.SetStateAction<{ folderId: string; targetKind: TargetKind; targetId: string; chatId: string; title: string; x: number; y: number }>>
  closeFavoriteChatMenu: () => void
  closeFavoriteFolderMenu: () => void
  closeFavoriteDialog: () => void
  closeCreateFavoriteFolder: () => void
  closeRenameFavoriteFolder: () => void
  closeDeleteFavoriteFolderConfirm: () => void
  closeMoveFavoriteFolderContents: () => void
  closeMoveFavoriteFolderDialog: () => void
  closeConfirmClearFavoriteFolder: () => void
  setFavoriteSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFavoriteSearchText: React.Dispatch<React.SetStateAction<string>>
}) {
  const {
    controller,
    data,
    loading,
    page,
    setPage,
    setSettingsTab,
    activeTargetKind,
    activeGroup,
    activeWorkspace,
    activeRole,
    activeChatTargetId,
    setFavoriteChatMenu,
    closeFavoriteChatMenu,
    closeFavoriteFolderMenu,
    closeFavoriteDialog,
    closeCreateFavoriteFolder,
    closeRenameFavoriteFolder,
    closeDeleteFavoriteFolderConfirm,
    closeMoveFavoriteFolderContents,
    closeMoveFavoriteFolderDialog,
    closeConfirmClearFavoriteFolder,
    setFavoriteSearchOpen,
    setFavoriteSearchText,
  } = deps

  const [rolePickerEl, setRolePickerEl] = React.useState<HTMLElement | null>(null)
  const [rolePickerTab, setRolePickerTab] = React.useState<'roles' | 'groups' | 'workspaces'>('roles')
  const [rolePickerMode, setRolePickerMode] = React.useState<'global' | 'workspaceRole'>('global')
  const [chatPickerEl, setChatPickerEl] = React.useState<HTMLElement | null>(null)
  const [chatPickerView, setChatPickerView] = React.useState<'history' | 'favorites'>('history')
  const [chatPickerSearchOpen, setChatPickerSearchOpen] = React.useState(false)
  const [chatPickerSearchText, setChatPickerSearchText] = React.useState('')
  const chatPickerSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const chatHistoryTotal = React.useMemo(() => {
    if (activeTargetKind === 'group') {
      if (!activeGroup) return 0
      const box = (data as any)?.chatsByGroup?.[String((activeGroup as any).id || '')]
      const chats = sortChatListItemsForDisplay(Array.isArray(box?.chatMetas) && box.chatMetas.length ? box.chatMetas : Array.isArray(box?.chats) ? box.chats : [])
      return chats.filter((chat: any) => chatHistoryMatchesSearch(chat, '群聊', chatPickerSearchText)).length
    }
    if (activeTargetKind === 'workspace') {
      if (!activeWorkspace) return 0
      const box = (data as any)?.chatsByWorkspace?.[String(activeChatTargetId || '')]
      const chats = sortChatListItemsForDisplay(Array.isArray(box?.chatMetas) && box.chatMetas.length ? box.chatMetas : Array.isArray(box?.chats) ? box.chats : [])
      return chats.filter((chat: any) => chatHistoryMatchesSearch(chat, '工作区会话', chatPickerSearchText)).length
    }
    const role = activeRole
    if (!role) return 0
    const box = data?.chatsByRole?.[String(role.id)]
    const chats = sortChatListItemsForDisplay(Array.isArray(box?.chatMetas) && box.chatMetas.length ? box.chatMetas : Array.isArray(box?.chats) ? box.chats : [])
    return chats.filter((chat: any) => chatHistoryMatchesSearch(chat, '新聊天', chatPickerSearchText)).length
  }, [activeTargetKind, activeGroup, activeWorkspace, activeChatTargetId, activeRole, data, chatPickerSearchText])
  const { scrollRef: chatHistoryScrollRef, onScrollPositionChange: onChatHistoryScrollPositionChange, visibleCount: chatHistoryVisibleCount } = useLazyListWindow({
    resetKey: [chatPickerEl ? 'open' : 'closed', chatPickerView, activeTargetKind, activeChatTargetId, chatPickerSearchText].join(':'),
    total: chatHistoryTotal,
    pageSize: CHAT_HISTORY_PAGE_SIZE,
    bottomThresholdRatio: CHAT_HISTORY_BOTTOM_THRESHOLD_RATIO,
  })

  const [chatMenu, setChatMenu] = React.useState<{
    targetKind: TargetKind
    targetId: string
    chatId: string
    title: string
    x: number
    y: number
  }>({
    targetKind: 'role',
    targetId: '',
    chatId: '',
    title: '',
    x: 0,
    y: 0,
  })
  const [confirmDelChat, setConfirmDelChat] = React.useState<{ targetKind: TargetKind; targetId: string; chatId: string }>({
    targetKind: 'role',
    targetId: '',
    chatId: '',
  })
  const [editingChatTitle, setEditingChatTitle] = React.useState<{ targetKind: TargetKind; targetId: string; chatId: string; text: string }>({
    targetKind: 'role',
    targetId: '',
    chatId: '',
    text: '',
  })

  const closeEditingChatTitle = useEvent(() => setEditingChatTitle({ targetKind: 'role', targetId: '', chatId: '', text: '' }))
  const saveEditingChatTitle = useEvent(async () => {
    const { targetKind, targetId, chatId, text } = editingChatTitle
    if (!targetId || !chatId || loading) return
    const action = targetKind === 'group' ? controller.actions.renameGroupChat : targetKind === 'workspace' ? controller.actions.renameWorkspaceChat : controller.actions.renameChat
    const ok = await Promise.resolve(action?.(targetId, chatId, String(text ?? '')))
    if (ok === true) closeEditingChatTitle()
  })

  React.useEffect(() => {
    setChatMenu({ targetKind: 'role', targetId: '', chatId: '', title: '', x: 0, y: 0 })
    setFavoriteChatMenu({ folderId: '', targetKind: 'role', targetId: '', chatId: '', title: '', x: 0, y: 0 })
    setConfirmDelChat({ targetKind: 'role', targetId: '', chatId: '' })
    setEditingChatTitle({ targetKind: 'role', targetId: '', chatId: '', text: '' })
  }, [page, activeRole?.id, (activeGroup as any)?.id, activeTargetKind, setFavoriteChatMenu, setEditingChatTitle])

  const closeChatMenu = useEvent(() => setChatMenu({ targetKind: 'role', targetId: '', chatId: '', title: '', x: 0, y: 0 }))
  const onChatContextMenu = useEvent((e: React.MouseEvent, targetKind: TargetKind, targetId: string, chatId: string, title: string) => {
    const kind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'
    const tid = String(targetId || '')
    const cid = String(chatId || '')
    if (!tid || !cid) return
    e.preventDefault()
    e.stopPropagation()
    setChatMenu({ targetKind: kind, targetId: tid, chatId: cid, title: String(title ?? ''), x: e.clientX, y: e.clientY })
  })

  const openRolePicker = useEvent((e: React.MouseEvent<HTMLElement>) => {
    setRolePickerMode('global')
    setRolePickerTab(activeTargetKind === 'group' ? 'groups' : activeTargetKind === 'workspace' ? 'workspaces' : 'roles')
    setRolePickerEl(e.currentTarget)
  })
  const openWorkspaceRolePicker = useEvent((e: React.MouseEvent<HTMLElement>) => {
    setRolePickerMode('workspaceRole')
    setRolePickerTab('roles')
    setRolePickerEl(e.currentTarget)
  })
  const closeRolePicker = useEvent(() => {
    setRolePickerEl(null)
    setRolePickerMode('global')
  })
  const openChatPicker = useEvent((e: React.MouseEvent<HTMLElement>) => {
    setChatPickerView('history')
    setChatPickerEl(e.currentTarget)
  })
  const closeChatPicker = useEvent(() => {
    setChatPickerEl(null)
    setChatPickerView('history')
    closeChatMenu()
    closeFavoriteChatMenu()
    closeFavoriteFolderMenu()
    closeFavoriteDialog()
    closeCreateFavoriteFolder()
    closeRenameFavoriteFolder()
    closeDeleteFavoriteFolderConfirm()
    closeMoveFavoriteFolderContents()
    closeMoveFavoriteFolderDialog()
    closeConfirmClearFavoriteFolder()
    setChatPickerSearchOpen(false)
    setChatPickerSearchText('')
    setFavoriteSearchOpen(false)
    setFavoriteSearchText('')
  })

  const openPluginSettings = useEvent(
    (tab: any = 'roles') => {
      setRolePickerEl(null)
      setChatPickerEl(null)
      setChatPickerSearchOpen(false)
      setChatPickerSearchText('')
      setSettingsTab(tab)
      setPage('settings')
    })
  const closePluginSettings = useEvent(() => setPage('chat'))

  React.useEffect(() => {
    if (!chatPickerEl) return
    if (!chatPickerSearchOpen) return
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = chatPickerSearchInputRef.current
        if (!el) return
        try {
          el.focus?.()
          el.select?.()
        } catch (_) {}
      }, 0)
    })
  }, [chatPickerEl, chatPickerSearchOpen])

  return {
    rolePickerEl,
    rolePickerTab,
    setRolePickerTab,
    rolePickerMode,
    chatPickerEl,
    chatPickerView,
    setChatPickerView,
    chatPickerSearchOpen,
    setChatPickerSearchOpen,
    chatPickerSearchText,
    setChatPickerSearchText,
    chatPickerSearchInputRef,
    chatHistoryScrollRef,
    onChatHistoryScrollPositionChange,
    chatHistoryVisibleCount,
    chatMenu,
    closeChatMenu,
    onChatContextMenu,
    confirmDelChat,
    setConfirmDelChat,
    editingChatTitle,
    setEditingChatTitle,
    closeEditingChatTitle,
    saveEditingChatTitle,
    openRolePicker,
    openWorkspaceRolePicker,
    closeRolePicker,
    openChatPicker,
    closeChatPicker,
    openPluginSettings,
    closePluginSettings,
  }
}
