import * as React from 'react'
import {
  Box,
  Collapse,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { ChatSessionRunIndicator, type ChatSessionRunIndicatorKind } from '../components/ChatSessionRunIndicator'
import { SOFT_POPOVER_HEADER_SX, SOFT_POPOVER_ITEM_TOP_SX, SOFT_POPOVER_LIST_SX, SOFT_POPOVER_PAPER_SX } from '../softPopoverStyles'
import { sortChatListItemsForDisplay } from '../../domain/chatListOrdering'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import { chatHistoryMatchesSearch } from '../utils/text'

export function ChatPickerPopover(props: {
  controller: any
  data: any
  chatPickerEl: HTMLElement | null
  closeChatPicker: () => void
  chatPickerView: 'history' | 'favorites'
  setChatPickerView: React.Dispatch<React.SetStateAction<'history' | 'favorites'>>
  chatPickerSearchOpen: boolean
  setChatPickerSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  chatPickerSearchText: string
  setChatPickerSearchText: React.Dispatch<React.SetStateAction<string>>
  chatPickerSearchInputRef: React.MutableRefObject<HTMLInputElement | null>
  chatHistoryScrollRef: any
  onChatHistoryScrollPositionChange: (position: any) => void
  chatHistoryVisibleCount: number
  favoriteSearchOpen: boolean
  setFavoriteSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  favoriteSearchText: string
  setFavoriteSearchText: React.Dispatch<React.SetStateAction<string>>
  favoriteSearchInputRef: React.MutableRefObject<HTMLInputElement | null>
  favoriteFolders: any[]
  renderFavoriteFolderTree: (parentId?: string, depth?: number) => React.ReactNode
  collapseAllFavoriteFolders: () => void
  openCreateFavoriteFolder: (parentId?: string) => void
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeGroup: any
  activeWorkspace: any
  activeRole: any
  activeChatTargetId: string
  pendingGroupChat: any
  pendingWorkspaceChat: any
  pendingRoleChat: any
  chatSessionRunIndicatorKind: (targetKind: 'role' | 'group' | 'workspace', targetId: string, chat: any, selected: boolean) => ChatSessionRunIndicatorKind | ''
  clearChatSessionRunNotice: (targetKind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => void
  requestSwitch: (chatId: any, opts?: any) => void
  onChatContextMenu: (e: React.MouseEvent, targetKind: 'role' | 'group' | 'workspace', targetId: string, chatId: string, title: string) => void
}) {
  const {
    controller,
    data,
    chatPickerEl,
    closeChatPicker,
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
    favoriteSearchOpen,
    setFavoriteSearchOpen,
    favoriteSearchText,
    setFavoriteSearchText,
    favoriteSearchInputRef,
    favoriteFolders,
    renderFavoriteFolderTree,
    collapseAllFavoriteFolders,
    openCreateFavoriteFolder,
    activeTargetKind,
    activeGroup,
    activeWorkspace,
    activeRole,
    activeChatTargetId,
    pendingGroupChat,
    pendingWorkspaceChat,
    pendingRoleChat,
    chatSessionRunIndicatorKind,
    clearChatSessionRunNotice,
    requestSwitch,
    onChatContextMenu,
  } = props

  return (
    <Popover
      open={!!chatPickerEl}
      anchorEl={chatPickerEl}
      onClose={closeChatPicker}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      PaperProps={{ sx: SOFT_POPOVER_PAPER_SX }}
    >
      <Box sx={{ width: 420, maxHeight: '70vh', overflow: 'hidden' }}>
        <Box
          sx={{
            width: 840,
            display: 'flex',
            transform: chatPickerView === 'favorites' ? 'translateX(-420px)' : 'translateX(0)',
            transition: 'transform 220ms ease',
          }}
        >
          <CustomScrollArea ref={chatHistoryScrollRef} onScrollPositionChange={onChatHistoryScrollPositionChange} hostSx={{ width: 420, maxHeight: '70vh', flex: '0 0 420px' }} scrollSx={{ maxHeight: '70vh' }}>
            <Box sx={SOFT_POPOVER_HEADER_SX}>
              <Tooltip title={chatPickerSearchOpen ? '关闭搜索' : '搜索'}>
                <IconButton
                  size="small"
                  onClick={() => {
                    setChatPickerSearchOpen((p) => !p)
                    if (chatPickerSearchOpen) setChatPickerSearchText('')
                  }}
                >
                  {chatPickerSearchOpen ? <CloseIcon fontSize="inherit" /> : <SearchIcon fontSize="inherit" />}
                </IconButton>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Tooltip title="收藏夹">
                <IconButton size="small" onClick={() => setChatPickerView('favorites')}>
                  <StarBorderRoundedIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </Box>
            <Collapse in={chatPickerSearchOpen}>
              <Box sx={{ px: 1.5, pb: 1 }}>
                <TextField
                  inputRef={chatPickerSearchInputRef}
                  fullWidth
                  size="small"
                  placeholder="搜索会话…"
                  value={String(chatPickerSearchText || '')}
                  onChange={(e) => setChatPickerSearchText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setChatPickerSearchOpen(false)
                      setChatPickerSearchText('')
                    }
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
            </Collapse>
            {(() => {
              if (activeTargetKind === 'group') {
                if (!activeGroup) {
                  return (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        先选择群组
                      </Typography>
                    </Box>
                  )
                }
                const box = (data as any)?.chatsByGroup?.[String((activeGroup as any).id || '')]
                const chats = sortChatListItemsForDisplay(Array.isArray(box?.chatMetas) && box.chatMetas.length ? box.chatMetas : Array.isArray(box?.chats) ? box.chats : [])
                const activeChatId = String(box?.activeChatId || '')
                const pendingChat =
                  pendingGroupChat && String(pendingGroupChat?.groupId || '') === String((activeGroup as any)?.id || '')
                    ? pendingGroupChat.chat
                    : null
                const hasPending = !!pendingChat
                const showPending = hasPending && chatHistoryMatchesSearch(pendingChat, '群聊', chatPickerSearchText)
                const shownChats = chats.filter((c: any) => chatHistoryMatchesSearch(c, '群聊', chatPickerSearchText)).slice(0, chatHistoryVisibleCount)
                if (!showPending && !shownChats.length) {
                  return (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        没有匹配的会话
                      </Typography>
                    </Box>
                  )
                }
                return (
                  <List dense sx={SOFT_POPOVER_LIST_SX}>
                    {showPending ? (
                      <ListItemButton selected sx={SOFT_POPOVER_ITEM_TOP_SX}>
                        <ListItemText
                          sx={{ minWidth: 0 }}
                          primary={
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                              <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                                {String(pendingChat?.title || '群聊')}（未发送）
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {controller.fmtTime(Number(pendingChat?.updatedAt || pendingChat?.createdAt || 0))}
                              </Typography>
                            </Stack>
                          }
                          secondary={
                            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
                              （草稿）
                            </Typography>
                          }
                        />
                      </ListItemButton>
                    ) : null}
                    {shownChats.map((c: any) => {
                      const on = !showPending && String(c?.id || '') === activeChatId
                      const raw = String(c?.lastMessagePreview || '').replace(/\s+/g, ' ').trim()
                      const snippet = raw.length > 40 ? raw.slice(0, 40) + '…' : raw
                      const time = controller.fmtTime(Number(c?.updatedAt || c?.createdAt || 0))
                      const indicatorKind = chatSessionRunIndicatorKind('group', String((activeGroup as any)?.id || ''), c, on)
                      return (
                        <ListItemButton
                          key={String(c?.id || '')}
                          selected={on}
                          onClick={() => {
                            clearChatSessionRunNotice('group', String((activeGroup as any)?.id || ''), String(c?.id || ''))
                            requestSwitch(String(c?.id || ''))
                            closeChatPicker()
                          }}
                          onContextMenu={(e) =>
                            onChatContextMenu(e, 'group', String((activeGroup as any)?.id || ''), String(c?.id || ''), String(c?.title || '群聊'))
                          }
                          sx={SOFT_POPOVER_ITEM_TOP_SX}
                        >
                          <ListItemText
                            sx={{ minWidth: 0 }}
                            primary={
                              <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                                  {String(c?.title || '群聊')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {time}
                                </Typography>
                                {indicatorKind ? <ChatSessionRunIndicator kind={indicatorKind} /> : null}
                              </Stack>
                            }
                            secondary={
                              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
                                {snippet || '（空）'}
                              </Typography>
                            }
                          />
                        </ListItemButton>
                      )
                    })}
                  </List>
                )
              }

              if (activeTargetKind === 'workspace') {
                if (!activeWorkspace) {
                  return (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        先选择工作区
                      </Typography>
                    </Box>
                  )
                }
                const box = (data as any)?.chatsByWorkspace?.[String(activeChatTargetId || '')]
                const chats = sortChatListItemsForDisplay(Array.isArray(box?.chatMetas) && box.chatMetas.length ? box.chatMetas : Array.isArray(box?.chats) ? box.chats : [])
                const activeChatId = String(box?.activeChatId || '')
                const pendingChat =
                  pendingWorkspaceChat && workspaceRoleTargetId(pendingWorkspaceChat?.workspaceId, pendingWorkspaceChat?.roleId) === String(activeChatTargetId || '')
                    ? pendingWorkspaceChat.chat
                    : null
                const hasPending = !!pendingChat
                const showPending = hasPending && chatHistoryMatchesSearch(pendingChat, '工作区会话', chatPickerSearchText)
                const shownChats = chats.filter((c: any) => chatHistoryMatchesSearch(c, '工作区会话', chatPickerSearchText)).slice(0, chatHistoryVisibleCount)
                if (!showPending && !shownChats.length) {
                  return (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        没有匹配的会话
                      </Typography>
                    </Box>
                  )
                }
                return (
                  <List dense sx={SOFT_POPOVER_LIST_SX}>
                    {showPending ? (
                      <ListItemButton selected sx={SOFT_POPOVER_ITEM_TOP_SX}>
                        <ListItemText
                          sx={{ minWidth: 0 }}
                          primary={
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                              <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                                {String(pendingChat?.title || '工作区会话')}（未发送）
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {controller.fmtTime(Number(pendingChat?.updatedAt || pendingChat?.createdAt || 0))}
                              </Typography>
                            </Stack>
                          }
                          secondary={
                            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
                              （草稿）
                            </Typography>
                          }
                        />
                      </ListItemButton>
                    ) : null}
                    {shownChats.map((c: any) => {
                      const on = !showPending && String(c?.id || '') === activeChatId
                      const raw = String(c?.lastMessagePreview || '').replace(/\s+/g, ' ').trim()
                      const snippet = raw.length > 40 ? raw.slice(0, 40) + '…' : raw
                      const time = controller.fmtTime(Number(c?.updatedAt || c?.createdAt || 0))
                      const indicatorKind = chatSessionRunIndicatorKind('workspace', String(activeChatTargetId || ''), c, on)
                      return (
                        <ListItemButton
                          key={String(c?.id || '')}
                          selected={on}
                          onClick={() => {
                            clearChatSessionRunNotice('workspace', String(activeChatTargetId || ''), String(c?.id || ''))
                            requestSwitch(String(c?.id || ''))
                            closeChatPicker()
                          }}
                          onContextMenu={(e) =>
                            onChatContextMenu(e, 'workspace', String(activeChatTargetId || ''), String(c?.id || ''), String(c?.title || '工作区会话'))
                          }
                          sx={SOFT_POPOVER_ITEM_TOP_SX}
                        >
                          <ListItemText
                            sx={{ minWidth: 0 }}
                            primary={
                              <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                                  {String(c?.title || '工作区会话')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {time}
                                </Typography>
                                {indicatorKind ? <ChatSessionRunIndicator kind={indicatorKind} /> : null}
                              </Stack>
                            }
                            secondary={
                              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
                                {snippet || '（空）'}
                              </Typography>
                            }
                          />
                        </ListItemButton>
                      )
                    })}
                  </List>
                )
              }

              const role = activeRole
              if (!role) {
                return (
                  <Box sx={{ p: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      先选择角色
                    </Typography>
                  </Box>
                )
              }
              const box = data?.chatsByRole?.[String(role.id)]
              const chats = sortChatListItemsForDisplay(Array.isArray(box?.chatMetas) && box.chatMetas.length ? box.chatMetas : Array.isArray(box?.chats) ? box.chats : [])
              const activeChatId = String(box?.activeChatId || '')
              const pendingChat = pendingRoleChat && String(pendingRoleChat?.roleId || '') === String(role.id) ? pendingRoleChat.chat : null
              const hasPending = !!pendingChat
              const showPending = hasPending && chatHistoryMatchesSearch(pendingChat, '新聊天', chatPickerSearchText)
              const shownChats = chats.filter((c: any) => chatHistoryMatchesSearch(c, '新聊天', chatPickerSearchText)).slice(0, chatHistoryVisibleCount)
              if (!showPending && !shownChats.length) {
                return (
                  <Box sx={{ p: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      没有匹配的会话
                    </Typography>
                  </Box>
                )
              }
              return (
                <List dense sx={SOFT_POPOVER_LIST_SX}>
                  {showPending ? (
                    <ListItemButton selected sx={SOFT_POPOVER_ITEM_TOP_SX}>
                      <ListItemText
                        sx={{ minWidth: 0 }}
                        primary={
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                              {String(pendingChat?.title || '新聊天')}（未发送）
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {controller.fmtTime(Number(pendingChat?.updatedAt || pendingChat?.createdAt || 0))}
                            </Typography>
                          </Stack>
                        }
                        secondary={
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
                            （草稿）
                          </Typography>
                        }
                      />
                    </ListItemButton>
                  ) : null}
                  {shownChats.map((c: any) => {
                    const on = !showPending && String(c?.id || '') === activeChatId
                    const raw = String(c?.lastMessagePreview || '').replace(/\s+/g, ' ').trim()
                    const snippet = raw.length > 40 ? raw.slice(0, 40) + '…' : raw
                    const time = controller.fmtTime(Number(c?.updatedAt || c?.createdAt || 0))
                    const indicatorKind = chatSessionRunIndicatorKind('role', String(role?.id || ''), c, on)
                    return (
                      <ListItemButton
                        key={String(c?.id || '')}
                        selected={on}
                        onClick={() => {
                          clearChatSessionRunNotice('role', String(role?.id || ''), String(c?.id || ''))
                          requestSwitch(String(c?.id || ''))
                          closeChatPicker()
                        }}
                        onContextMenu={(e) =>
                          onChatContextMenu(e, 'role', String(role?.id || ''), String(c?.id || ''), String(c?.title || '新聊天'))
                        }
                        sx={SOFT_POPOVER_ITEM_TOP_SX}
                      >
                        <ListItemText
                          sx={{ minWidth: 0 }}
                          primary={
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                              <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                                {String(c?.title || '新聊天')}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {time}
                              </Typography>
                              {indicatorKind ? <ChatSessionRunIndicator kind={indicatorKind} /> : null}
                            </Stack>
                          }
                          secondary={
                            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
                              {snippet || '（空）'}
                            </Typography>
                          }
                        />
                      </ListItemButton>
                    )
                  })}
                </List>
              )
            })()}
          </CustomScrollArea>

          <CustomScrollArea hostSx={{ width: 420, maxHeight: '70vh', flex: '0 0 420px' }} scrollSx={{ maxHeight: '70vh' }}>
            <Box sx={SOFT_POPOVER_HEADER_SX}>
              <Tooltip title="返回历史记录">
                <IconButton size="small" onClick={() => setChatPickerView('history')}>
                  <ArrowBackRoundedIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
              <Typography sx={{ fontWeight: 800, flex: 1 }}>收藏夹</Typography>
              <Tooltip title={favoriteSearchOpen ? '关闭搜索' : '搜索'}>
                <IconButton
                  size="small"
                  onClick={() => {
                    setFavoriteSearchOpen((p) => !p)
                    if (favoriteSearchOpen) setFavoriteSearchText('')
                  }}
                >
                  {favoriteSearchOpen ? <CloseIcon fontSize="inherit" /> : <SearchIcon fontSize="inherit" />}
                </IconButton>
              </Tooltip>
              <Tooltip title="折叠全部">
                <span>
                  <IconButton size="small" onClick={collapseAllFavoriteFolders} disabled={!favoriteFolders.length}>
                    <UnfoldLessIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="新建文件夹">
                <IconButton size="small" onClick={() => openCreateFavoriteFolder('')}>
                  <AddIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </Box>
            <Collapse in={favoriteSearchOpen}>
              <Box sx={{ px: 1.5, pb: 1 }}>
                <TextField
                  inputRef={favoriteSearchInputRef}
                  fullWidth
                  size="small"
                  placeholder="搜索收藏夹…"
                  value={String(favoriteSearchText || '')}
                  onChange={(e) => setFavoriteSearchText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setFavoriteSearchOpen(false)
                      setFavoriteSearchText('')
                    }
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
            </Collapse>
            {!favoriteFolders.length ? (
              <Box sx={{ p: 2.5 }}>
                <Typography variant="body2" color="text.secondary">
                  还没有收藏夹，点击右上角加号新建。
                </Typography>
              </Box>
            ) : (
              <List dense sx={SOFT_POPOVER_LIST_SX}>{renderFavoriteFolderTree('', 0)}</List>
            )}
          </CustomScrollArea>
        </Box>
      </Box>
    </Popover>
  )
}
