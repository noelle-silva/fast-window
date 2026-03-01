import * as React from 'react'
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  GlobalStyles,
  IconButton,
  InputLabel,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Popover,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChatIcon from '@mui/icons-material/Chat'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import HistoryIcon from '@mui/icons-material/History'
import ImageIcon from '@mui/icons-material/Image'
import RefreshIcon from '@mui/icons-material/Refresh'
import SettingsIcon from '@mui/icons-material/Settings'
import StorageIcon from '@mui/icons-material/Storage'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

function useAiChatState(controller: any) {
  React.useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot?.() ?? 0,
    () => controller.getSnapshot?.() ?? 0,
  )
  return controller.getState()
}

function useEvent<T extends (...args: any[]) => any>(fn: T): T {
  const ref = React.useRef(fn)
  ref.current = fn
  return React.useCallback(((...args: any[]) => ref.current(...args)) as any, [])
}

function AssistantContent(props: { controller: any; className?: string; text: string; mid: string; chatRootRef: React.RefObject<HTMLElement | null> }) {
  const { controller, className, text, mid, chatRootRef } = props
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useLayoutEffect(() => {
    if (!ref.current) return
    controller.renderAssistantInto(ref.current, text)
  }, [controller, text])

  const onClick = useEvent((e: React.MouseEvent) => {
    const t = e.target as any
    const root = chatRootRef.current
    if (!root || !(t instanceof Element)) return
    const block = t.closest?.('.mermaid-block[data-mermaid="1"]')
    if (!block) return
    controller.actions.openMermaidViewer(root, block)
  })

  return <div className={className} data-mid={mid} ref={ref} onClick={onClick} />
}

function RefImageThumb(props: { controller: any; path: string }) {
  const { controller, path } = props
  const [src, setSrc] = React.useState('')

  React.useEffect(() => {
    let alive = true
    const api = controller?.api
    if (!api?.files?.readRefImage) return
    api.files
      .readRefImage(path)
      .then((url: string) => {
        if (!alive) return
        setSrc(String(url || ''))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [controller, path])

  return (
    <Box
      component="img"
      src={src || undefined}
      alt="image"
      sx={{
        width: 160,
        height: 110,
        objectFit: 'cover',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    />
  )
}

export function AiChatApp(props: { controller: any }) {
  const { controller } = props
  const s = useAiChatState(controller)

  const theme = React.useMemo(
    () =>
      createTheme({
        palette: { mode: 'light' },
        shape: { borderRadius: 12 },
        typography: {
          fontFamily:
            'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif',
        },
      }),
    [],
  )

  const data = s.data
  const roles = Array.isArray(data?.roles) ? data.roles : []
  const providers = Array.isArray(data?.settings?.providers) ? data.settings.providers : []

  const activeRole = controller.activeRole()
  const activeChat = controller.activeChat()

  const chatRootRef = React.useRef<HTMLDivElement | null>(null)
  const lastMsg = Array.isArray(activeChat?.messages) && activeChat.messages.length ? activeChat.messages[activeChat.messages.length - 1] : null
  const lastMsgId = String(lastMsg?.id || '')
  const lastMsgText = String(lastMsg?.content || '')

  React.useEffect(() => {
    const el = chatRootRef.current
    if (!el) return
    requestAnimationFrame(() => {
      try {
        el.scrollTop = el.scrollHeight
      } catch (_) {}
    })
  }, [activeRole?.id, activeChat?.id, (activeChat?.messages || []).length, lastMsgId, lastMsgText])

  const onSend = useEvent(() => controller.actions.send())
  const onPickImages = useEvent(() => controller.actions.pickImages())

  const [page, setPage] = React.useState<'chat' | 'settings'>('chat')
  const [settingsTab, setSettingsTab] = React.useState<'roles' | 'providers'>('roles')

  const [rolePickerEl, setRolePickerEl] = React.useState<HTMLElement | null>(null)
  const [chatPickerEl, setChatPickerEl] = React.useState<HTMLElement | null>(null)

  const openRolePicker = useEvent((e: React.MouseEvent<HTMLElement>) => setRolePickerEl(e.currentTarget))
  const closeRolePicker = useEvent(() => setRolePickerEl(null))
  const openChatPicker = useEvent((e: React.MouseEvent<HTMLElement>) => setChatPickerEl(e.currentTarget))
  const closeChatPicker = useEvent(() => setChatPickerEl(null))

  const openPluginSettings = useEvent((tab: 'roles' | 'providers' = 'roles') => {
    setRolePickerEl(null)
    setChatPickerEl(null)
    setSettingsTab(tab)
    setPage('settings')
  })
  const closePluginSettings = useEvent(() => setPage('chat'))

  const onPaste = useEvent((e: React.ClipboardEvent) => {
    if (s.loading || s.sending) return
    const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : []
    const files: File[] = []
    for (const it of items) {
      if (!it || it.kind !== 'file') continue
      const type = String(it.type || '')
      if (!type.startsWith('image/')) continue
      const f = it.getAsFile?.()
      if (f) files.push(f)
    }
    if (!files.length) return
    e.preventDefault()
    controller.actions.addDraftImagesFromFiles(files)
  })

  const onKeyDown = useEvent((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  })

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          'html, body': {
            height: '100%',
            width: '100%',
            overflow: 'hidden',
            overscrollBehavior: 'none',
          },
          '#fast-window-ai-chat-root': { height: '100%', overflow: 'hidden' },
          '.prose': {
            fontSize: 14,
            lineHeight: 1.75,
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
          },
          '.prose pre': {
            overflow: 'auto',
            padding: 12,
            borderRadius: 12,
            background: '#0b1220',
            color: '#e5e7eb',
            border: '1px solid rgba(255,255,255,.06)',
          },
          '.prose code': { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace' },
          '.prose blockquote': {
            margin: '10px 0',
            padding: '8px 12px',
            borderLeft: '4px solid rgba(25,118,210,.35)',
            background: 'rgba(25,118,210,.06)',
            borderRadius: 12,
          },
          '.prose img': { maxWidth: '100%', height: 'auto' },
          '.prose table': {
            borderCollapse: 'collapse',
            width: '100%',
            maxWidth: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
            borderRadius: 12,
            display: 'block',
          },
          '.prose th, .prose td': { border: '1px solid rgba(0,0,0,.12)', padding: 8, verticalAlign: 'top' },
          '.math-block': { margin: '10px 0', overflowX: 'auto' },
          '.prose .katex, .prose .katex-display': { maxWidth: '100%' },
          '.prose span.katex': { display: 'inline-block', overflowX: 'auto', overflowY: 'hidden', verticalAlign: 'middle' },
          '.prose .katex-display': { overflowX: 'auto', overflowY: 'hidden' },
          '.prose .katex-display > .katex': { display: 'block', overflowX: 'visible' },
          '.mermaid-block': { margin: '10px 0', overflowX: 'auto', cursor: 'zoom-in' },
          '.mermaid-block svg': { maxWidth: '100%', height: 'auto', display: 'block' },
        }}
      />

      <Box sx={{ height: '100%', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="static"
          elevation={0}
          sx={{
            bgcolor: '#fff',
            color: 'text.primary',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Toolbar
            variant="dense"
           sx={{
             gap: 0.5,
             minHeight: 40,
             px: 1,
             '&.MuiToolbar-root': { minHeight: 40 },
           }}
          >
            {page === 'settings' ? (
              <>
                <IconButton onClick={closePluginSettings} size="small">
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>

                <Typography variant="subtitle2" sx={{ fontWeight: 900, mr: 0.5 }}>
                  插件设置
                </Typography>

                <Box sx={{ flex: 1 }} />

                <Button
                  size="small"
                  variant={settingsTab === 'roles' ? 'contained' : 'outlined'}
                  onClick={() => setSettingsTab('roles')}
                  sx={{ borderRadius: 999, minWidth: 0, px: 1.25, py: 0.25 }}
                >
                  角色管理
                </Button>
                <Button
                  size="small"
                  variant={settingsTab === 'providers' ? 'contained' : 'outlined'}
                  onClick={() => setSettingsTab('providers')}
                  sx={{ borderRadius: 999, minWidth: 0, px: 1.25, py: 0.25 }}
                >
                  供应商管理
                </Button>
              </>
            ) : (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 900, mr: 0.5 }}>
                  AI 聊天
                </Typography>

                <Button
                  variant="outlined"
                  size="small"
                  onClick={openRolePicker}
                  disabled={s.loading || !roles.length}
                  sx={{ borderRadius: 999, px: 1, py: 0.25, minWidth: 0, gap: 0.75, borderColor: 'divider' }}
                >
                  <Avatar sx={{ width: 22, height: 22, fontSize: 12 }}>{String(activeRole?.avatar || '🙂')}</Avatar>
                  <Typography variant="body2" sx={{ fontWeight: 900, maxWidth: 180 }} noWrap>
                    {activeRole ? String(activeRole?.name || '') : '请选择角色'}
                  </Typography>
                </Button>

                <Tooltip title="流式输出">
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mr: 1 }}>
                    <Switch
                      size="small"
                      checked={!!data?.settings?.streamEnabled}
                      onChange={() => controller.actions.toggleStream()}
                      disabled={!data}
                    />
                    <Typography variant="body2" color="text.secondary">
                      流式
                    </Typography>
                  </Stack>
                </Tooltip>

                <Box sx={{ flex: 1 }} />

                <Tooltip title="聊天记录">
                  <IconButton onClick={openChatPicker} size="small">
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="新建聊天">
                  <span>
                    <IconButton onClick={() => controller.actions.createChat()} size="small" disabled={!activeRole}>
                      <ChatIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="插件设置">
                  <IconButton onClick={() => openPluginSettings('roles')} size="small">
                    <SettingsIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Toolbar>
        </AppBar>

        {page === 'chat' ? (
          <>
            <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
             <Box ref={chatRootRef} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: 2, bgcolor: 'grey.50' }}>
               {s.loading ? (
                 <Typography variant="body2" color="text.secondary">
                   加载中…
                 </Typography>
              ) : !activeRole || !activeChat ? (
                <Typography variant="body2" color="text.secondary">
                  请选择角色
                </Typography>
              ) : !Array.isArray(activeChat.messages) || activeChat.messages.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  还没有消息。输入内容并发送。
                </Typography>
              ) : (
                <Stack spacing={1.25}>
                  {activeChat.messages.map((m: any) => {
                    const isUser = m?.role === 'user'
                    const who = isUser ? '你' : `${String(activeRole?.avatar || '🤖')} ${String(activeRole?.name || 'AI')}`
                    const time = controller.fmtTime(Number(m?.createdAt || 0))
                    const imgPaths = isUser ? (Array.isArray(m?.images) ? m.images : []) : []
                    return (
                      <Stack key={String(m?.id || '')} direction="row" justifyContent={isUser ? 'flex-end' : 'flex-start'}>
                        <Paper
                          variant="outlined"
                          sx={{
                            maxWidth: 920,
                            px: 1.5,
                            py: 1.25,
                            bgcolor: isUser ? 'rgba(25,118,210,.06)' : 'background.paper',
                            borderColor: isUser ? 'rgba(25,118,210,.22)' : 'divider',
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                            <Typography variant="body2" sx={{ fontWeight: 900 }}>
                              {who}
                            </Typography>
                            <Box sx={{ flex: 1 }} />
                            <Typography variant="caption" color="text.secondary">
                              {time}
                            </Typography>
                            {!isUser ? (
                              <Tooltip title="复制">
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    const text = String(m?.content || '')
                                    controller.api?.clipboard?.writeText?.(text).then(
                                      () => controller.api?.ui?.showToast?.('已复制'),
                                      () => controller.api?.ui?.showToast?.('复制失败'),
                                    )
                                  }}
                                >
                                  <ContentCopyIcon fontSize="inherit" />
                                </IconButton>
                              </Tooltip>
                            ) : null}
                          </Stack>

                          {imgPaths.length ? (
                            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
                              {imgPaths.slice(0, 8).map((p: string) => (
                                <RefImageThumb key={p} controller={controller} path={String(p || '')} />
                              ))}
                            </Stack>
                          ) : null}

                          {isUser ? (
                            <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                              {String(m?.content || '')}
                            </Typography>
                          ) : (
                            <AssistantContent controller={controller} className="prose" text={String(m?.content || '')} mid={String(m?.id || '')} chatRootRef={chatRootRef} />
                          )}

                          {m?.pending ? (
                            <Box sx={{ mt: 1 }}>
                              <Chip size="small" label={m?.streaming ? '生成中（流式）' : '生成中'} />
                            </Box>
                          ) : null}
                        </Paper>
                      </Stack>
                    )
                  })}
                </Stack>
              )}
            </Box>

            <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1.5, bgcolor: 'background.paper' }}>
              <Stack spacing={1}>
                {Array.isArray(s.draft?.images) && s.draft.images.length ? (
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {s.draft.images.map((img: any) => (
                      <Box key={String(img?.id || '')} sx={{ position: 'relative' }}>
                        <Box
                          component="img"
                          src={String(img?.dataUrl || '')}
                          alt={String(img?.name || '图片')}
                          sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
                        />
                        <IconButton
                          size="small"
                          onClick={() => controller.actions.removeDraftImage(String(img?.id || ''))}
                          sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'rgba(255,255,255,.85)', border: '1px solid', borderColor: 'divider' }}
                        >
                          <CloseIcon fontSize="inherit" />
                        </IconButton>
                      </Box>
                    ))}
                  </Stack>
                ) : null}

                <Stack direction="row" spacing={1} alignItems="flex-end">
                  <Button variant="outlined" startIcon={<ImageIcon />} onClick={onPickImages} disabled={s.loading || s.sending || !activeRole}>
                    图片
                  </Button>

                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={8}
                    placeholder="输入消息…（Enter 发送 / Shift+Enter 换行；支持粘贴图片）"
                    value={String(s.draft?.input || '')}
                    onChange={(e) => controller.actions.setDraft('input', e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    disabled={s.loading || s.sending || !activeRole}
                  />

                  <Button
                    variant="contained"
                    onClick={onSend}
                    disabled={s.loading || s.sending || !activeRole || (!String(s.draft?.input || '').trim() && !(s.draft?.images || []).length)}
                  >
                    发送
                  </Button>
                </Stack>
              </Stack>
            </Box>
        </Box>

        <Popover
          open={!!rolePickerEl}
          anchorEl={rolePickerEl}
          onClose={closeRolePicker}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          <Box sx={{ width: 380, maxHeight: '70vh', overflowY: 'auto' }}>
            <Box sx={{ p: 1.5, pb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                选择角色
              </Typography>
            </Box>
            <Divider />
            <List dense sx={{ py: 0 }}>
              {roles.map((r: any) => {
                const on = String(r?.id || '') === String(s.draft?.activeRoleId || '')
                const providerId = String(r?.modelRef?.providerId || '')
                const modelId = String(r?.modelRef?.modelId || '')
                return (
                  <ListItemButton
                    key={String(r?.id || '')}
                    selected={on}
                    onClick={() => {
                      controller.actions.setActiveRole(String(r?.id || ''))
                      closeRolePicker()
                    }}
                    sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                  >
                    <ListItemAvatar>
                      <Avatar sx={{ width: 28, height: 28, fontSize: 14 }}>{String(r?.avatar || '🙂')}</Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      sx={{ minWidth: 0 }}
                      primary={
                        <Typography sx={{ fontWeight: 900, fontSize: 13 }} noWrap>
                          {String(r?.name || '')}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {providerId}
                          {modelId ? ` / ${modelId}` : ''}
                        </Typography>
                      }
                    />
                    <Tooltip title="设置">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          closeRolePicker()
                          controller.actions.openRoleEditor(String(r?.id || ''))
                        }}
                      >
                        <SettingsIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  </ListItemButton>
                )
              })}
            </List>
          </Box>
        </Popover>

        <Popover
          open={!!chatPickerEl}
          anchorEl={chatPickerEl}
          onClose={closeChatPicker}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <Box sx={{ width: 420, maxHeight: '70vh', overflowY: 'auto' }}>
            <Box sx={{ p: 1.5, pb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                聊天记录
              </Typography>
            </Box>
            <Divider />
            {(() => {
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
              const chats = Array.isArray(box?.chats) ? box.chats.slice() : []
              const activeChatId = String(box?.activeChatId || '')
              chats.sort((a: any, b: any) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
              return (
                <List dense sx={{ py: 0 }}>
                  {chats.map((c: any) => {
                    const on = String(c?.id || '') === activeChatId
                    const msgs = Array.isArray(c?.messages) ? c.messages : []
                    const last = msgs.length ? msgs[msgs.length - 1] : null
                    const raw = String(last?.content || '').replace(/\s+/g, ' ').trim()
                    const snippet = raw.length > 40 ? raw.slice(0, 40) + '…' : raw
                    const time = controller.fmtTime(Number(c?.updatedAt || c?.createdAt || 0))
                    return (
                      <ListItemButton
                        key={String(c?.id || '')}
                        selected={on}
                        onClick={() => {
                          controller.actions.setActiveChat(String(c?.id || ''))
                          closeChatPicker()
                        }}
                        sx={{ borderBottom: '1px solid', borderColor: 'divider', alignItems: 'flex-start' }}
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
          </Box>
        </Popover>
          </>
        ) : (
          <PluginSettingsPage
            controller={controller}
            loading={!!s.loading}
            data={data}
            roles={roles}
            providers={providers}
            draft={s.draft}
            activeRoleId={String(s.draft?.activeRoleId || '')}
            tab={settingsTab}
          />
        )}

        <ProvidersDialog open={s.modal === 'providers'} controller={controller} providers={providers} draft={s.draft} />
        <RoleDialog open={s.modal === 'role'} controller={controller} providers={providers} draft={s.draft} models={s.models} />
        <ConfirmDialog open={s.modal === 'confirm'} controller={controller} draft={s.draft} roles={roles} providers={providers} />
        <MermaidDialog open={s.modal === 'mermaid'} controller={controller} mermaid={s.mermaid} />
      </Box>
    </ThemeProvider>
  )
}

function PluginSettingsPage(props: {
  controller: any
  loading: boolean
  data: any
  roles: any[]
  providers: any[]
  draft: any
  activeRoleId: string
  tab: 'roles' | 'providers'
}) {
  const { controller, loading, data, roles, providers, draft, activeRoleId, tab } = props

  if (!data) {
    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', p: 2, bgcolor: 'grey.50' }}>
        <Typography variant="body2" color="text.secondary">
          {loading ? '加载中…' : '未加载到数据'}
        </Typography>
      </Box>
    )
  }

  if (tab === 'roles') {
    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', p: 2, bgcolor: 'grey.50' }}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 900 }}>角色管理</Typography>
            <Box sx={{ flex: 1 }} />
            <Button startIcon={<AddIcon />} onClick={() => controller.actions.createRole()} disabled={loading}>
              新建角色
            </Button>
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={1.25}>
            {roles.length ? (
              roles.map((r: any) => {
                const rid = String(r?.id || '')
                const isActive = rid && rid === activeRoleId
                const providerId = String(r?.modelRef?.providerId || '')
                const modelId = String(r?.modelRef?.modelId || '')
                return (
                  <Paper
                    key={rid}
                    variant="outlined"
                    sx={{
                      p: 1.25,
                      borderColor: isActive ? 'primary.main' : 'divider',
                      bgcolor: isActive ? 'rgba(25,118,210,.06)' : 'background.paper',
                    }}
                  >
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                        <Avatar sx={{ width: 28, height: 28, fontSize: 14 }}>{String(r?.avatar || '🙂')}</Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 900 }} noWrap>
                            {String(r?.name || '')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {providerId}
                            {modelId ? ` / ${modelId}` : ''}
                          </Typography>
                        </Box>
                      </Stack>

                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          variant={isActive ? 'contained' : 'outlined'}
                          onClick={() => controller.actions.setActiveRole(rid)}
                          disabled={!rid}
                        >
                          {isActive ? '当前' : '设为当前'}
                        </Button>
                        <Button size="small" onClick={() => controller.actions.openRoleEditor(rid)} disabled={!rid}>
                          编辑
                        </Button>
                        <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteRole(rid)} disabled={!rid}>
                          删除
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                )
              })
            ) : (
              <Typography variant="body2" color="text.secondary">
                暂无角色
              </Typography>
            )}
          </Stack>
        </Paper>
      </Box>
    )
  }

  const editingId = String(draft?.editProviderId || '')

  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', p: 2, bgcolor: 'grey.50' }}>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>供应商管理</Typography>
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<AddIcon />} onClick={() => controller.actions.createProvider()} disabled={loading}>
            新建供应商
          </Button>
        </Stack>
        <Divider sx={{ my: 1.5 }} />
        <Stack spacing={1.5}>
          {providers.map((p: any) => {
            const pid = String(p?.id || '')
            const isEditing = pid && pid === editingId
            return (
              <Paper key={pid} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 900 }} noWrap>
                      {String(p?.name || '')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {String(p?.baseUrl || '')}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Button
                      size="small"
                      variant={isEditing ? 'outlined' : 'text'}
                      onClick={() => (isEditing ? controller.actions.closeProviderEditor() : controller.actions.openProviderEditor(pid))}
                      disabled={!pid}
                    >
                      {isEditing ? '收起' : '编辑'}
                    </Button>
                    <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteProvider(pid)} disabled={!pid}>
                      删除
                    </Button>
                  </Stack>
                </Stack>

                {isEditing ? (
                  <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                    <TextField label="名称" value={String(draft?.providerName || '')} onChange={(e) => controller.actions.setDraft('providerName', e.target.value)} />
                    <TextField
                      label="Base URL"
                      value={String(draft?.providerBaseUrl || '')}
                      onChange={(e) => controller.actions.setDraft('providerBaseUrl', e.target.value)}
                      placeholder="https://api.openai.com/v1"
                    />
                    <TextField label="API Key" type="password" value={String(draft?.providerApiKey || '')} onChange={(e) => controller.actions.setDraft('providerApiKey', e.target.value)} />
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button variant="contained" onClick={() => controller.actions.saveProvider()}>
                        保存
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
              </Paper>
            )
          })}
        </Stack>
      </Paper>
    </Box>
  )
}

function ProvidersDialog(props: { open: boolean; controller: any; providers: any[]; draft: any }) {
  const { open, controller, providers, draft } = props
  const editingId = String(draft?.editProviderId || '')

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorageIcon fontSize="small" />
        供应商
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<AddIcon />} onClick={() => controller.actions.createProvider()}>
          新建
        </Button>
        <IconButton onClick={() => controller.actions.closeModal()} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {providers.map((p: any) => {
            const pid = String(p?.id || '')
            const isEditing = pid && pid === editingId
            return (
              <Paper key={pid} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontWeight: 900 }}>{String(p?.name || '')}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {String(p?.baseUrl || '')}
                  </Typography>
                  <Button
                    size="small"
                    variant={isEditing ? 'outlined' : 'text'}
                    onClick={() => (isEditing ? controller.actions.closeProviderEditor() : controller.actions.openProviderEditor(pid))}
                  >
                    {isEditing ? '收起' : '编辑'}
                  </Button>
                  <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteProvider(pid)}>
                    删除
                  </Button>
                </Stack>

                {isEditing ? (
                  <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                    <TextField label="名称" value={String(draft?.providerName || '')} onChange={(e) => controller.actions.setDraft('providerName', e.target.value)} />
                    <TextField
                      label="Base URL"
                      value={String(draft?.providerBaseUrl || '')}
                      onChange={(e) => controller.actions.setDraft('providerBaseUrl', e.target.value)}
                      placeholder="https://api.openai.com/v1"
                    />
                    <TextField label="API Key" type="password" value={String(draft?.providerApiKey || '')} onChange={(e) => controller.actions.setDraft('providerApiKey', e.target.value)} />
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button variant="contained" onClick={() => controller.actions.saveProvider()}>
                        保存
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
              </Paper>
            )
          })}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function RoleDialog(props: { open: boolean; controller: any; providers: any[]; draft: any; models: any }) {
  const { open, controller, providers, draft, models } = props

  const providerId = String(draft?.roleProviderId || '')
  const modelPick = String(draft?.roleModelId || '')
  const customModel = String(draft?.roleCustomModelId || '')
  const temp = Number(draft?.roleTemperature || 0.7)
  const modelItems = Array.isArray(models?.items) ? (models.items as any[]).map((x) => String(x)) : []
  const hasPickInList = !!modelPick && modelPick !== '__custom__' && modelItems.some((x) => x === modelPick)

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SettingsIcon fontSize="small" />
        角色设置
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeModal()} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField label="角色名" value={String(draft?.roleName || '')} onChange={(e) => controller.actions.setDraft('roleName', e.target.value)} fullWidth />
            <TextField label="头像" value={String(draft?.roleAvatar || '')} onChange={(e) => controller.actions.setDraft('roleAvatar', e.target.value)} sx={{ width: { xs: '100%', sm: 160 } }} />
          </Stack>

          <TextField
            label="系统提示词"
            value={String(draft?.roleSystemPrompt || '')}
            onChange={(e) => controller.actions.setDraft('roleSystemPrompt', e.target.value)}
            fullWidth
            multiline
            minRows={5}
            placeholder="写入系统提示词…"
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="flex-start">
            <FormControl fullWidth>
              <InputLabel>供应商</InputLabel>
              <Select label="供应商" value={providerId} onChange={(e) => controller.actions.roleProviderChanged(e.target.value)}>
                {providers.map((p: any) => (
                  <MenuItem key={String(p?.id || '')} value={String(p?.id || '')}>
                    {String(p?.name || '')}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>模型</InputLabel>
              <Select label="模型" value={modelPick} onChange={(e) => controller.actions.roleModelChanged(e.target.value)}>
                <MenuItem value="">请选择模型</MenuItem>
                {!hasPickInList && modelPick && modelPick !== '__custom__' ? (
                  <MenuItem value={modelPick}>{modelPick}</MenuItem>
                ) : null}
                {modelItems.map((id) => (
                  <MenuItem key={id} value={id}>
                    {id}
                  </MenuItem>
                ))}
                <MenuItem value="__custom__">自定义模型ID…</MenuItem>
              </Select>
            </FormControl>

            <Stack direction="row" spacing={1} sx={{ pt: { xs: 0, sm: 1 } }}>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => controller.actions.refreshModels(providerId, true)} disabled={!providerId || !!models?.loading}>
                {models?.loading ? '刷新中…' : '刷新模型'}
              </Button>
            </Stack>
          </Stack>

          {modelPick === '__custom__' ? (
            <TextField
              label="自定义模型ID"
              value={customModel}
              onChange={(e) => controller.actions.setDraft('roleCustomModelId', e.target.value)}
              placeholder="例如：gpt-4.1-mini / deepseek-chat"
              fullWidth
            />
          ) : null}

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 900, mb: 1 }}>
              温度：{Number.isFinite(temp) ? temp.toFixed(2) : '0.70'}
            </Typography>
            <Slider value={Number.isFinite(temp) ? temp : 0.7} min={0} max={2} step={0.05} onChange={(_e, v) => controller.actions.setDraft('roleTemperature', String(v))} />
          </Box>
          {models?.error ? (
            <Typography variant="body2" color="error">
              {String(models.error || '')}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteRole(String(draft?.editRoleId || ''))}>
          删除角色
        </Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={() => controller.actions.closeModal()}>取消</Button>
          <Button variant="contained" onClick={() => controller.actions.saveRole()}>
            保存
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  )
}

function ConfirmDialog(props: { open: boolean; controller: any; draft: any; roles: any[]; providers: any[] }) {
  const { open, controller, draft, roles, providers } = props
  const rid = String(draft?.deleteRoleId || '')
  const pid = String(draft?.deleteProviderId || '')
  const role = rid ? roles.find((r) => String(r?.id || '') === rid) : null
  const provider = pid ? providers.find((p) => String(p?.id || '') === pid) : null

  const title = rid ? '删除角色' : pid ? '删除供应商' : '确认'
  const name = rid ? String(role?.name || '') : pid ? String(provider?.name || '') : ''

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2">确认删除{name ? `：${name}` : ''}？</Typography>
        {pid ? (
          <Typography variant="caption" color="text.secondary">
            注意：至少保留一个供应商。
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => controller.actions.closeModal()}>取消</Button>
        <Button color="error" variant="contained" onClick={() => controller.actions.confirmDelete()}>
          删除
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function MermaidDialog(props: { open: boolean; controller: any; mermaid: any }) {
  const { open, controller, mermaid } = props
  const items = Array.isArray(mermaid?.items) ? mermaid.items : []
  const len = items.length
  const idx = Math.max(0, Math.min(len - 1, Number(mermaid?.index || 0)))
  const svg = len ? String(items[idx]?.svg || '') : ''
  const scale = Number(mermaid?.scale || 1)

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="lg">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        Mermaid 预览
        <Chip size="small" label={len ? `${idx + 1}/${len}` : '0/0'} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="上一张">
          <span>
            <IconButton size="small" onClick={() => controller.actions.mermaidPrev()} disabled={len <= 1}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="下一张">
          <span>
            <IconButton size="small" onClick={() => controller.actions.mermaidNext()} disabled={len <= 1}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="缩小">
          <IconButton size="small" onClick={() => controller.actions.mermaidZoom(-1)}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="放大">
          <IconButton size="small" onClick={() => controller.actions.mermaidZoom(1)}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="重置缩放">
          <IconButton size="small" onClick={() => controller.actions.mermaidReset()}>
            <RestartAltIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton onClick={() => controller.actions.closeModal()} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ height: '70vh', overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: 1.5 }}>
          <Box sx={{ transformOrigin: '0 0', transform: `scale(${Number.isFinite(scale) ? scale : 1})`, display: 'inline-block' }}>
            {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <Typography color="text.secondary">无可预览的 Mermaid</Typography>}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  )
}
