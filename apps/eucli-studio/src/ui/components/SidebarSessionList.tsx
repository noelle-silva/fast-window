import * as React from 'react'
import { Box, List, ListItemAvatar, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import { ChatSessionRunIndicator, type ChatSessionRunIndicatorKind } from './ChatSessionRunIndicator'
import { EntityAvatar } from './avatar/EntityAvatar'
import { SOFT_POPOVER_ITEM_TOP_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'
import { chatHistoryMatchesSearch } from '../utils/text'
import { useLazyListWindow } from '../hooks/useLazyListWindow'
import { SidebarScrollArea } from './sidebar/SidebarScrollArea'
import { SidebarSectionTitle } from './sidebar/SidebarSection'

export type SidebarSessionTargetKind = 'role' | 'workspace'

const SESSION_PAGE_SIZE = 20
const SESSION_BOTTOM_THRESHOLD_RATIO = 0.25

export function SidebarSessionList(props: {
  title: string
  sessions: any[]
  pendingChat: any
  pendingTitle: string
  roleAvatarImage: string
  searchText: string
  targetKind: SidebarSessionTargetKind
  targetId: string
  activeChatId: string
  fmtTime: (value: number) => string
  onSelect: (chatId: string) => void
  onContextMenu: (
    event: React.MouseEvent,
    targetKind: SidebarSessionTargetKind,
    targetId: string,
    chatId: string,
    title: string,
  ) => void
  chatSessionRunIndicatorKind: (
    targetKind: 'role' | 'group' | 'workspace',
    targetId: string,
    chat: any,
    selected: boolean,
  ) => ChatSessionRunIndicatorKind | ''
}) {
  const {
    title,
    sessions,
    pendingChat,
    pendingTitle,
    roleAvatarImage,
    searchText,
    targetKind,
    targetId,
    activeChatId,
    fmtTime,
    onSelect,
    onContextMenu,
    chatSessionRunIndicatorKind,
  } = props

  const query = String(searchText || '').trim()
  const { visiblePending, visibleSessions } = React.useMemo(() => {
    const nextPending = pendingChat && chatHistoryMatchesSearch(pendingChat, pendingTitle, query)
      ? pendingChat
      : null
    const nextSessions = query
      ? sessions.filter((chat: any) => chatHistoryMatchesSearch(chat, pendingTitle, query))
      : sessions
    return { visiblePending: nextPending, visibleSessions: nextSessions }
  }, [pendingChat, pendingTitle, query, sessions])

  const { scrollRef, onScrollPositionChange, visibleCount } = useLazyListWindow({
    resetKey: [targetKind, targetId, query].join(':'),
    total: visibleSessions.length,
    pageSize: SESSION_PAGE_SIZE,
    bottomThresholdRatio: SESSION_BOTTOM_THRESHOLD_RATIO,
  })

  const pendingId = String(visiblePending?.id || '')
  const hasPending = !!pendingId
  const pageSessions = visibleSessions.slice(0, visibleCount)

  const sessionText = (sessionTitle: string, snippet: string, time: string, indicatorKind?: ChatSessionRunIndicatorKind | '') => (
    <ListItemText
      sx={{ minWidth: 0 }}
      primary={
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
            {sessionTitle}
          </Typography>
          {indicatorKind ? <ChatSessionRunIndicator kind={indicatorKind} /> : null}
        </Stack>
      }
      secondary={
        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
            {snippet}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
            {time}
          </Typography>
        </Stack>
      }
    />
  )

  return (
    <SidebarScrollArea scrollRef={scrollRef} onScrollPositionChange={onScrollPositionChange}>
      <SidebarSectionTitle>{title}</SidebarSectionTitle>
      {!hasPending && !visibleSessions.length ? (
        <Box sx={{ px: 1.5, py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {query ? '没有匹配的会话。' : '还没有会话。'}
          </Typography>
        </Box>
      ) : (
        <List dense sx={SOFT_POPOVER_LIST_SX}>
          {hasPending ? (
            <ListItemButton selected sx={SOFT_POPOVER_ITEM_TOP_SX}>
              <ListItemAvatar sx={{ alignSelf: 'center' }}>
                <EntityAvatar kind="role" image={roleAvatarImage} size={42} />
              </ListItemAvatar>
              {sessionText(
                `${String(visiblePending?.title || pendingTitle)}（未发送）`,
                '（草稿）',
                fmtTime(Number(visiblePending?.updatedAt || visiblePending?.createdAt || 0)),
              )}
            </ListItemButton>
          ) : null}
          {pageSessions.map((chat: any) => {
            const chatId = String(chat?.id || '')
            const selected = !hasPending && chatId === activeChatId
            const raw = String(chat?.lastMessagePreview || '').replace(/\s+/g, ' ').trim()
            const snippet = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw
            const time = fmtTime(Number(chat?.updatedAt || chat?.createdAt || 0))
            const indicatorKind = chatSessionRunIndicatorKind(targetKind, targetId, chat, selected)
            return (
              <ListItemButton
                key={chatId}
                selected={selected}
                onClick={() => onSelect(chatId)}
                onContextMenu={(event) => onContextMenu(
                  event,
                  targetKind,
                  targetId,
                  chatId,
                  String(chat?.title || pendingTitle),
                )}
                sx={SOFT_POPOVER_ITEM_TOP_SX}
              >
                <ListItemAvatar sx={{ alignSelf: 'center' }}>
                  <EntityAvatar kind="role" image={roleAvatarImage} size={42} />
                </ListItemAvatar>
                {sessionText(
                  String(chat?.title || pendingTitle),
                  snippet || '（空）',
                  time,
                  indicatorKind,
                )}
              </ListItemButton>
            )
          })}
        </List>
      )}
    </SidebarScrollArea>
  )
}
