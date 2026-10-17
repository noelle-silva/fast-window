import { Box, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material'
import { ChatSessionRunIndicator, type ChatSessionRunIndicatorKind } from './ChatSessionRunIndicator'
import { SOFT_POPOVER_ITEM_TOP_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'

export type SidebarSessionTargetKind = 'role' | 'workspace'

export function SidebarSessionList(props: {
  sessions: any[]
  pendingChat: any
  pendingTitle: string
  targetKind: SidebarSessionTargetKind
  targetId: string
  activeChatId: string
  fmtTime: (value: number) => string
  onSelect: (chatId: string) => void
  chatSessionRunIndicatorKind: (
    targetKind: 'role' | 'group' | 'workspace',
    targetId: string,
    chat: any,
    selected: boolean,
  ) => ChatSessionRunIndicatorKind | ''
}) {
  const {
    sessions,
    pendingChat,
    pendingTitle,
    targetKind,
    targetId,
    activeChatId,
    fmtTime,
    onSelect,
    chatSessionRunIndicatorKind,
  } = props

  const pendingId = String(pendingChat?.id || '')
  const hasPending = !!pendingId

  if (!hasPending && !sessions.length) {
    return (
      <Box sx={{ px: 1.5, py: 1 }}>
        <Typography variant="body2" color="text.secondary">
          还没有会话。
        </Typography>
      </Box>
    )
  }

  return (
    <List dense sx={SOFT_POPOVER_LIST_SX}>
      {hasPending ? (
        <ListItemButton selected sx={SOFT_POPOVER_ITEM_TOP_SX}>
          <ListItemText
            sx={{ minWidth: 0 }}
            primary={
              <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                  {String(pendingChat?.title || pendingTitle)}（未发送）
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {fmtTime(Number(pendingChat?.updatedAt || pendingChat?.createdAt || 0))}
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
      {sessions.map((chat: any) => {
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
            sx={SOFT_POPOVER_ITEM_TOP_SX}
          >
            <ListItemText
              sx={{ minWidth: 0 }}
              primary={
                <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 900, fontSize: 13, flex: 1, minWidth: 0 }} noWrap>
                    {String(chat?.title || pendingTitle)}
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
