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
  InputAdornment,
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
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import HistoryIcon from '@mui/icons-material/History'
import ImageIcon from '@mui/icons-material/Image'
import RefreshIcon from '@mui/icons-material/Refresh'
import SettingsIcon from '@mui/icons-material/Settings'
import StorageIcon from '@mui/icons-material/Storage'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'

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

function ApiKeyField(props: { value: string; onValueChange: (next: string) => void }) {
  const { value, onValueChange } = props
  const [visible, setVisible] = React.useState(false)

  const label = visible ? '隐藏 API Key' : '显示 API Key'

  return (
    <TextField
      label="API Key"
      type={visible ? 'text' : 'password'}
      autoComplete="off"
      value={String(value || '')}
      onChange={(e) => onValueChange(e.target.value)}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={label}>
              <IconButton
                size="small"
                aria-label={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </InputAdornment>
        ),
      }}
    />
  )
}

function isNearBottom(el: HTMLElement, thresholdPx = 24) {
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight
  return Math.ceil(gap) <= thresholdPx
}

function clampNum(n: number, min: number, max: number) {
  const x = Number(n)
  if (!isFinite(x)) return min
  if (x < min) return min
  if (x > max) return max
  return x
}

function RoleAvatarCropper(props: { controller: any; src: string }) {
  const { controller, src } = props
  const api = controller?.api

  const VIEW = 240
  const OUT = 96

  const imgRef = React.useRef<HTMLImageElement | null>(null)
  const dragRef = React.useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 })
  const [natural, setNatural] = React.useState({ w: 0, h: 0 })
  const [zoom, setZoom] = React.useState(1)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })

  const ready = natural.w > 0 && natural.h > 0
  const base = ready ? Math.max(VIEW / natural.w, VIEW / natural.h) : 1
  const scale = base * zoom
  const drawW = ready ? natural.w * scale : VIEW
  const drawH = ready ? natural.h * scale : VIEW

  const clampOffset = React.useCallback(
    (x: number, y: number) => {
      const maxX = Math.max(0, (drawW - VIEW) / 2)
      const maxY = Math.max(0, (drawH - VIEW) / 2)
      return { x: clampNum(x, -maxX, maxX), y: clampNum(y, -maxY, maxY) }
    },
    [drawW, drawH],
  )

  React.useEffect(() => {
    setOffset((p) => clampOffset(p.x, p.y))
  }, [clampOffset])

  const reset = useEvent(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  })

  const onImgLoad = useEvent((e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget
    const w = Number(el.naturalWidth || 0)
    const h = Number(el.naturalHeight || 0)
    setNatural({ w, h })
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  })

  const onPointerDown = useEvent((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const cur = e.currentTarget
    try {
      cur.setPointerCapture(e.pointerId)
    } catch {}
    dragRef.current.active = true
    dragRef.current.sx = e.clientX
    dragRef.current.sy = e.clientY
    dragRef.current.ox = offset.x
    dragRef.current.oy = offset.y
  })

  const onPointerMove = useEvent((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const dx = e.clientX - dragRef.current.sx
    const dy = e.clientY - dragRef.current.sy
    const next = clampOffset(dragRef.current.ox + dx, dragRef.current.oy + dy)
    setOffset(next)
  })

  const onPointerUp = useEvent(() => {
    dragRef.current.active = false
  })

  const onWheel = useEvent((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const dir = Number(e.deltaY || 0) > 0 ? -1 : 1
    const factor = dir > 0 ? 1.08 : 1 / 1.08
    setZoom((z) => clampNum(z * factor, 1, 6))
  })

  const cropNow = useEvent(() => {
    try {
      const img = imgRef.current
      if (!img || !ready) return ''

      const imgLeft = (VIEW - drawW) / 2 + offset.x
      const imgTop = (VIEW - drawH) / 2 + offset.y
      const s = VIEW / scale
      const sx = (0 - imgLeft) / scale
      const sy = (0 - imgTop) / scale

      const canvas = document.createElement('canvas')
      canvas.width = OUT
      canvas.height = OUT
      const ctx = canvas.getContext('2d')
      if (!ctx) return ''
      ctx.clearRect(0, 0, OUT, OUT)
      ctx.imageSmoothingEnabled = true
      ;(ctx as any).imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, s, s, 0, 0, OUT, OUT)

      const out = canvas.toDataURL('image/png')
      return String(out || '').startsWith('data:image/') ? out : ''
    } catch {
      return ''
    }
  })

  const cancelCrop = useEvent(() => {
    controller.actions.setDraft('roleAvatarImageCropSrc', '')
  })

  const applyCrop = useEvent(() => {
    const out = cropNow()
    if (!out) return api?.ui?.showToast?.('裁剪失败')
    controller.actions.setDraft('roleAvatarImage', out)
    controller.actions.setDraft('roleAvatarImageCropSrc', '')
  })

  const imgX = (VIEW - drawW) / 2 + offset.x
  const imgY = (VIEW - drawH) / 2 + offset.y

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        拖拽移动视角，滚轮缩放；完成后点击“应用”。
      </Typography>
      <Box
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        sx={{
          width: VIEW,
          height: VIEW,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'grey.100',
          touchAction: 'none',
          cursor: dragRef.current.active ? 'grabbing' : 'grab',
          mx: 'auto',
        }}
      >
        <Box sx={{ position: 'absolute', inset: 0 }} />
        <img
          ref={imgRef}
          src={src}
          alt="avatar-crop"
          onLoad={onImgLoad}
          draggable={false}
          style={{
            position: 'absolute',
            left: `${imgX}px`,
            top: `${imgY}px`,
            width: `${drawW}px`,
            height: `${drawH}px`,
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 10,
            borderRadius: '50%',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.9)',
            pointerEvents: 'none',
          }}
        />
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center" sx={{ mt: 1.25 }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 40 }}>
          缩放
        </Typography>
        <Slider
          value={zoom}
          min={1}
          max={6}
          step={0.02}
          onChange={(_e, v) => {
            const one = Array.isArray(v) ? v[0] : v
            setZoom(clampNum(Number(one || 1), 1, 6))
          }}
          sx={{ flex: 1, minWidth: 180 }}
        />
        <Button size="small" onClick={reset} disabled={!ready}>
          重置
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={cancelCrop}>
          取消裁剪
        </Button>
        <Button size="small" variant="contained" onClick={applyCrop} disabled={!ready}>
          应用
        </Button>
      </Stack>
    </Paper>
  )
}

const TOPBAR_H = 40

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
    if (!api?.files?.images?.read) return
    api.files.images
      .read({ scope: 'data', path })
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
      data-fw-img="1"
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
        cursor: 'zoom-in',
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
  const transparentChatBg = !!data?.settings?.transparentChatBg
  const chatBgOpacity = clampNum(Number(data?.settings?.chatBgOpacity ?? 0), 0, 100)
  const chatBgBlur = clampNum(Number(data?.settings?.chatBgBlur ?? 0), 0, 24)
  const topbarOpacity = clampNum(Number(data?.settings?.topbarOpacity ?? 100), 0, 100)
  const topbarBlur = clampNum(Number(data?.settings?.topbarBlur ?? 0), 0, 24)
  const composerOpacity = clampNum(Number(data?.settings?.composerOpacity ?? 86), 40, 100)
  const composerBlur = clampNum(Number(data?.settings?.composerBlur ?? 10), 0, 24)
  const userMessageCollapseEnabled = !!data?.settings?.userMessageCollapseEnabled
  const userMessageCollapseLines = clampNum(Number(data?.settings?.userMessageCollapseLines ?? 8), 1, 50)
  const bgAlpha = transparentChatBg ? Math.max(chatBgOpacity / 100, chatBgBlur > 0 ? 0.01 : 0) : 1

  const activeRole = controller.activeRole()
  const activeChat = controller.activeChat()
  const sendingCtx = s?.sendingCtx && typeof s.sendingCtx === 'object' ? (s.sendingCtx as any) : null
  const isSendingThisChat = (roleId: string, chatId: string) => {
    if (!sendingCtx) return false
    return String(sendingCtx?.roleId || '') === String(roleId || '') && String(sendingCtx?.chatId || '') === String(chatId || '')
  }

  const chatRootRef = React.useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = React.useRef(true)
  const composerRef = React.useRef<HTMLDivElement | null>(null)
  const [composerHeight, setComposerHeight] = React.useState(0)

  const [page, setPage] = React.useState<'chat' | 'settings'>('chat')
  const [settingsTab, setSettingsTab] = React.useState<'appearance' | 'roles' | 'providers'>('roles')

  const [expandedUserMsgIds, setExpandedUserMsgIds] = React.useState(() => new Set<string>())

  React.useEffect(() => {
    setExpandedUserMsgIds(() => new Set())
  }, [String(activeChat?.id || '')])

  React.useEffect(() => {
    if (!userMessageCollapseEnabled) setExpandedUserMsgIds(() => new Set())
  }, [userMessageCollapseEnabled])

  const toggleExpandedUserMsg = useEvent((mid: string) => {
    const id = String(mid || '')
    if (!id) return
    setExpandedUserMsgIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  })

  const [rolePickerEl, setRolePickerEl] = React.useState<HTMLElement | null>(null)
  const [chatPickerEl, setChatPickerEl] = React.useState<HTMLElement | null>(null)

  const backToHost = useEvent(() => {
    const ui = controller?.api?.ui
    if (ui?.back) ui.back()
    else ui?.showToast?.('无法返回')
  })

  const onTopbarPointerDown = useEvent((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const t = e.target as any
    if (!t || typeof t.closest !== 'function') return
    if (t.closest('button, a, input, textarea, select, [role="button"]')) return
    controller?.api?.ui?.startDragging?.()
  })

  const onClickOpenImageViewer = useEvent((e: React.MouseEvent) => {
    const t = e.target as any
    if (!(t instanceof Element)) return
    const img = t.closest?.('img[data-fw-img="1"]')
    if (!img) return
    if (!(img instanceof HTMLImageElement)) return
    const src = String(img.getAttribute('src') || '').trim()
    if (!src) return
    e.preventDefault()
    e.stopPropagation()
    controller.actions.openImageViewer(e.currentTarget as any, img)
  })

  const lastMsg = Array.isArray(activeChat?.messages) && activeChat.messages.length ? activeChat.messages[activeChat.messages.length - 1] : null
  const lastMsgId = String(lastMsg?.id || '')
  const lastMsgText = String(lastMsg?.content || '')
  const isReplying = Array.isArray(activeChat?.messages) && activeChat.messages.some((m: any) => m && m.role === 'assistant' && m.pending)

  React.useLayoutEffect(() => {
    if (page !== 'chat') return
    const el = composerRef.current
    if (!el) return

    const measure = () => {
      try {
        setComposerHeight(Math.ceil(el.getBoundingClientRect().height || 0))
      } catch (_) {}
    }

    const raf = requestAnimationFrame(measure)

    if (typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(raf)
    }

    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [page])

  React.useEffect(() => {
    if (page !== 'chat') return
    const el = chatRootRef.current
    if (!el) return
    const onScroll = () => {
      stickToBottomRef.current = isNearBottom(el)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true } as any)
    return () => el.removeEventListener('scroll', onScroll as any)
  }, [page, activeRole?.id, activeChat?.id])

  React.useEffect(() => {
    if (page !== 'chat') return
    const el = chatRootRef.current
    if (!el) return
    stickToBottomRef.current = true
    requestAnimationFrame(() => {
      try {
        el.scrollTop = el.scrollHeight
      } catch (_) {}
    })
  }, [page, activeRole?.id, activeChat?.id])

  React.useEffect(() => {
    if (page !== 'chat') return
    const el = chatRootRef.current
    if (!el) return
    if (!stickToBottomRef.current) return
    requestAnimationFrame(() => {
      try {
        el.scrollTop = el.scrollHeight
      } catch (_) {}
    })
  }, [page, (activeChat?.messages || []).length, lastMsgId, lastMsgText])

  const onSend = useEvent(() => {
    stickToBottomRef.current = true
    controller.actions.send()
  })
  const onStop = useEvent(() => controller.actions.stop?.())
  const onPickImages = useEvent(() => controller.actions.pickImages())
  const [regen, setRegen] = React.useState<{ mid: string; role: 'assistant' | 'user' }>({ mid: '', role: 'assistant' })
  const [msgMenu, setMsgMenu] = React.useState<{ mid: string; role: 'user' | 'assistant'; x: number; y: number; pending: boolean }>({
    mid: '',
    role: 'assistant',
    x: 0,
    y: 0,
    pending: false,
  })
  const [confirmDelMsg, setConfirmDelMsg] = React.useState<{ mid: string; role: 'user' | 'assistant' }>({ mid: '', role: 'assistant' })
  const [editingMsg, setEditingMsg] = React.useState<{ mid: string; text: string }>({ mid: '', text: '' })
  const [chatMenu, setChatMenu] = React.useState<{ roleId: string; chatId: string; title: string; x: number; y: number }>({
    roleId: '',
    chatId: '',
    title: '',
    x: 0,
    y: 0,
  })
  const [confirmDelChat, setConfirmDelChat] = React.useState<{ roleId: string; chatId: string }>({ roleId: '', chatId: '' })
  const [editingChatTitle, setEditingChatTitle] = React.useState<{ roleId: string; chatId: string; text: string }>({ roleId: '', chatId: '', text: '' })

  React.useEffect(() => {
    setEditingMsg({ mid: '', text: '' })
  }, [page, activeRole?.id, activeChat?.id])

  React.useEffect(() => {
    setChatMenu({ roleId: '', chatId: '', title: '', x: 0, y: 0 })
    setConfirmDelChat({ roleId: '', chatId: '' })
    setEditingChatTitle({ roleId: '', chatId: '', text: '' })
  }, [page, activeRole?.id])

  const closeMsgMenu = useEvent(() => setMsgMenu({ mid: '', role: 'assistant', x: 0, y: 0, pending: false }))
  const onMessageContextMenu = useEvent((e: React.MouseEvent, mid: string, role: 'user' | 'assistant', pending: boolean) => {
    if (!mid) return
    e.preventDefault()
    e.stopPropagation()
    setMsgMenu({ mid, role, x: e.clientX, y: e.clientY, pending })
  })

  const closeChatMenu = useEvent(() => setChatMenu({ roleId: '', chatId: '', title: '', x: 0, y: 0 }))
  const onChatContextMenu = useEvent((e: React.MouseEvent, roleId: string, chatId: string, title: string) => {
    const rid = String(roleId || '')
    const cid = String(chatId || '')
    if (!rid || !cid) return
    e.preventDefault()
    e.stopPropagation()
    setChatMenu({ roleId: rid, chatId: cid, title: String(title ?? ''), x: e.clientX, y: e.clientY })
  })

  React.useEffect(() => {
    if (page !== 'chat') return
    const mid = String(editingMsg.mid || '')
    if (!mid) return
    const msgs = Array.isArray(activeChat?.messages) ? activeChat.messages : []
    if (!msgs.some((m: any) => String(m?.id || '') === mid)) setEditingMsg({ mid: '', text: '' })
  }, [page, activeChat?.id, (activeChat?.messages || []).length, editingMsg.mid])

  const startEditMessage = useEvent((mid: string, text: string, pending: boolean) => {
    if (!mid) return
    if (pending || s.loading || s.sending) return
    setEditingMsg({ mid, text: String(text ?? '') })
  })
  const cancelEditMessage = useEvent(() => setEditingMsg({ mid: '', text: '' }))
  const saveEditMessage = useEvent(() => {
    const mid = String(editingMsg.mid || '')
    if (!mid) return
    if (s.loading || s.sending) return
    controller.actions.editMessage?.(mid, String(editingMsg.text ?? ''))
    setEditingMsg({ mid: '', text: '' })
  })

  const openRolePicker = useEvent((e: React.MouseEvent<HTMLElement>) => setRolePickerEl(e.currentTarget))
  const closeRolePicker = useEvent(() => setRolePickerEl(null))
  const openChatPicker = useEvent((e: React.MouseEvent<HTMLElement>) => setChatPickerEl(e.currentTarget))
  const closeChatPicker = useEvent(() => {
    setChatPickerEl(null)
    closeChatMenu()
  })

  const openPluginSettings = useEvent((tab: 'appearance' | 'roles' | 'providers' = 'roles') => {
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
    if (isReplying) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  })

  const msgMenuMid = String(msgMenu.mid || '')
  const msgMenuMessages = Array.isArray(activeChat?.messages) ? activeChat.messages : []
  const msgMenuIndex = msgMenuMid ? msgMenuMessages.findIndex((m: any) => String(m?.id || '') === msgMenuMid) : -1
  const msgMenuMsg = msgMenuIndex >= 0 ? msgMenuMessages[msgMenuIndex] : null
  const msgMenuText = String(msgMenuMsg?.content || '')
  const msgMenuPending = msgMenuMsg ? !!msgMenuMsg?.pending : !!msgMenu.pending
  const msgMenuCanEdit = !!msgMenuMid && !msgMenuPending && !s.loading && !s.sending

  let msgMenuRegenMid = msgMenuMid
  let msgMenuRegenRole: 'assistant' | 'user' = msgMenu.role === 'user' ? 'user' : 'assistant'
  let msgMenuRegenPending = msgMenu.role === 'assistant' ? msgMenuPending : false
  if (msgMenu.role === 'user' && msgMenuIndex >= 0) {
    for (let j = msgMenuIndex + 1; j < msgMenuMessages.length; j++) {
      const next = msgMenuMessages[j]
      if (!next) continue
      if (next.role === 'assistant') {
        msgMenuRegenRole = 'assistant'
        msgMenuRegenMid = String(next?.id || '')
        msgMenuRegenPending = !!next?.pending
        break
      }
    }
  }
  const msgMenuCanRegen =
    !!msgMenuRegenMid &&
    !s.loading &&
    !s.sending &&
    !(msgMenuRegenRole === 'assistant' && msgMenuRegenPending)

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
             backgroundColor: transparentChatBg ? `rgba(255,255,255,${bgAlpha})` : '#fff',
           },
          '#fast-window-ai-chat-root': {
            height: '100%',
            overflow: 'hidden',
            backgroundColor: transparentChatBg ? `rgba(255,255,255,${bgAlpha})` : '#fff',
            backdropFilter: transparentChatBg && chatBgBlur > 0 ? `blur(${chatBgBlur}px)` : 'none',
            WebkitBackdropFilter: transparentChatBg && chatBgBlur > 0 ? `blur(${chatBgBlur}px)` : 'none',
          },
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
          '.prose pre.fw-code-block': {
            position: 'relative',
            paddingTop: 38,
          },
          '.prose pre.fw-code-block .fw-code-copy': {
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 1,
            width: 30,
            height: 30,
            padding: 0,
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,.18)',
            background: 'rgba(255,255,255,.08)',
            color: '#e5e7eb',
            fontSize: 12,
            cursor: 'pointer',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            '&:hover': { background: 'rgba(255,255,255,.12)' },
            '&:active': { background: 'rgba(255,255,255,.16)' },
            '&:disabled': { opacity: 0.75, cursor: 'default' },
            '&:focus-visible': { outline: '2px solid rgba(255,255,255,.35)', outlineOffset: 2 },
          },
          '.prose pre.fw-code-block .fw-code-copy[data-state="ok"]': { color: '#34d399' },
          '.prose pre.fw-code-block .fw-code-copy[data-state="fail"]': { color: '#f87171' },
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
           '.mermaid-block': { margin: '10px 0', overflowX: 'auto' },
           '.mermaid-block[data-mermaid="1"]': { cursor: 'zoom-in' },
           '.mermaid-block svg': { maxWidth: '100%', height: 'auto', display: 'block' },
           '.mermaid-error': { margin: '10px 0', overflowX: 'auto' },
           '.mermaid-error-box': {
             position: 'relative',
             background: '#fff',
             border: '1px solid rgba(0,0,0,.12)',
             borderRadius: 12,
             padding: '10px 12px',
             paddingRight: 44,
           },
           '.mermaid-error-copy': {
             position: 'absolute',
             top: 8,
             right: 8,
             width: 28,
             height: 28,
             padding: 0,
             borderRadius: 999,
             border: '1px solid rgba(0,0,0,.12)',
             background: 'rgba(255,255,255,.92)',
             color: 'rgba(0,0,0,.72)',
             cursor: 'pointer',
             userSelect: 'none',
             WebkitUserSelect: 'none',
             display: 'inline-flex',
             alignItems: 'center',
             justifyContent: 'center',
             '&:hover': { background: 'rgba(255,255,255,1)' },
             '&:active': { background: 'rgba(255,255,255,.96)' },
             '&:disabled': { opacity: 0.7, cursor: 'default' },
             '&:focus-visible': { outline: '2px solid rgba(25,118,210,.35)', outlineOffset: 2 },
           },
           '.mermaid-error-title': { fontWeight: 900, fontSize: 12, color: 'rgba(0,0,0,.72)' },
           '.mermaid-error-msg': {
             marginTop: 6,
             fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
             fontSize: 12,
             color: 'rgba(0,0,0,.82)',
             whiteSpace: 'pre-wrap',
             wordBreak: 'break-word',
           },
           '.mermaid-error-src': { display: 'none' },
         }}
       />

      <Box sx={{ height: '100%', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <AppBar
          position="absolute"
          elevation={0}
          sx={{
            bgcolor: `rgba(255,255,255,${topbarOpacity / 100})`,
            color: 'text.primary',
            borderBottom: 'none',
            backdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
            WebkitBackdropFilter: topbarBlur > 0 ? `blur(${topbarBlur}px)` : 'none',
            top: 0,
            left: 0,
            right: 0,
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
            onPointerDown={onTopbarPointerDown}
           >
             {page === 'settings' ? (
               <>
                 <IconButton onClick={backToHost} size="small" aria-label="返回主页">
                   <ArrowBackRoundedIcon fontSize="small" />
                 </IconButton>
                 <IconButton onClick={closePluginSettings} size="small">
                   <ChevronLeftIcon fontSize="small" />
                 </IconButton>

                <Typography variant="subtitle2" sx={{ fontWeight: 900, mr: 0.5 }}>
                  插件设置
                </Typography>

                <Box sx={{ flex: 1 }} />

                <Button
                  size="small"
                  variant={settingsTab === 'appearance' ? 'contained' : 'outlined'}
                  onClick={() => setSettingsTab('appearance')}
                  sx={{ borderRadius: 999, minWidth: 0, px: 1.25, py: 0.25 }}
                >
                  外观
                </Button>
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
                 <IconButton onClick={backToHost} size="small" aria-label="返回主页">
                   <ArrowBackRoundedIcon fontSize="small" />
                 </IconButton>
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
                  <Avatar
                    src={String(activeRole?.avatarImage || '') || undefined}
                    sx={{ width: 22, height: 22, fontSize: 12 }}
                  >
                    {String(activeRole?.avatar || '🙂')}
                  </Avatar>
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
                      <AddIcon fontSize="small" />
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

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {page === 'chat' ? (
          <>
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                bgcolor: transparentChatBg ? 'transparent' : 'background.default',
              }}
            >
             <Box
                ref={chatRootRef}
                onClick={onClickOpenImageViewer}
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                 overflowX: 'hidden',
                 px: 2,
                 pt: `calc(${TOPBAR_H}px + 16px)`,
                 bgcolor: transparentChatBg ? 'transparent' : 'grey.50',
                 paddingBottom: `calc(${Math.max(0, composerHeight)}px + 24px)`,
               }}
             >
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
                  {activeChat.messages.map((m: any, index: number) => {
                    const isUser = m?.role === 'user'
                    const roleName = String(activeRole?.name || 'AI')
                    const roleAvatarEmoji = String(activeRole?.avatar || '🤖')
                    const roleAvatarImage = String(activeRole?.avatarImage || '')
                    const time = controller.fmtTime(Number(m?.createdAt || 0))
                    const imgPaths = isUser ? (Array.isArray(m?.images) ? m.images : []) : []
                    const mid = String(m?.id || '')
                    const isEditing = editingMsg.mid === mid
                    const canEdit = !isEditing && !m?.pending && !s.loading && !s.sending && !!mid

                    const content = String(m?.content || '')
                    const contentLines = userMessageCollapseEnabled && isUser ? content.split(/\r?\n/) : []
                    const canCollapse = userMessageCollapseEnabled && isUser && !isEditing && contentLines.length > userMessageCollapseLines
                    const isExpanded = !canCollapse || expandedUserMsgIds.has(mid)
                    const shownContent = canCollapse && !isExpanded ? contentLines.slice(0, userMessageCollapseLines).join('\n') : content

                    let regenRole: 'assistant' | 'user' = isUser ? 'user' : 'assistant'
                    let regenMid = mid
                    let regenPending = isUser ? false : !!m?.pending
                    if (isUser) {
                      const msgs = Array.isArray(activeChat.messages) ? activeChat.messages : []
                      for (let j = index + 1; j < msgs.length; j++) {
                        const next = msgs[j]
                        if (!next) continue
                        if (next.role === 'assistant') {
                          regenRole = 'assistant'
                          regenMid = String(next?.id || '')
                          regenPending = !!next?.pending
                          break
                        }
                        if (next.role === 'user') break
                      }
                    } else {
                      regenRole = 'assistant'
                      regenMid = mid
                      regenPending = !!m?.pending
                    }
                    return (
                      <Stack key={mid} direction="row" justifyContent={isUser ? 'flex-end' : 'flex-start'}>
                        <Paper
                          variant="outlined"
                          onContextMenu={isEditing ? undefined : (e) => onMessageContextMenu(e, mid, isUser ? 'user' : 'assistant', !!m?.pending)}
                          sx={{
                            width: isUser ? 'auto' : '100%',
                            maxWidth: isUser ? 920 : '100%',
                            px: 1.5,
                            py: 1.25,
                            bgcolor: isUser ? 'rgba(25,118,210,.06)' : 'transparent',
                            borderColor: isUser ? 'rgba(25,118,210,.22)' : 'transparent',
                          }}
                        >
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                            {isUser ? (
                              <Typography variant="body2" sx={{ fontWeight: 900 }}>
                                你
                              </Typography>
                            ) : (
                              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                                <Avatar src={roleAvatarImage || undefined} sx={{ width: 66, height: 66, fontSize: 28 }}>
                                  {roleAvatarEmoji}
                                </Avatar>
                                <Typography variant="subtitle1" sx={{ fontWeight: 900, minWidth: 0, fontSize: 20 }} noWrap>
                                  {roleName}
                                </Typography>
                              </Stack>
                            )}
                            <Box sx={{ flex: 1 }} />
                            <Typography variant="caption" color="text.secondary">
                              {time}
                            </Typography>
                          </Stack>

                          {imgPaths.length ? (
                            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
                              {imgPaths.slice(0, 8).map((p: string) => (
                                <RefImageThumb key={p} controller={controller} path={String(p || '')} />
                              ))}
                            </Stack>
                          ) : null}

                          {isEditing ? (
                            <TextField
                              autoFocus
                              fullWidth
                              multiline
                              minRows={3}
                              size="small"
                              placeholder={isUser ? '编辑用户消息…' : '编辑 AI 回复…'}
                              value={editingMsg.text}
                              onChange={(e) => setEditingMsg((p) => ({ ...p, text: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') cancelEditMessage()
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEditMessage()
                              }}
                            />
                          ) : isUser ? (
                            <Box>
                              <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{shownContent}</Typography>
                              {canCollapse ? (
                                <Box sx={{ textAlign: 'right' }}>
                                  <Button
                                    size="small"
                                    variant="text"
                                    onClick={() => toggleExpandedUserMsg(mid)}
                                    aria-label={isExpanded ? '收起用户消息' : '展开用户消息'}
                                    aria-expanded={isExpanded}
                                    sx={{ mt: 0.25, minWidth: 0, px: 0.5, borderRadius: 2 }}
                                  >
                                    {isExpanded ? `收起（共${contentLines.length}行）` : `展开（共${contentLines.length}行）`}
                                  </Button>
                                </Box>
                              ) : null}
                            </Box>
                          ) : (
                            <AssistantContent controller={controller} className="prose" text={content} mid={mid} chatRootRef={chatRootRef} />
                          )}

                          {isEditing ? (
                            <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
                              <Button size="small" variant="contained" onClick={saveEditMessage} disabled={s.loading || s.sending}>
                                保存
                              </Button>
                              <Button size="small" onClick={cancelEditMessage} disabled={s.loading || s.sending}>
                                取消
                              </Button>
                            </Stack>
                          ) : (
                            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} justifyContent="flex-end">
                              <Tooltip title="重新回复">
                                <span>
                                  <IconButton
                                    aria-label="重新回复"
                                    size="small"
                                    disabled={!regenMid || s.loading || s.sending || (regenRole === 'assistant' && regenPending)}
                                    onClick={() => {
                                      if (!regenMid) return
                                      setRegen({ mid: regenMid, role: regenRole })
                                    }}
                                  >
                                    <RestartAltIcon fontSize="inherit" />
                                  </IconButton>
                                </span>
                              </Tooltip>

                              <Tooltip title="编辑">
                                <span>
                                  <IconButton aria-label="编辑消息" size="small" disabled={!canEdit} onClick={() => startEditMessage(mid, String(m?.content || ''), !!m?.pending)}>
                                    <EditOutlinedIcon fontSize="inherit" />
                                  </IconButton>
                                </span>
                              </Tooltip>

                              <Tooltip title="复制">
                                <IconButton
                                  aria-label="复制内容"
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
                            </Stack>
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

             <Popover
               open={!!msgMenu.mid}
               onClose={closeMsgMenu}
               anchorReference="anchorPosition"
               anchorPosition={msgMenu.mid ? { top: msgMenu.y, left: msgMenu.x } : undefined}
               transformOrigin={{ vertical: 'top', horizontal: 'left' }}
             >
               <Box sx={{ minWidth: 160, p: 0.5 }}>
                 <MenuItem
                   disabled={!msgMenuCanRegen}
                   onClick={() => {
                     const mid = msgMenuRegenMid
                     const role = msgMenuRegenRole
                     closeMsgMenu()
                     if (!mid) return
                     setRegen({ mid, role })
                   }}
                   sx={{ gap: 1 }}
                 >
                   <RestartAltIcon fontSize="small" />
                   重新回复
                 </MenuItem>

                 <MenuItem
                   disabled={!msgMenuCanEdit}
                   onClick={() => {
                     const mid = msgMenuMid
                     const pending = msgMenuPending
                     const text = msgMenuText
                     closeMsgMenu()
                     startEditMessage(mid, text, pending)
                   }}
                   sx={{ gap: 1 }}
                 >
                   <EditOutlinedIcon fontSize="small" />
                   编辑
                 </MenuItem>

                 <MenuItem
                   disabled={!msgMenuMid}
                   onClick={() => {
                     const text = msgMenuText
                     closeMsgMenu()
                     controller.api?.clipboard?.writeText?.(text).then(
                       () => controller.api?.ui?.showToast?.('已复制'),
                       () => controller.api?.ui?.showToast?.('复制失败'),
                     )
                   }}
                   sx={{ gap: 1 }}
                 >
                   <ContentCopyIcon fontSize="small" />
                   复制
                 </MenuItem>

                 <MenuItem
                   disabled={!msgMenuMid || msgMenuPending || s.loading || s.sending}
                   onClick={() => {
                     const mid = msgMenuMid
                     const role = msgMenu.role
                     closeMsgMenu()
                     setConfirmDelMsg({ mid, role })
                   }}
                   sx={{ gap: 1 }}
                 >
                   <DeleteOutlineIcon fontSize="small" />
                   删除
                 </MenuItem>
               </Box>
             </Popover>

             <Dialog
               open={!!confirmDelMsg.mid}
               onClose={() => setConfirmDelMsg({ mid: '', role: 'assistant' })}
               maxWidth="xs"
               fullWidth
             >
               <DialogTitle>确认删除这条消息？</DialogTitle>
               <DialogContent>
                 <Typography variant="body2" color="text.secondary">
                   仅删除当前这条{confirmDelMsg.role === 'assistant' ? ' AI 回复' : '用户消息'}，不影响其他记录。
                 </Typography>
               </DialogContent>
               <DialogActions>
                 <Button onClick={() => setConfirmDelMsg({ mid: '', role: 'assistant' })}>取消</Button>
                 <Button
                   variant="contained"
                   color="error"
                   onClick={() => {
                     const mid = confirmDelMsg.mid
                     setConfirmDelMsg({ mid: '', role: 'assistant' })
                     controller.actions.deleteMessage?.(mid)
                   }}
                   disabled={!confirmDelMsg.mid || s.loading || s.sending}
                 >
                   删除
                 </Button>
               </DialogActions>
             </Dialog>

             <Dialog
               open={!!regen.mid}
               onClose={() => setRegen({ mid: '', role: 'assistant' })}
               maxWidth="xs"
               fullWidth
             >
               <DialogTitle>确认重新回复？</DialogTitle>
               <DialogContent>
                 <Typography variant="body2" color="text.secondary">
                   {regen.role === 'assistant' ? '这会用新内容覆盖当前 AI 回复。' : '这会基于该用户消息生成一条新的 AI 回复。'}
                 </Typography>
               </DialogContent>
               <DialogActions>
                 <Button onClick={() => setRegen({ mid: '', role: 'assistant' })}>取消</Button>
                 <Button
                   variant="contained"
                   color="warning"
                   onClick={() => {
                     const mid = regen.mid
                     const role = regen.role
                     setRegen({ mid: '', role: 'assistant' })
                     if (role === 'assistant') controller.actions.regenerateAssistant?.(mid)
                     else controller.actions.replyFromUserMessage?.(mid)
                   }}
                   disabled={!regen.mid || s.loading || s.sending}
                 >
                   重新回复
                 </Button>
               </DialogActions>
             </Dialog>

              <Box
                ref={composerRef}
                onClick={onClickOpenImageViewer}
                sx={{
                 position: 'absolute',
                 left: 16,
                 right: 16,
                 bottom: 16,
                p: 1.5,
                borderRadius: 18,
                bgcolor: `rgba(255,255,255,${composerOpacity / 100})`,
                boxShadow: '0 12px 28px rgba(0,0,0,.18)',
                backdropFilter: composerBlur > 0 ? `blur(${composerBlur}px)` : 'none',
                WebkitBackdropFilter: composerBlur > 0 ? `blur(${composerBlur}px)` : 'none',
              }}
            >
              <Stack spacing={1}>
                {Array.isArray(s.draft?.images) && s.draft.images.length ? (
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {s.draft.images.map((img: any) => (
                      <Box key={String(img?.id || '')} sx={{ position: 'relative' }}>
                        <Box
                          component="img"
                          data-fw-img="1"
                          src={String(img?.dataUrl || '')}
                          alt={String(img?.name || '图片')}
                          sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider', cursor: 'zoom-in' }}
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
                  <Tooltip title="图片">
                    <span>
                      <IconButton
                        aria-label="选择图片"
                        onClick={onPickImages}
                        disabled={s.loading || s.sending || !activeRole}
                        size="small"
                        sx={{
                          bgcolor: 'rgba(0,0,0,.05)',
                          borderRadius: '999px',
                          width: 36,
                          height: 36,
                          '&:hover': { bgcolor: 'rgba(0,0,0,.09)' },
                        }}
                      >
                        <ImageIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={8}
                    variant="outlined"
                    placeholder="输入消息…（Enter 发送 / Shift+Enter 换行；支持粘贴图片）"
                    value={String(s.draft?.input || '')}
                    onChange={(e) => controller.actions.setDraft('input', e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    disabled={s.loading || !activeRole}
                    sx={{
                      '& .MuiOutlinedInput-notchedOutline': { border: 0 },
                      '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
                      '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
                    }}
                  />

                  {isReplying ? (
                    <Button variant="contained" color="error" onClick={onStop} disabled={s.loading || !activeRole} sx={{ borderRadius: 999 }}>
                      停止
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      onClick={onSend}
                      disabled={s.loading || !activeRole || (!String(s.draft?.input || '').trim() && !(s.draft?.images || []).length)}
                      sx={{ borderRadius: 999 }}
                    >
                      发送
                    </Button>
                  )}
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
                          <Avatar src={String(r?.avatarImage || '') || undefined} sx={{ width: 28, height: 28, fontSize: 14 }}>
                            {String(r?.avatar || '🙂')}
                          </Avatar>
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
              const pendingChat = s?.pendingChat && String(s.pendingChat?.roleId || '') === String(role.id) ? s.pendingChat.chat : null
              const hasPending = !!pendingChat
              chats.sort((a: any, b: any) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
              return (
                <List dense sx={{ py: 0 }}>
                  {hasPending ? (
                    <ListItemButton selected sx={{ borderBottom: '1px solid', borderColor: 'divider', alignItems: 'flex-start' }}>
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
                  {chats.map((c: any) => {
                    const on = !hasPending && String(c?.id || '') === activeChatId
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
                        onContextMenu={(e) => onChatContextMenu(e, String(role?.id || ''), String(c?.id || ''), String(c?.title || '新聊天'))}
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

        <Popover
          open={!!chatMenu.chatId}
          onClose={closeChatMenu}
          anchorReference="anchorPosition"
          anchorPosition={chatMenu.chatId ? { top: chatMenu.y, left: chatMenu.x } : undefined}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          <Box sx={{ minWidth: 180, p: 0.5 }}>
            <MenuItem
              disabled={!chatMenu.chatId || !chatMenu.roleId || s.loading}
              onClick={() => {
                const { roleId, chatId, title } = chatMenu
                closeChatMenu()
                setEditingChatTitle({ roleId, chatId, text: String(title ?? '') })
              }}
              sx={{ gap: 1 }}
            >
              <EditOutlinedIcon fontSize="small" />
              编辑标题
            </MenuItem>
            <MenuItem
              disabled={!chatMenu.chatId || !chatMenu.roleId || s.loading || isSendingThisChat(chatMenu.roleId, chatMenu.chatId)}
              onClick={() => {
                const { roleId, chatId } = chatMenu
                closeChatMenu()
                setConfirmDelChat({ roleId, chatId })
              }}
              sx={{ gap: 1 }}
            >
              <DeleteOutlineIcon fontSize="small" />
              删除
            </MenuItem>
          </Box>
        </Popover>

        <Dialog
          open={!!editingChatTitle.chatId}
          onClose={() => setEditingChatTitle({ roleId: '', chatId: '', text: '' })}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>编辑会话标题</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="标题"
              placeholder="例如：需求讨论 / bug 复盘 / …"
              value={String(editingChatTitle.text ?? '')}
              onChange={(e) => setEditingChatTitle((p) => ({ ...p, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingChatTitle({ roleId: '', chatId: '', text: '' })
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const { roleId, chatId, text } = editingChatTitle
                  if (!roleId || !chatId || s.loading) return
                  setEditingChatTitle({ roleId: '', chatId: '', text: '' })
                  controller.actions.renameChat?.(roleId, chatId, String(text ?? ''))
                }
              }}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditingChatTitle({ roleId: '', chatId: '', text: '' })}>取消</Button>
            <Button
              variant="contained"
              onClick={() => {
                const { roleId, chatId, text } = editingChatTitle
                if (!roleId || !chatId || s.loading) return
                setEditingChatTitle({ roleId: '', chatId: '', text: '' })
                controller.actions.renameChat?.(roleId, chatId, String(text ?? ''))
              }}
              disabled={!editingChatTitle.roleId || !editingChatTitle.chatId || s.loading}
            >
              保存
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={!!confirmDelChat.chatId}
          onClose={() => setConfirmDelChat({ roleId: '', chatId: '' })}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>确认删除这个会话？</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              这会删除该会话下的全部消息记录，且不可恢复。
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmDelChat({ roleId: '', chatId: '' })}>取消</Button>
            <Button
              variant="contained"
              color="error"
              onClick={() => {
                const { roleId, chatId } = confirmDelChat
                setConfirmDelChat({ roleId: '', chatId: '' })
                if (!roleId || !chatId) return
                controller.actions.deleteChat?.(roleId, chatId)
              }}
              disabled={!confirmDelChat.roleId || !confirmDelChat.chatId || s.loading || isSendingThisChat(confirmDelChat.roleId, confirmDelChat.chatId)}
            >
              删除
            </Button>
          </DialogActions>
        </Dialog>
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
        </Box>

        <ProvidersDialog open={s.modal === 'providers'} controller={controller} providers={providers} draft={s.draft} />
        <RoleDialog open={s.modal === 'role'} controller={controller} providers={providers} draft={s.draft} models={s.models} />
        <ConfirmDialog open={s.modal === 'confirm'} controller={controller} draft={s.draft} roles={roles} providers={providers} />
        <MermaidDialog open={s.modal === 'mermaid'} controller={controller} mermaid={s.mermaid} />
        <ImageDialog open={s.modal === 'image'} controller={controller} viewer={s.imageViewer} />
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
  tab: 'appearance' | 'roles' | 'providers'
}) {
  const { controller, loading, data, roles, providers, draft, activeRoleId, tab } = props

  if (!data) {
    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${TOPBAR_H}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
        <Typography variant="body2" color="text.secondary">
          {loading ? '加载中…' : '未加载到数据'}
        </Typography>
      </Box>
    )
  }

  const transparentChatBg = !!data?.settings?.transparentChatBg
  const chatBgOpacity = clampNum(Number(data?.settings?.chatBgOpacity ?? 0), 0, 100)
  const chatBgBlur = clampNum(Number(data?.settings?.chatBgBlur ?? 0), 0, 24)
  const topbarOpacity = clampNum(Number(data?.settings?.topbarOpacity ?? 100), 0, 100)
  const topbarBlur = clampNum(Number(data?.settings?.topbarBlur ?? 0), 0, 24)
  const composerOpacity = clampNum(Number(data?.settings?.composerOpacity ?? 86), 40, 100)
  const composerBlur = clampNum(Number(data?.settings?.composerBlur ?? 10), 0, 24)
  const userMessageCollapseEnabled = !!data?.settings?.userMessageCollapseEnabled
  const userMessageCollapseLines = clampNum(Number(data?.settings?.userMessageCollapseLines ?? 8), 1, 50)

  const appearancePanel = (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>外观</Typography>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" alignItems="center" spacing={1}>
            <Switch size="small" checked={transparentChatBg} onChange={() => controller.actions.toggleTransparentChatBg?.()} />
            <Typography variant="body2" color="text.secondary">
              聊天背景透明
            </Typography>
          </Stack>
        </Stack>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              聊天背景透明度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(chatBgOpacity)}%
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={chatBgOpacity}
            min={0}
            max={100}
            step={1}
            onChange={(_e, v) => controller.actions.setChatBgOpacity?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setChatBgOpacity?.(v, true)}
            disabled={loading || !transparentChatBg}
          />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              聊天背景磨砂度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(chatBgBlur)}px
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={chatBgBlur}
            min={0}
            max={24}
            step={1}
            onChange={(_e, v) => controller.actions.setChatBgBlur?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setChatBgBlur?.(v, true)}
            disabled={loading || !transparentChatBg}
          />
        </Box>

        <Divider />

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              顶部栏透明度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(topbarOpacity)}%
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={topbarOpacity}
            min={0}
            max={100}
            step={1}
            onChange={(_e, v) => controller.actions.setTopbarOpacity?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setTopbarOpacity?.(v, true)}
            disabled={loading}
          />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              顶部栏磨砂度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(topbarBlur)}px
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={topbarBlur}
            min={0}
            max={24}
            step={1}
            onChange={(_e, v) => controller.actions.setTopbarBlur?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setTopbarBlur?.(v, true)}
            disabled={loading}
          />
        </Box>

        <Divider />

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              输入栏透明度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(composerOpacity)}%
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={composerOpacity}
            min={40}
            max={100}
            step={1}
            onChange={(_e, v) => controller.actions.setComposerOpacity?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setComposerOpacity?.(v, true)}
            disabled={loading}
          />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              输入栏磨砂度
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(composerBlur)}px
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={composerBlur}
            min={0}
            max={24}
            step={1}
            onChange={(_e, v) => controller.actions.setComposerBlur?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setComposerBlur?.(v, true)}
            disabled={loading}
          />
        </Box>

        <Divider />

        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>用户消息折叠</Typography>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" alignItems="center" spacing={1}>
            <Switch size="small" checked={userMessageCollapseEnabled} onChange={() => controller.actions.toggleUserMessageCollapse?.()} />
            <Typography variant="body2" color="text.secondary">
              启用
            </Typography>
          </Stack>
        </Stack>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              折叠行数
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {Math.round(userMessageCollapseLines)} 行
            </Typography>
          </Stack>
          <Slider
            size="small"
            value={userMessageCollapseLines}
            min={1}
            max={50}
            step={1}
            onChange={(_e, v) => controller.actions.setUserMessageCollapseLines?.(v, false)}
            onChangeCommitted={(_e, v) => controller.actions.setUserMessageCollapseLines?.(v, true)}
            disabled={loading || !userMessageCollapseEnabled}
          />
          <Typography variant="caption" color="text.secondary">
            用户消息超过该行数时默认折叠，可在消息中展开/收起。
          </Typography>
        </Box>
      </Stack>
    </Paper>
  )

  if (tab === 'appearance') {
    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${TOPBAR_H}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
        {appearancePanel}
      </Box>
    )
  }

  if (tab === 'roles') {
    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${TOPBAR_H}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
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
                        <Avatar src={String(r?.avatarImage || '') || undefined} sx={{ width: 28, height: 28, fontSize: 14 }}>
                          {String(r?.avatar || '🙂')}
                        </Avatar>
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
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${TOPBAR_H}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
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
                    <ApiKeyField value={String(draft?.providerApiKey || '')} onValueChange={(next) => controller.actions.setDraft('providerApiKey', next)} />
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
                    <ApiKeyField value={String(draft?.providerApiKey || '')} onValueChange={(next) => controller.actions.setDraft('providerApiKey', next)} />
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

  const editRoleId = String(draft?.editRoleId || '')
  const isNew = editRoleId === '__new__'

  const avatarEmoji = String(draft?.roleAvatar || '').trim() || '🙂'
  const avatarImage = String(draft?.roleAvatarImage || '').trim()
  const avatarCropSrc = String(draft?.roleAvatarImageCropSrc || '').trim()

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
        {isNew ? '新建角色' : '角色设置'}
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeModal()} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField label="角色名" value={String(draft?.roleName || '')} onChange={(e) => controller.actions.setDraft('roleName', e.target.value)} fullWidth />
            <TextField label="头像（表情，可选）" value={String(draft?.roleAvatar || '')} onChange={(e) => controller.actions.setDraft('roleAvatar', e.target.value)} sx={{ width: { xs: '100%', sm: 200 } }} />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Avatar src={avatarImage || undefined} sx={{ width: 44, height: 44, fontSize: 18 }}>
                {avatarEmoji}
              </Avatar>
              <Typography variant="body2" color="text.secondary">
                头像图片（可选）
              </Typography>
            </Stack>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ flexWrap: 'wrap' }}>
              <Button variant="outlined" onClick={() => controller.actions.pickRoleAvatarImage()} disabled={!!avatarCropSrc}>
                选择图片
              </Button>
              <Button variant="text" onClick={() => controller.actions.clearRoleAvatarImage()} disabled={!avatarImage && !avatarCropSrc}>
                清除图片
              </Button>
            </Stack>
          </Stack>

          {avatarCropSrc ? <RoleAvatarCropper controller={controller} src={avatarCropSrc} /> : null}

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
        {isNew ? (
          <Box />
        ) : (
          <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteRole(editRoleId)}>
            删除角色
          </Button>
        )}
        <Stack direction="row" spacing={1}>
          <Button onClick={() => controller.actions.closeModal()}>取消</Button>
          <Button variant="contained" onClick={() => controller.actions.saveRole()} disabled={!!avatarCropSrc}>
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
  const viewerZoom = Number(mermaid?.scale || 1)

  const stageElRef = React.useRef<HTMLDivElement | null>(null)
  const [stageEl, setStageEl] = React.useState<HTMLDivElement | null>(null)
  const setStageRef = React.useCallback((node: HTMLDivElement | null) => {
    stageElRef.current = node
    setStageEl(node)
  }, [])

  const dragRef = React.useRef<null | { x: number; y: number; sl: number; st: number; el: HTMLElement }>(null)
  const dragMovedRef = React.useRef(false)
  const dragDownRef = React.useRef<{ x: number; y: number } | null>(null)
  const userInteractedRef = React.useRef(false)

  const [contentSize, setContentSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [fitScale, setFitScale] = React.useState(1)
  const [stageSize, setStageSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const offsetRef = React.useRef(offset)
  offsetRef.current = offset

  const [zoom, setZoom] = React.useState(() => clampNum(viewerZoom, 0.2, 6))
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom

  React.useEffect(() => {
    if (!open) return
    const z = clampNum(viewerZoom, 0.2, 6)
    setZoom(z)
    zoomRef.current = z
  }, [open, svg, viewerZoom])

  React.useEffect(() => {
    if (!open || !svg) return setContentSize({ w: 0, h: 0 })
    const parseSvgSize = (raw: string) => {
      try {
        const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
        const root = doc.querySelector('svg') || doc.documentElement
        if (!root) return { w: 0, h: 0 }
        const vb = String(root.getAttribute('viewBox') || '').trim()
        if (vb) {
          const nums = vb
            .split(/[\s,]+/g)
            .map((x) => Number(x))
            .filter((x) => isFinite(x))
          if (nums.length >= 4) return { w: Math.max(0, nums[2]), h: Math.max(0, nums[3]) }
        }
        const w = String(root.getAttribute('width') || '').trim()
        const h = String(root.getAttribute('height') || '').trim()
        if (w.endsWith('%') || h.endsWith('%')) return { w: 0, h: 0 }
        const nw = parseFloat(w)
        const nh = parseFloat(h)
        return { w: Math.max(0, isFinite(nw) ? nw : 0), h: Math.max(0, isFinite(nh) ? nh : 0) }
      } catch (_) {
        return { w: 0, h: 0 }
      }
    }
    setContentSize(parseSvgSize(svg))
  }, [open, svg])

  React.useLayoutEffect(() => {
    if (!open) return
    const el = stageEl
    if (!el) return

    const calcFit = () => {
      const FIT_PAD = 0.92
      let w = Number(el.clientWidth || 0)
      let h = Number(el.clientHeight || 0)

      try {
        const cs = window.getComputedStyle(el)
        const px = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
        const py = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0')
        w = w - (isFinite(px) ? px : 0)
        h = h - (isFinite(py) ? py : 0)
      } catch (_) {}

      w = Math.max(0, w)
      h = Math.max(0, h)
      setStageSize({ w, h })
      if (!w || !h) return setFitScale(1)

      const iw = Number(contentSize.w || 0)
      const ih = Number(contentSize.h || 0)
      if (!iw || !ih) return setFitScale(1)

      let s = Math.min(w / iw, h / ih)
      if (s < 1) s = s * FIT_PAD
      s = Math.min(s, 1)
      setFitScale(isFinite(s) && s > 0 ? s : 1)
    }

    calcFit()

    if (typeof ResizeObserver === 'undefined') {
      let cancelled = false
      let raf = 0
      let tries = 0
      const tick = () => {
        if (cancelled) return
        tries += 1
        calcFit()
        if (tries < 10) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => {
        cancelled = true
        cancelAnimationFrame(raf)
      }
    }

    const ro = new ResizeObserver(() => calcFit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, stageEl, contentSize.w, contentSize.h])

  React.useEffect(() => {
    if (!open) return

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault()
      const dx = Number(e.clientX || 0) - d.x
      const dy = Number(e.clientY || 0) - d.y

      if (!dragMovedRef.current) {
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          dragMovedRef.current = true
          userInteractedRef.current = true
        }
      }

      setOffset(clampOffset({ x: d.sl + dx, y: d.st + dy }, stageSize, contentSize, fitScale, zoomRef.current))
    }
    const onUp = () => {
      dragRef.current = null
      dragDownRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [open, stageSize.w, stageSize.h, contentSize.w, contentSize.h, fitScale])

  const onStageMouseDown = useEvent((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const el = stageElRef.current
    if (!el) return
    e.preventDefault()
    dragMovedRef.current = false
    dragDownRef.current = { x: Number(e.clientX || 0), y: Number(e.clientY || 0) }
    dragRef.current = { x: Number(e.clientX || 0), y: Number(e.clientY || 0), sl: offsetRef.current.x, st: offsetRef.current.y, el }
  })

  const safeFit = isFinite(fitScale) && fitScale > 0 ? fitScale : 1
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const effectiveScale = safeFit * safeZoom

  const zoomAt = useEvent((localX: number, localY: number, nextZoom: number) => {
    const nz = clampNum(nextZoom, 0.2, 6)
    const z0 = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1
    if (nz === z0) return
    userInteractedRef.current = true
    const ratio = nz / z0
    const cur = offsetRef.current
    const next = {
      x: Number(localX || 0) - ratio * (Number(localX || 0) - cur.x),
      y: Number(localY || 0) - ratio * (Number(localY || 0) - cur.y),
    }
    setOffset(clampOffset(next, stageSize, contentSize, safeFit, nz))
    setZoom(nz)
    zoomRef.current = nz
    controller.actions.mermaidSetScale(nz)
  })

  const zoomBy = useEvent((factor: number) => {
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    zoomAt(sw / 2, sh / 2, zoomRef.current * factor)
  })

  const onReset = useEvent(() => {
    userInteractedRef.current = false
    setZoom(1)
    zoomRef.current = 1
    controller.actions.mermaidSetScale(1)
    setOffset({ x: 0, y: 0 })
  })

  React.useEffect(() => {
    if (!open) return
    userInteractedRef.current = false
    setOffset({ x: 0, y: 0 })
  }, [open, svg])

  React.useLayoutEffect(() => {
    if (!open) return
    if (userInteractedRef.current) return
    const iw = Number(contentSize.w || 0)
    const ih = Number(contentSize.h || 0)
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    if (!iw || !ih || !sw || !sh) return

    const contentW = iw * effectiveScale
    const contentH = ih * effectiveScale
    const cx = Math.floor((sw - contentW) / 2)
    const cy = Math.floor((sh - contentH) / 2)
    const next = clampOffset({ x: cx, y: cy }, stageSize, contentSize, safeFit, safeZoom)
    const cur = offsetRef.current
    if (next.x === cur.x && next.y === cur.y) return
    setOffset(next)
  }, [open, stageSize.w, stageSize.h, contentSize.w, contentSize.h, effectiveScale, safeFit, safeZoom])

  React.useEffect(() => {
    if (!open) return
    const el = stageEl
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!svg) return
      const dy = Number(e.deltaY || 0)
      if (!isFinite(dy) || dy === 0) return

      e.preventDefault()
      e.stopPropagation()
      userInteractedRef.current = true

      let localX = 0
      let localY = 0
      try {
        const r = el.getBoundingClientRect()
        localX = Number(e.clientX || 0) - r.left
        localY = Number(e.clientY || 0) - r.top

        const cs = window.getComputedStyle(el)
        const pl = parseFloat(cs.paddingLeft || '0')
        const pt = parseFloat(cs.paddingTop || '0')
        localX -= isFinite(pl) ? pl : 0
        localY -= isFinite(pt) ? pt : 0
      } catch (_) {}

      const factor = dy < 0 ? 1.12 : 1 / 1.12
      zoomAt(localX, localY, zoomRef.current * factor)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel as any)
  }, [open, svg, stageEl, stageSize.w, stageSize.h, contentSize.w, contentSize.h, safeFit, zoomAt])

  const onStageClick = useEvent((e: React.MouseEvent) => {
    if (!open || !svg) return
    if (!(e.target instanceof Element)) return
    if (e.target.closest('button,[role="button"]')) return
    if (dragMovedRef.current) return

    const el = stageElRef.current
    if (!el) return

    let localX = 0
    let localY = 0
    try {
      const r = el.getBoundingClientRect()
      localX = Number(e.clientX || 0) - r.left
      localY = Number(e.clientY || 0) - r.top
    } catch (_) {}

    const iw = Number(contentSize.w || 0) * effectiveScale
    const ih = Number(contentSize.h || 0) * effectiveScale
    const x0 = Number(offsetRef.current.x || 0)
    const y0 = Number(offsetRef.current.y || 0)
    const inside = iw > 0 && ih > 0 && localX >= x0 && localX <= x0 + iw && localY >= y0 && localY <= y0 + ih
    if (inside) return

    controller.actions.closeModal()
  })

  return (
    <Dialog
      open={open}
      onClose={() => controller.actions.closeModal()}
      fullScreen
      PaperProps={{ sx: { bgcolor: 'transparent', boxShadow: 'none' } }}
    >
      <Box sx={{ position: 'relative', width: '100vw', height: '100vh', bgcolor: 'rgba(0,0,0,.86)' }}>
        <Box
          ref={setStageRef}
          onMouseDown={onStageMouseDown}
          onClick={onStageClick}
          sx={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            cursor: svg ? 'grab' : 'default',
            touchAction: 'none',
          }}
        >
          {svg ? (
            <Box sx={{ transform: `translate(${offset.x}px,${offset.y}px)`, display: 'inline-block' }}>
              <Box sx={{ transformOrigin: '0 0', transform: `scale(${effectiveScale})`, display: 'inline-block', pointerEvents: 'none', userSelect: 'none' }}>
                <Box sx={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: svg }} />
              </Box>
            </Box>
          ) : (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography color="rgba(255,255,255,.7)">无可预览的 Mermaid</Typography>
            </Box>
          )}
        </Box>

        <Chip
          size="small"
          label={len ? `${idx + 1}/${len}` : '0/0'}
          sx={{ position: 'absolute', left: 12, top: 12, bgcolor: 'rgba(0,0,0,.45)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)' }}
        />

        <Box sx={{ position: 'absolute', right: 12, top: 10, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="缩小">
            <IconButton
              aria-label="缩小"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                zoomBy(1 / 1.12)
              }}
              sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
            >
              <ZoomOutIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="放大">
            <IconButton
              aria-label="放大"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                zoomBy(1.12)
              }}
              sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
            >
              <ZoomInIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="重置">
            <IconButton
              aria-label="重置"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onReset()
              }}
              sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
            >
              <RestartAltIcon />
            </IconButton>
          </Tooltip>
          <IconButton
            aria-label="关闭"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              controller.actions.closeModal()
            }}
            sx={{ bgcolor: 'rgba(0,0,0,.35)', color: 'rgba(255,255,255,.92)', border: '1px solid rgba(255,255,255,.18)', '&:hover': { bgcolor: 'rgba(0,0,0,.48)' } }}
          >
            <CloseIcon />
          </IconButton>
        </Box>

        <IconButton
          aria-label="上一张"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            controller.actions.mermaidPrev()
          }}
          disabled={len <= 1}
          sx={{
            position: 'absolute',
            left: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(0,0,0,.35)',
            color: 'rgba(255,255,255,.92)',
            border: '1px solid rgba(255,255,255,.18)',
            '&:hover': { bgcolor: 'rgba(0,0,0,.48)' },
          }}
        >
          <ChevronLeftIcon />
        </IconButton>

        <IconButton
          aria-label="下一张"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            controller.actions.mermaidNext()
          }}
          disabled={len <= 1}
          sx={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(0,0,0,.35)',
            color: 'rgba(255,255,255,.92)',
            border: '1px solid rgba(255,255,255,.18)',
            '&:hover': { bgcolor: 'rgba(0,0,0,.48)' },
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Box>
    </Dialog>
  )
}

function ImageDialog(props: { open: boolean; controller: any; viewer: any }) {
  const { open, controller, viewer } = props
  const items = Array.isArray(viewer?.items) ? viewer.items : []
  const len = items.length
  const idx = Math.max(0, Math.min(len - 1, Number(viewer?.index || 0)))
  const src = len ? String(items[idx]?.src || '') : ''
  const alt = len ? String(items[idx]?.alt || '图片') : '图片'
  const viewerZoom = Number(viewer?.scale || 1)

  const stageElRef = React.useRef<HTMLDivElement | null>(null)
  const [stageEl, setStageEl] = React.useState<HTMLDivElement | null>(null)
  const setStageRef = React.useCallback((node: HTMLDivElement | null) => {
    stageElRef.current = node
    setStageEl(node)
  }, [])
  const dragRef = React.useRef<null | { x: number; y: number; sl: number; st: number; el: HTMLElement }>(null)
  const dragMovedRef = React.useRef(false)
  const dragDownRef = React.useRef<{ x: number; y: number } | null>(null)
  const userInteractedRef = React.useRef(false)
  const [imgSize, setImgSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [fitScale, setFitScale] = React.useState(1)
  const [stageSize, setStageSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const offsetRef = React.useRef(offset)
  offsetRef.current = offset

  const [zoom, setZoom] = React.useState(() => clampNum(viewerZoom, 0.2, 6))
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom

  React.useEffect(() => {
    if (!open) return
    const z = clampNum(viewerZoom, 0.2, 6)
    setZoom(z)
    zoomRef.current = z
  }, [open, src, viewerZoom])

  React.useEffect(() => {
    if (!open || !src) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      setImgSize({ w: Number(img.naturalWidth || 0), h: Number(img.naturalHeight || 0) })
    }
    img.onerror = () => {
      if (!alive) return
      setImgSize({ w: 0, h: 0 })
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [open, src])

  React.useLayoutEffect(() => {
    if (!open) return
    const el = stageEl
    if (!el) return

    const calcFit = () => {
      const FIT_PAD = 0.92
      let w = Number(el.clientWidth || 0)
      let h = Number(el.clientHeight || 0)

      try {
        const cs = window.getComputedStyle(el)
        const px = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
        const py = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0')
        w = w - (isFinite(px) ? px : 0)
        h = h - (isFinite(py) ? py : 0)
      } catch (_) {}

      w = Math.max(0, w)
      h = Math.max(0, h)
      setStageSize({ w, h })
      if (!w || !h) return setFitScale(1)

      const iw = Number(imgSize.w || 0)
      const ih = Number(imgSize.h || 0)
      if (!iw || !ih) return setFitScale(1)

      let s = Math.min(w / iw, h / ih)
      if (s < 1) s = s * FIT_PAD
      s = Math.min(s, 1)
      setFitScale(isFinite(s) && s > 0 ? s : 1)
    }

    calcFit()

    if (typeof ResizeObserver === 'undefined') {
      let cancelled = false
      let raf = 0
      let tries = 0
      const tick = () => {
        if (cancelled) return
        tries += 1
        calcFit()
        if (tries < 10) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => {
        cancelled = true
        cancelAnimationFrame(raf)
      }
    }

    const ro = new ResizeObserver(() => calcFit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, stageEl, imgSize.w, imgSize.h])

  React.useEffect(() => {
    if (!open) return

      const onMove = (e: MouseEvent) => {
        const d = dragRef.current
        if (!d) return
        e.preventDefault()
        const dx = Number(e.clientX || 0) - d.x
        const dy = Number(e.clientY || 0) - d.y

       if (!dragMovedRef.current) {
         if (Math.abs(dx) + Math.abs(dy) > 3) {
           dragMovedRef.current = true
           userInteractedRef.current = true
         }
       }

      setOffset(clampOffset({ x: d.sl + dx, y: d.st + dy }, stageSize, imgSize, fitScale, zoomRef.current))
    }
    const onUp = () => {
      dragRef.current = null
      dragDownRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [open, stageSize.w, stageSize.h, imgSize.w, imgSize.h, fitScale])

  const onStageMouseDown = useEvent((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const el = stageElRef.current
    if (!el) return
    e.preventDefault()
    dragMovedRef.current = false
    dragDownRef.current = { x: Number(e.clientX || 0), y: Number(e.clientY || 0) }
    dragRef.current = { x: Number(e.clientX || 0), y: Number(e.clientY || 0), sl: offsetRef.current.x, st: offsetRef.current.y, el }
  })

  const safeFit = isFinite(fitScale) && fitScale > 0 ? fitScale : 1
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const effectiveScale = safeFit * safeZoom

  const zoomAt = useEvent((localX: number, localY: number, nextZoom: number) => {
    const nz = clampNum(nextZoom, 0.2, 6)
    const z0 = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1
    if (nz === z0) return
    userInteractedRef.current = true
    const ratio = nz / z0
    const cur = offsetRef.current
    const next = {
      x: Number(localX || 0) - ratio * (Number(localX || 0) - cur.x),
      y: Number(localY || 0) - ratio * (Number(localY || 0) - cur.y),
    }
    setOffset(clampOffset(next, stageSize, imgSize, safeFit, nz))
    setZoom(nz)
    zoomRef.current = nz
    controller.actions.imageSetScale(nz)
  })

  React.useEffect(() => {
    if (!open) return
    userInteractedRef.current = false
    setOffset({ x: 0, y: 0 })
  }, [open, src])

  React.useLayoutEffect(() => {
    if (!open) return
    if (userInteractedRef.current) return
    const iw = Number(imgSize.w || 0)
    const ih = Number(imgSize.h || 0)
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    if (!iw || !ih || !sw || !sh) return

    const contentW = iw * effectiveScale
    const contentH = ih * effectiveScale
    const cx = Math.floor((sw - contentW) / 2)
    const cy = Math.floor((sh - contentH) / 2)
    const next = clampOffset({ x: cx, y: cy }, stageSize, imgSize, safeFit, safeZoom)
    const cur = offsetRef.current
    if (next.x === cur.x && next.y === cur.y) return
    setOffset(next)
  }, [open, stageSize.w, stageSize.h, imgSize.w, imgSize.h, effectiveScale, safeFit, safeZoom])

  React.useEffect(() => {
    if (!open) return
    const el = stageEl
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!src) return
      const dy = Number(e.deltaY || 0)
      if (!isFinite(dy) || dy === 0) return

      e.preventDefault()
      e.stopPropagation()
      userInteractedRef.current = true

      let localX = 0
      let localY = 0
      try {
        const r = el.getBoundingClientRect()
        localX = Number(e.clientX || 0) - r.left
        localY = Number(e.clientY || 0) - r.top

        const cs = window.getComputedStyle(el)
        const pl = parseFloat(cs.paddingLeft || '0')
        const pt = parseFloat(cs.paddingTop || '0')
        localX -= isFinite(pl) ? pl : 0
        localY -= isFinite(pt) ? pt : 0
      } catch (_) {}

      const factor = dy < 0 ? 1.12 : 1 / 1.12
      zoomAt(localX, localY, zoomRef.current * factor)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel as any)
  }, [open, src, stageEl, stageSize.w, stageSize.h, imgSize.w, imgSize.h, safeFit, zoomAt])

  const onStageClick = useEvent((e: React.MouseEvent) => {
    if (!open || !src) return
    if (!(e.target instanceof Element)) return
    if (e.target.closest('button,[role="button"]')) return
    if (dragMovedRef.current) return

    const el = stageElRef.current
    if (!el) return

    let localX = 0
    let localY = 0
    try {
      const r = el.getBoundingClientRect()
      localX = Number(e.clientX || 0) - r.left
      localY = Number(e.clientY || 0) - r.top
    } catch (_) {}

    const iw = Number(imgSize.w || 0) * effectiveScale
    const ih = Number(imgSize.h || 0) * effectiveScale
    const x0 = Number(offsetRef.current.x || 0)
    const y0 = Number(offsetRef.current.y || 0)
    const inside = iw > 0 && ih > 0 && localX >= x0 && localX <= x0 + iw && localY >= y0 && localY <= y0 + ih
    if (inside) return

    controller.actions.closeModal()
  })

  return (
    <Dialog
      open={open}
      onClose={() => controller.actions.closeModal()}
      fullScreen
      PaperProps={{ sx: { bgcolor: 'transparent', boxShadow: 'none' } }}
    >
      <Box sx={{ position: 'relative', width: '100vw', height: '100vh', bgcolor: 'rgba(0,0,0,.86)' }}>
        <Box
          ref={setStageRef}
          onMouseDown={onStageMouseDown}
          onClick={onStageClick}
          sx={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            cursor: src ? 'grab' : 'default',
            touchAction: 'none',
          }}
        >
          {src ? (
            <Box sx={{ transform: `translate(${offset.x}px,${offset.y}px)`, display: 'inline-block' }}>
              <Box sx={{ transformOrigin: '0 0', transform: `scale(${effectiveScale})`, display: 'inline-block' }}>
                <Box
                  component="img"
                  src={src}
                  alt={alt}
                  draggable={false}
                  sx={{
                    display: 'block',
                    width: imgSize.w ? `${imgSize.w}px` : 'auto',
                    height: imgSize.h ? `${imgSize.h}px` : 'auto',
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                />
              </Box>
            </Box>
          ) : (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography color="rgba(255,255,255,.7)">无可预览的图片</Typography>
            </Box>
          )}
        </Box>

        <IconButton
          aria-label="上一张"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            controller.actions.imagePrev()
          }}
          disabled={len <= 1}
          sx={{
            position: 'absolute',
            left: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(0,0,0,.35)',
            color: 'rgba(255,255,255,.92)',
            border: '1px solid rgba(255,255,255,.18)',
            '&:hover': { bgcolor: 'rgba(0,0,0,.48)' },
          }}
        >
          <ChevronLeftIcon />
        </IconButton>

        <IconButton
          aria-label="下一张"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            controller.actions.imageNext()
          }}
          disabled={len <= 1}
          sx={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(0,0,0,.35)',
            color: 'rgba(255,255,255,.92)',
            border: '1px solid rgba(255,255,255,.18)',
            '&:hover': { bgcolor: 'rgba(0,0,0,.48)' },
          }}
        >
          <ChevronRightIcon />
        </IconButton>
      </Box>
    </Dialog>
  )
}

function clampOffset(
  offset: { x: number; y: number },
  stage: { w: number; h: number },
  img: { w: number; h: number },
  fit: number,
  zoom: number,
) {
  // 允许内容被拖出屏幕：这里只做数值归一化，不再做边界裁剪。
  // 保留签名是为了复用现有调用点（Image/Mermaid 共用）。
  void stage
  void img
  void fit
  void zoom
  return {
    x: isFinite(Number(offset?.x)) ? Number(offset.x) : 0,
    y: isFinite(Number(offset?.y)) ? Number(offset.y) : 0,
  }
}
