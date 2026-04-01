import * as React from 'react'
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Collapse,
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
import AttachFileIcon from '@mui/icons-material/AttachFile'
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
import MoreVertIcon from '@mui/icons-material/MoreVert'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { BUILTIN_TOOL_REQUEST_PRESETS, stringifyToolRequestRenderPreset } from '../core/toolRequestPresets'
import { IMAGE_VIEWER_ZOOM_MAX, MERMAID_VIEWER_ZOOM_MAX, VIEWER_ZOOM_MIN } from '../core/viewerZoom'

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

function SecretField(props: { label: string; value: string; onValueChange: (next: string) => void }) {
  const { label, value, onValueChange } = props
  const [visible, setVisible] = React.useState(false)

  const tip = visible ? `隐藏 ${label}` : `显示 ${label}`

  return (
    <TextField
      label={label}
      type={visible ? 'text' : 'password'}
      autoComplete="off"
      value={String(value || '')}
      onChange={(e) => onValueChange(e.target.value)}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={tip}>
              <IconButton size="small" aria-label={tip} onMouseDown={(e) => e.preventDefault()} onClick={() => setVisible((v) => !v)}>
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

function AssistantContent(props: {
  controller: any
  className?: string
  text: string
  mid: string
  toolRequestPresetKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
}) {
  const { controller, className, text, mid, toolRequestPresetKey, chatRootRef } = props
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useLayoutEffect(() => {
    if (!ref.current) return
    controller.renderAssistantInto(ref.current, text)
  }, [controller, text, toolRequestPresetKey])

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

const stickerSrcCache = new Map<string, string>()

function StickerInlineImage(props: { controller: any; path: string; label: string; size?: number }) {
  const { controller, path, label, size } = props
  const [src, setSrc] = React.useState('')

  React.useEffect(() => {
    const p = String(path || '').trim()
    if (!p) return

    const cached = stickerSrcCache.get(p)
    if (typeof cached === 'string' && cached) {
      setSrc(cached)
      return
    }

    let alive = true
    const api = controller?.api
    if (!api?.files?.images?.read) return

    api.files.images
      .read({ scope: 'data', path: p })
      .then((url: string) => {
        if (!alive) return
        const u = String(url || '')
        if (u.startsWith('data:')) stickerSrcCache.set(p, u)
        setSrc(u)
      })
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [controller, path])

  const s = clampNum(Number(size || 90), 32, 240)

  return (
    <Box
      component="img"
      data-fw-img="1"
      src={src || undefined}
      alt={label || 'sticker'}
      sx={{
        width: s,
        height: s,
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: 'middle',
        borderRadius: 12,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
        cursor: 'zoom-in',
      }}
    />
  )
}

type StickerSeg =
  | { kind: 'text'; text: string }
  | { kind: 'sticker'; raw: string; category: string; name: string }

function splitStickerSegments(input: string): StickerSeg[] {
  const s = String(input || '')
  if (!s) return [{ kind: 'text', text: '' }]

  const out: StickerSeg[] = []
  const re = /\[\[\s*(?:sticker|表情包)\s*:\s*([^\]\n]{1,220}?)\s*\]\]/g
  let last = 0
  let m: RegExpExecArray | null = null

  while ((m = re.exec(s))) {
    const idx = m.index
    const full = String(m[0] || '')
    const inner = String(m[1] || '').trim().replace(/\\/g, '/')

    if (idx > last) out.push({ kind: 'text', text: s.slice(last, idx) })

    const parts = inner
      .split('/')
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
    if (parts.length === 2) {
      out.push({ kind: 'sticker', raw: full, category: parts[0], name: parts[1] })
    } else {
      out.push({ kind: 'text', text: full })
    }

    last = idx + full.length
  }

  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  return out.length ? out : [{ kind: 'text', text: s }]
}

function StickerText(props: { controller: any; text: string; stickerMap: any }) {
  const { controller, text, stickerMap } = props
  const segs = React.useMemo(() => splitStickerSegments(String(text || '')), [text])

  return (
    <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
      {segs.map((seg, i) => {
        if (seg.kind === 'text') return <React.Fragment key={i}>{seg.text}</React.Fragment>
        const cat = String(seg.category || '').trim()
        const name = String(seg.name || '').trim()
        const relPath = stickerMap && typeof stickerMap === 'object' ? String(stickerMap?.[cat]?.[name]?.relPath || '') : ''
        if (!relPath) return <React.Fragment key={i}>{seg.raw}</React.Fragment>
        return <StickerInlineImage key={i} controller={controller} path={relPath} label={`${cat}/${name}`} />
      })}
    </Typography>
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
  const toolRequestRenderPreset = String((data?.settings as any)?.toolRequestRenderPreset || 'classic')
  const toolRequestRenderPresetsKey = (() => {
    const list = (data?.settings as any)?.toolRequestRenderPresets
    try {
      return JSON.stringify(list && typeof list === 'object' ? list : [])
    } catch (_) {
      return ''
    }
  })()
  const userMessageCollapseEnabled = !!data?.settings?.userMessageCollapseEnabled
  const userMessageCollapseLines = clampNum(Number(data?.settings?.userMessageCollapseLines ?? 8), 1, 50)
  const attachSendLimitChars = clampNum(Number(data?.settings?.attachments?.sendLimitChars ?? 80000), 1000, 2000000)
  const attachMaxFileSizeMbByKind0 = (data?.settings?.attachments as any)?.maxFileSizeMbByKind
  const attachMaxFileSizeMbByKind = attachMaxFileSizeMbByKind0 && typeof attachMaxFileSizeMbByKind0 === 'object' ? attachMaxFileSizeMbByKind0 : {}
  const attachMaxFileSizeMbTxt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.txt ?? 10), 0, 2048)
  const attachMaxFileSizeMbMd = clampNum(Number((attachMaxFileSizeMbByKind as any)?.md ?? 10), 0, 2048)
  const attachMaxFileSizeMbPdf = clampNum(Number((attachMaxFileSizeMbByKind as any)?.pdf ?? 10), 0, 2048)
  const attachMaxFileSizeMbDocx = clampNum(Number((attachMaxFileSizeMbByKind as any)?.docx ?? 10), 0, 2048)
  const attachMaxFileSizeMbPpt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.ppt ?? 10), 0, 2048)
  const stickersEnabled = !!data?.settings?.stickers?.enabled
  const stickerMap = data?.settings?.stickers?.map
  const stickerCategories = Array.isArray(data?.settings?.stickers?.categories) ? data.settings.stickers.categories : []
  const bgAlpha = transparentChatBg ? Math.max(chatBgOpacity / 100, chatBgBlur > 0 ? 0.01 : 0) : 1

  const activeRole = controller.activeRole()
  const activeChat = controller.activeChat()
  const isChatGenerating = React.useCallback((chat: any) => {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    return msgs.some((m: any) => m && m.role === 'assistant' && m.pending)
  }, [])
  const isSendingThisChat = React.useCallback(
    (roleId: string, chatId: string) => {
      const rid = String(roleId || '')
      const cid = String(chatId || '')
      if (!rid || !cid) return false
      const box = data?.chatsByRole?.[rid]
      const chats = Array.isArray(box?.chats) ? box.chats : []
      const chat = chats.find((c: any) => String(c?.id || '') === cid) || null
      return isChatGenerating(chat)
    },
    [data, isChatGenerating],
  )

  const chatRootRef = React.useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = React.useRef(true)
  const composerRef = React.useRef<HTMLDivElement | null>(null)
  const [composerHeight, setComposerHeight] = React.useState(0)

  const [page, setPage] = React.useState<'chat' | 'settings'>('chat')
  const [settingsTab, setSettingsTab] = React.useState<'appearance' | 'attachments' | 'roles' | 'providers' | 'services' | 'toolServer' | 'stickers'>('roles')

  const [expandedUserMsgIds, setExpandedUserMsgIds] = React.useState(() => new Set<string>())
  const [expandedToolMsgIds, setExpandedToolMsgIds] = React.useState(() => new Set<string>())

  React.useEffect(() => {
    setExpandedUserMsgIds(() => new Set())
    setExpandedToolMsgIds(() => new Set())
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

  const toggleExpandedToolMsg = useEvent((mid: string) => {
    const id = String(mid || '')
    if (!id) return
    setExpandedToolMsgIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  })

  const [rolePickerEl, setRolePickerEl] = React.useState<HTMLElement | null>(null)
  const [chatPickerEl, setChatPickerEl] = React.useState<HTMLElement | null>(null)
  const [tempModelPickerEl, setTempModelPickerEl] = React.useState<HTMLElement | null>(null)
  const [fileAdjust, setFileAdjust] = React.useState<{ el: HTMLElement | null; id: string }>({ el: null, id: '' })
  const [tempModelProviderId, setTempModelProviderId] = React.useState('')
  const [tempModelPick, setTempModelPick] = React.useState('')
  const [tempCustomModelId, setTempCustomModelId] = React.useState('')
  const composerInputRef = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  const backToHost = useEvent(() => {
    const host = (controller as any)?.api?.host
    if (host?.back) host.back()
    else controller?.api?.ui?.showToast?.('无法返回')
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

  const closeFileAdjust = useEvent(() => setFileAdjust({ el: null, id: '' }))
  const openFileAdjust = useEvent((e: React.MouseEvent<HTMLElement>, fileId: string) => {
    const id = String(fileId || '')
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    setFileAdjust({ el: e.currentTarget, id })
  })

  const [attachView, setAttachView] = React.useState<{ el: HTMLElement | null; mid: string; idx: number }>({ el: null, mid: '', idx: -1 })
  const closeAttachView = useEvent(() => setAttachView({ el: null, mid: '', idx: -1 }))
  const openAttachView = useEvent((e: React.MouseEvent<HTMLElement>, mid: string, idx: number) => {
    const id = String(mid || '').trim()
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    setAttachView({ el: e.currentTarget, mid: id, idx: Math.max(-1, Math.floor(Number(idx || 0))) })
  })

  const allMessages: any[] = Array.isArray(activeChat?.messages) ? (activeChat.messages as any[]) : []
  const msgIndexById = (() => {
    const m = new Map<string, number>()
    for (let i = 0; i < allMessages.length; i++) {
      const id = String(allMessages[i]?.id || '')
      if (!id) continue
      if (!m.has(id)) m.set(id, i)
    }
    return m
  })()
  const groupedAttMsgsByRootMid = (() => {
    const map = new Map<string, any[]>()
    for (const m of allMessages) {
      if (!m || m.role !== 'user') continue
      if (String(m?.groupRole || '') !== 'attachment') continue
      const parent = String(m?.groupParentMid || '').trim()
      if (!parent) continue
      const list = map.get(parent) || []
      list.push(m)
      map.set(parent, list)
    }
    return map
  })()
  const renderMessages = (() => {
    const out: any[] = []
    for (const m of allMessages) {
      if (!m) continue
      if (m.role !== 'user') {
        out.push(m)
        continue
      }
      if (String(m?.groupRole || '') === 'attachment' && String(m?.groupParentMid || '').trim()) continue
      out.push(m)
    }
    return out
  })()

  const lastMsg = renderMessages.length ? renderMessages[renderMessages.length - 1] : null
  const lastMsgId = String(lastMsg?.id || '')
  const lastMsgText = String(lastMsg?.content || '')
  const isReplying = Array.isArray(activeChat?.messages) && activeChat.messages.some((m: any) => m && m.role === 'assistant' && m.pending)
  const chatOverride = (activeChat && typeof activeChat === 'object' ? (activeChat as any).modelOverride : null) as any
  const overrideProviderId = String(chatOverride?.providerId || '').trim()
  const overrideModelId = String(chatOverride?.modelId || '').trim()
  const hasChatOverride = !!overrideProviderId && !!overrideModelId

  const roleProviderId = String((activeRole as any)?.modelRef?.providerId || '').trim()
  const roleModelId = String((activeRole as any)?.modelRef?.modelId || '').trim()

  const effectiveProviderId = hasChatOverride ? overrideProviderId : roleProviderId
  const effectiveModelId = hasChatOverride ? overrideModelId : roleModelId

  const modelLoading = !!(s as any)?.models?.loading
  const uiBusy = !!s.sending
  const chatLocked = isReplying
  const draftFiles: any[] = Array.isArray((s.draft as any)?.files) ? ((s.draft as any).files as any[]) : []
  const hasDraftFiles = draftFiles.length > 0
  const draftFilesPending = hasDraftFiles && draftFiles.some((f: any) => !!f?.pending)
  const draftFilesWarn =
    hasDraftFiles &&
    draftFiles.some((f: any) => {
      if (!f || f.pending) return false
      if (String(f?.error || '').trim()) return false
      const rawLen = String(f?.text || '').trim().length
      if (!rawLen) return false
      const pct = clampNum(Math.round(Number(f?.sendPct ?? 100)), 0, 100)
      const sendLen = Math.max(0, Math.ceil((rawLen * pct) / 100))
      return sendLen > attachSendLimitChars
    })

  const activeRoleId = String(activeRole?.id || '')
  const attachViewItem = (() => {
    const mid = String(attachView.mid || '').trim()
    const idx = Math.floor(Number(attachView.idx ?? -1))
    if (!mid || !activeChat || !Array.isArray((activeChat as any).messages) || idx < 0) return null
    const m = (activeChat as any).messages.find((x: any) => String(x?.id || '') === mid) || null
    const atts = m && Array.isArray(m.attachments) ? m.attachments : []
    const a = idx >= 0 && idx < atts.length ? atts[idx] : null
    if (!a) return null
    return { message: m, attachment: a }
  })()
  const chatNav = (() => {
    const loading = !!s.loading
    if (loading) return { olderId: '', newerId: '', lockedReason: '正在加载中' }
    if (!activeRoleId) return { olderId: '', newerId: '', lockedReason: '请先选择角色' }
    if (!data) return { olderId: '', newerId: '', lockedReason: '数据未就绪' }

    const box = data?.chatsByRole?.[activeRoleId]
    const chats = Array.isArray(box?.chats) ? box.chats.slice() : []
    chats.sort((a: any, b: any) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
    const ids = chats.map((c: any) => String(c?.id || '')).filter((id: string) => !!id)
    if (!ids.length) return { olderId: '', newerId: '', lockedReason: '暂无会话' }

    const cur = String(activeChat?.id || box?.activeChatId || ids[0] || '')
    const idx = ids.findIndex((id: string) => id === cur)
    const i = idx >= 0 ? idx : 0
    const olderId = i + 1 < ids.length ? ids[i + 1] : ''
    const newerId = i - 1 >= 0 ? ids[i - 1] : ''
    return { olderId, newerId, lockedReason: '' }
  })()

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

  const [sendWarn, setSendWarn] = React.useState<{ open: boolean; items: any[] }>({ open: false, items: [] })
  const closeSendWarn = useEvent(() => setSendWarn({ open: false, items: [] }))
  const confirmSendWarn = useEvent(() => {
    setSendWarn({ open: false, items: [] })
    stickToBottomRef.current = true
    controller.actions.send()
  })

  const onSend = useEvent(() => {
    stickToBottomRef.current = true
    if (draftFilesPending) return controller?.api?.ui?.showToast?.('文件解析中，请稍候…')
    const warns = draftFiles
      .map((f: any) => {
        if (!f || f.pending) return null
        const err = String(f?.error || '').trim()
        if (err) return null
        const rawLen = String(f?.text || '').trim().length
        if (!rawLen) return null
        const pct = clampNum(Math.round(Number(f?.sendPct ?? 100)), 0, 100)
        const sendLen = Math.max(0, Math.ceil((rawLen * pct) / 100))
        if (sendLen <= attachSendLimitChars) return null
        return { id: String(f?.id || ''), name: String(f?.name || '文件'), pct, rawLen, sendLen }
      })
      .filter(Boolean)
    if (warns.length) return setSendWarn({ open: true, items: warns })
    controller.actions.send()
  })
  const onStop = useEvent(() => controller.actions.stop?.())
  const onPickImages = useEvent(() => controller.actions.pickImages())
  const onPickFilesChanged = useEvent((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    if (!files.length) return
    controller.actions.addDraftFilesFromFiles?.(files)
  })
  const closeTempModelPicker = useEvent(() => setTempModelPickerEl(null))
  const openTempModelPicker = useEvent((e: React.MouseEvent<HTMLElement>) => {
    if (!activeRole) return
    if (!providers.length) return controller?.api?.ui?.showToast?.('暂无供应商')

    const pid0 = effectiveProviderId || String((providers[0] as any)?.id || '')
    const mid0 = effectiveModelId || ''

    const pid = String(pid0 || '').trim()
    const mid = String(mid0 || '').trim()

    setTempModelProviderId(pid)

    const p = providers.find((x: any) => String(x?.id || '') === pid) || null
    const items = Array.isArray(p?.modelsCache?.items) ? (p.modelsCache.items as any[]).map((x) => String(x)) : []
    const inList = !!mid && items.some((x: string) => x === mid)

    setTempModelPick(inList ? mid : mid ? '__custom__' : '')
    setTempCustomModelId(inList ? '' : mid)
    setTempModelPickerEl(e.currentTarget)
  })

  const onTempProviderChanged = useEvent((nextProviderId: string) => {
    const pid = String(nextProviderId || '').trim()
    setTempModelProviderId(pid)
    setTempModelPick('')
    setTempCustomModelId('')
  })

  const saveTempModelOverride = useEvent(() => {
    const pid = String(tempModelProviderId || '').trim()
    let mid = String(tempModelPick || '').trim()
    if (mid === '__custom__') mid = String(tempCustomModelId || '').trim()

    if (!pid) return controller?.api?.ui?.showToast?.('请选择供应商')
    if (!mid) return controller?.api?.ui?.showToast?.('请选择模型')

    controller.actions.setChatModelOverride?.(pid, mid)
    closeTempModelPicker()
  })

  const clearTempModelOverride = useEvent(() => {
    controller.actions.clearChatModelOverride?.()
    closeTempModelPicker()
  })
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
    if (pending || s.loading || uiBusy || chatLocked) return
    setEditingMsg({ mid, text: String(text ?? '') })
  })
  const cancelEditMessage = useEvent(() => setEditingMsg({ mid: '', text: '' }))
  const saveEditMessage = useEvent(() => {
    const mid = String(editingMsg.mid || '')
    if (!mid) return
    if (s.loading || uiBusy || chatLocked) return
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

  const openPluginSettings = useEvent((tab: 'appearance' | 'attachments' | 'roles' | 'providers' | 'services' | 'toolServer' | 'stickers' = 'roles') => {
    setRolePickerEl(null)
    setChatPickerEl(null)
    setSettingsTab(tab)
    setPage('settings')
  })
  const closePluginSettings = useEvent(() => setPage('chat'))

  const onPaste = useEvent((e: React.ClipboardEvent) => {
    if (s.loading || uiBusy || chatLocked) return
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
  const msgMenuIsToolResponse = msgMenuText.startsWith('<<<[TOOL_RESPONSE]>>>')
  const msgMenuPending = msgMenuMsg ? !!msgMenuMsg?.pending : !!msgMenu.pending
  const msgMenuCanEdit = !!msgMenuMid && !msgMenuPending && !s.loading && !uiBusy && !chatLocked

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
    !uiBusy &&
    !chatLocked &&
    !(msgMenuRegenRole === 'assistant' && msgMenuRegenPending)

  const fileAdjustItem = fileAdjust.id ? draftFiles.find((x: any) => String(x?.id || '') === String(fileAdjust.id || '')) : null
  const fileAdjustName = String(fileAdjustItem?.name || '文件')
  const fileAdjustPending = !!fileAdjustItem?.pending
  const fileAdjustError = String(fileAdjustItem?.error || '').trim()
  const fileAdjustRaw = String(fileAdjustItem?.text || '').trim()
  const fileAdjustFullLen = fileAdjustRaw.length
  const fileAdjustPct = clampNum(Math.round(Number(fileAdjustItem?.sendPct ?? 100)), 0, 100)
  const fileAdjustSendLen = Math.max(0, Math.ceil((fileAdjustFullLen * fileAdjustPct) / 100))
  const fileAdjustTooLong = !fileAdjustPending && !fileAdjustError && fileAdjustFullLen > 0 && fileAdjustSendLen > attachSendLimitChars

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
          '.prose img.fw-sticker': { maxWidth: 160, maxHeight: 160, width: 'auto', height: 'auto', display: 'inline-block', verticalAlign: 'middle', borderRadius: 12 },
          '.prose .fw-sticker-miss': { color: 'rgba(0,0,0,.55)' },
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
          // KaTeX 的上标/帽子等会超出行盒；inline 公式不要做滚动容器，否则很容易出现裁切或滚动条。
          '.prose .katex, .prose .katex-display': { maxWidth: '100%' },
          '.prose span.katex': { display: 'inline-block', overflow: 'visible', verticalAlign: 'middle' },
           '.prose .katex-display': { overflow: 'visible' },
           '.prose .katex-display > .katex': { display: 'block', overflowX: 'visible' },
          '.fw-math-host': { position: 'relative' },
          '.math-inline.fw-math-host': { display: 'inline-block' },
          '.math-block.fw-math-host': { display: 'block' },
          '.fw-math-copy': {
            position: 'absolute',
            width: 24,
            height: 24,
            padding: 0,
            borderRadius: 999,
            border: '1px solid transparent',
            background: 'transparent',
            color: 'rgba(0,0,0,.55)',
            cursor: 'pointer',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            lineHeight: 1,
            opacity: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
            transition: 'opacity 120ms ease',
            '&:hover': { background: 'rgba(0,0,0,.06)', borderColor: 'rgba(0,0,0,.12)', color: 'rgba(0,0,0,.72)' },
            '&:active': { background: 'rgba(0,0,0,.10)', borderColor: 'rgba(0,0,0,.12)', color: 'rgba(0,0,0,.76)' },
            '&:focus-visible': { outline: '2px solid rgba(25,118,210,.35)', outlineOffset: 2 },
          },
          '.math-inline.fw-math-host > .fw-math-copy': {
            left: '100%',
            top: '50%',
            transform: 'translate(6px, -50%)',
          },
          '.math-block.fw-math-host > .fw-math-copy': {
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
          },
          '.fw-math-host:hover > .fw-math-copy, .fw-math-host:focus-within > .fw-math-copy': {
            opacity: 1,
            visibility: 'visible',
            pointerEvents: 'auto',
          },
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
             paddingRight: 80,
           },
           '.mermaid-error-fix': {
             position: 'absolute',
             top: 8,
             right: 40,
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
           '.mermaid-error-err': { display: 'none' },
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
                  variant={settingsTab === 'attachments' ? 'contained' : 'outlined'}
                  onClick={() => setSettingsTab('attachments')}
                  sx={{ borderRadius: 999, minWidth: 0, px: 1.25, py: 0.25 }}
                >
                  附件
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
                  <Button
                    size="small"
                    variant={settingsTab === 'services' ? 'contained' : 'outlined'}
                    onClick={() => setSettingsTab('services')}
                    sx={{ borderRadius: 999, minWidth: 0, px: 1.25, py: 0.25 }}
                  >
                    AI 微服务
                  </Button>
                  <Button
                    size="small"
                    variant={settingsTab === 'toolServer' ? 'contained' : 'outlined'}
                    onClick={() => setSettingsTab('toolServer')}
                    sx={{ borderRadius: 999, minWidth: 0, px: 1.25, py: 0.25 }}
                  >
                    工具服务器
                  </Button>
                  <Button
                    size="small"
                    variant={settingsTab === 'stickers' ? 'contained' : 'outlined'}
                    onClick={() => setSettingsTab('stickers')}
                    sx={{ borderRadius: 999, minWidth: 0, px: 1.25, py: 0.25 }}
                 >
                   表情包
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

                <Tooltip title={chatNav.lockedReason || (chatNav.olderId ? '切换到较旧会话' : '没有更旧的会话')}>
                  <span>
                    <IconButton
                      onClick={() => controller.actions.setActiveChat(chatNav.olderId)}
                      size="small"
                      disabled={!!chatNav.lockedReason || !chatNav.olderId}
                      aria-label="切换到较旧会话"
                    >
                      <ChevronLeftIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={chatNav.lockedReason || (chatNav.newerId ? '切换到较新会话' : '没有更新的会话')}>
                  <span>
                    <IconButton
                      onClick={() => controller.actions.setActiveChat(chatNav.newerId)}
                      size="small"
                      disabled={!!chatNav.lockedReason || !chatNav.newerId}
                      aria-label="切换到较新会话"
                    >
                      <ChevronRightIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
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
                  {renderMessages.map((m: any) => {
                     const content = String(m?.content || '')
                     const isToolResponse = content.startsWith('<<<[TOOL_RESPONSE]>>>')
                     const mid = String(m?.id || '')
                     const isToolExpanded = !!mid && expandedToolMsgIds.has(mid)
                     const isEditing = editingMsg.mid === mid

                     if (isToolResponse) {
                       const resultTags = content.match(/<<\[RESULT-\d+\]>>/g) || []
                       const count = resultTags.length
                       const names = Array.from(content.matchAll(/tool_name:「start」([\s\S]*?)「end」/g))
                         .map((x) => String(x?.[1] || '').trim())
                         .filter(Boolean)
                       const statuses = Array.from(content.matchAll(/status:「start」([\s\S]*?)「end」/g))
                         .map((x) => String(x?.[1] || '').trim())
                         .filter(Boolean)
                       const pairs = names.slice(0, 3).map((n, i) => {
                         const st = statuses[i] || ''
                         return st ? `${n}（${st}）` : n
                       })
                       const summary = count ? `${count}项：${pairs.join('，')}${count > 3 ? '…' : ''}` : pairs.length ? pairs.join('，') : '工具结果'
                       const time = controller.fmtTime(Number(m?.createdAt || 0))

                       return (
                         <Stack key={mid} direction="row" justifyContent="flex-start">
                           <Paper
                             variant="outlined"
                             onContextMenu={isEditing ? undefined : (e) => onMessageContextMenu(e, mid, 'user', !!m?.pending)}
                              sx={{
                                width: '100%',
                                maxWidth: '100%',
                                px: 1.25,
                                py: 1.1,
                                bgcolor: 'rgba(2, 132, 199, .05)',
                                borderColor: 'rgba(2, 132, 199, .20)',
                              }}
                            >
                              <Stack
                                direction="row"
                                alignItems="center"
                                spacing={1}
                                role={isEditing ? undefined : 'button'}
                                tabIndex={isEditing ? -1 : 0}
                                aria-label={isEditing ? '工具返回（编辑中）' : isToolExpanded ? '收起工具返回' : '展开工具返回'}
                                aria-expanded={isEditing ? undefined : isToolExpanded}
                                onClick={isEditing ? undefined : () => toggleExpandedToolMsg(mid)}
                                onKeyDown={
                                  isEditing
                                    ? undefined
                                    : (e) => {
                                        const k = String((e as any)?.key || '')
                                        if (k === 'Enter' || k === ' ') {
                                          e.preventDefault()
                                          toggleExpandedToolMsg(mid)
                                        }
                                      }
                                }
                                sx={{ mb: 0.5, cursor: isEditing ? 'default' : 'pointer', userSelect: 'none' }}
                              >
                                <StorageIcon sx={{ fontSize: 18, color: 'rgba(2, 132, 199, .85)' }} />
                                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                                  工具返回
                                </Typography>
                                {summary ? (
                                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }} noWrap>
                                    {summary}
                                  </Typography>
                                ) : null}
                                <Box sx={{ flex: 1 }} />
                                <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary' }}>
                                  {isToolExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                                </Box>
                                <Typography variant="caption" color="text.secondary">
                                  {time}
                                </Typography>
                              </Stack>

                              {isEditing ? (
                                <Box sx={{ mt: 0.75 }}>
                                  <TextField
                                    autoFocus
                                    fullWidth
                                    multiline
                                    minRows={3}
                                    size="small"
                                    placeholder="编辑工具返回…"
                                    value={editingMsg.text}
                                    onChange={(e) => setEditingMsg((p) => ({ ...p, text: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') cancelEditMessage()
                                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveEditMessage()
                                    }}
                                  />
                                  <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
                                    <Button size="small" variant="contained" onClick={saveEditMessage} disabled={s.loading || uiBusy || chatLocked}>
                                      保存
                                    </Button>
                                    <Button size="small" onClick={cancelEditMessage} disabled={s.loading || uiBusy || chatLocked}>
                                      取消
                                    </Button>
                                  </Stack>
                                </Box>
                              ) : (
                                <Collapse in={isToolExpanded} timeout={160} unmountOnExit>
                                  <Box
                                    sx={{
                                      mt: 0.75,
                                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                      fontSize: 12,
                                      whiteSpace: 'pre-wrap',
                                      overflowWrap: 'anywhere',
                                      wordBreak: 'break-word',
                                      bgcolor: 'rgba(255,255,255,.7)',
                                      border: '1px solid rgba(2, 132, 199, .18)',
                                      borderRadius: 2,
                                      px: 1,
                                      py: 0.75,
                                    }}
                                  >
                                    {content}
                                  </Box>
                                </Collapse>
                              )}
                            </Paper>
                          </Stack>
                        )
                     }

                    const displayRole: 'user' | 'assistant' = m?.role === 'user' ? 'user' : 'assistant'
                    const isUser = displayRole === 'user'
                    const roleName = String(activeRole?.name || 'AI')
                    const roleAvatarEmoji = String(activeRole?.avatar || '🤖')
                    const roleAvatarImage = String(activeRole?.avatarImage || '')
                    const time = controller.fmtTime(Number(m?.createdAt || 0))
                    const imgPaths = isUser ? (Array.isArray(m?.images) ? m.images : []) : []
                    const attMsgs = isUser ? (groupedAttMsgsByRootMid.get(String(m?.id || '').trim()) || []) : []
                    const canEdit = !isEditing && !m?.pending && !s.loading && !uiBusy && !chatLocked && !!mid
                    const contentLines = userMessageCollapseEnabled && isUser ? content.split(/\r?\n/) : []
                    const canCollapse = userMessageCollapseEnabled && isUser && !isEditing && contentLines.length > userMessageCollapseLines
                    const isExpanded = !canCollapse || expandedUserMsgIds.has(mid)
                    const shownContent = canCollapse && !isExpanded ? contentLines.slice(0, userMessageCollapseLines).join('\n') : content

                    let regenRole: 'assistant' | 'user' = isUser ? 'user' : 'assistant'
                    let regenMid = mid
                    let regenPending = isUser ? false : !!m?.pending
                    if (isUser) {
                      const msgs = Array.isArray(activeChat.messages) ? (activeChat.messages as any[]) : []
                      const fullIdx = msgIndexById.get(mid) ?? -1
                      for (let j = fullIdx + 1; j < msgs.length; j++) {
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
                              {shownContent ? (
                                stickersEnabled ? (
                                  <StickerText controller={controller} text={shownContent} stickerMap={stickerMap} />
                                ) : (
                                  <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{shownContent}</Typography>
                                )
                              ) : attMsgs.length ? (
                                <Typography variant="body2" color="text.secondary">
                                  （附件）
                                </Typography>
                              ) : null}
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
                              {attMsgs.length ? (
                                <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                                  {attMsgs.slice(0, 20).map((am: any) => {
                                    const a = am && Array.isArray(am.attachments) ? am.attachments[0] : null
                                    if (!a) return null
                                    const childMid = String(am?.id || '').trim()
                                    if (!childMid) return null
                                    const name = String(a?.name || '文件')
                                    const pct = clampNum(Math.round(Number(a?.sendPct ?? 100)), 0, 100)
                                    const fullLen = clampNum(Math.round(Number(a?.fullLen ?? 0)), 0, 10_000_000)
                                    const sendLen = clampNum(Math.round(Number(a?.sendLen ?? String(a?.text || '').length ?? 0)), 0, fullLen || 0)
                                    const label = `${name}（${pct}%：${sendLen}/${fullLen}）`
                                    return (
                                      <Chip
                                        key={String(a?.id || childMid)}
                                        size="small"
                                        icon={<AttachFileIcon fontSize="small" />}
                                        label={label}
                                        variant="outlined"
                                        onClick={(e) => openAttachView(e as any, childMid, 0)}
                                        sx={{ maxWidth: 520 }}
                                      />
                                    )
                                  })}
                                </Stack>
                              ) : null}
                            </Box>
                          ) : (
                            <AssistantContent
                              controller={controller}
                              className="prose"
                              text={content}
                              mid={mid}
                              toolRequestPresetKey={`${toolRequestRenderPreset}|${toolRequestRenderPresetsKey}`}
                              chatRootRef={chatRootRef}
                            />
                          )}

                          {isEditing ? (
                            <Stack direction="row" spacing={1} sx={{ mt: 1 }} justifyContent="flex-end">
                              <Button size="small" variant="contained" onClick={saveEditMessage} disabled={s.loading || uiBusy || chatLocked}>
                                保存
                              </Button>
                              <Button size="small" onClick={cancelEditMessage} disabled={s.loading || uiBusy || chatLocked}>
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
                                    disabled={!regenMid || s.loading || uiBusy || chatLocked || (regenRole === 'assistant' && regenPending)}
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
               open={!!attachView.el && !!attachViewItem}
               anchorEl={attachView.el}
               onClose={closeAttachView}
               anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
               transformOrigin={{ vertical: 'top', horizontal: 'left' }}
             >
               <Box sx={{ width: 520, maxWidth: '84vw', p: 1.25 }}>
                 <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
                   <Typography sx={{ fontWeight: 900 }}>
                     {String(attachViewItem?.attachment?.name || '附件')}
                   </Typography>
                   <Stack direction="row" spacing={0.5}>
                     <Tooltip title="复制文本">
                       <IconButton
                         size="small"
                         aria-label="复制附件文本"
                         onClick={() => {
                           const text = String(attachViewItem?.attachment?.text || '')
                           const writeText = controller.api?.clipboard?.writeText
                           if (typeof writeText !== 'function') return controller.api?.ui?.showToast?.('未授权：clipboard.writeText')
                           Promise.resolve()
                             .then(() => writeText(text))
                             .then(() => controller.api?.ui?.showToast?.('已复制'))
                             .catch(() => controller.api?.ui?.showToast?.('复制失败'))
                         }}
                       >
                         <ContentCopyIcon fontSize="inherit" />
                       </IconButton>
                     </Tooltip>
                     <Tooltip title="关闭">
                       <IconButton size="small" aria-label="关闭附件预览" onClick={closeAttachView}>
                         <CloseIcon fontSize="inherit" />
                       </IconButton>
                     </Tooltip>
                   </Stack>
                 </Stack>

                 <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                   将发送：{Math.round(Number(attachViewItem?.attachment?.sendLen ?? 0))}/{Math.round(Number(attachViewItem?.attachment?.fullLen ?? 0))}（
                   {clampNum(Math.round(Number(attachViewItem?.attachment?.sendPct ?? 100)), 0, 100)}%）
                 </Typography>

                 <TextField
                   fullWidth
                   multiline
                   minRows={8}
                   maxRows={20}
                   size="small"
                   value={String(attachViewItem?.attachment?.text || '')}
                   inputProps={{ readOnly: true, style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } }}
                 />
               </Box>
             </Popover>

              <Popover
                open={!!msgMenu.mid}
                onClose={closeMsgMenu}
                anchorReference="anchorPosition"
                anchorPosition={msgMenu.mid ? { top: msgMenu.y, left: msgMenu.x } : undefined}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              >
                <Box sx={{ minWidth: 160, p: 0.5 }}>
                  {msgMenuIsToolResponse ? (
                    <>
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
                        disabled={!msgMenuMid}
                        onClick={() => {
                          const mid = msgMenuMid
                          closeMsgMenu()
                          if (!mid) return
                          toggleExpandedToolMsg(mid)
                        }}
                        sx={{ gap: 1 }}
                      >
                        {msgMenuMid && expandedToolMsgIds.has(msgMenuMid) ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                        {msgMenuMid && expandedToolMsgIds.has(msgMenuMid) ? '收起' : '展开'}
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
                        disabled={!msgMenuMid || msgMenuPending || s.loading || uiBusy || chatLocked}
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
                    </>
                  ) : (
                    <>
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
                        disabled={!msgMenuMid || msgMenuPending || s.loading || uiBusy || chatLocked}
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
                    </>
                  )}
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
                  disabled={!confirmDelMsg.mid || s.loading || uiBusy || chatLocked}
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
                   disabled={!regen.mid || s.loading || uiBusy || chatLocked}
                  >
                    重新回复
                  </Button>
                </DialogActions>
              </Dialog>

              <Dialog open={sendWarn.open} onClose={closeSendWarn} maxWidth="xs" fullWidth>
                <DialogTitle>附件超长提醒</DialogTitle>
                <DialogContent>
                  <Stack spacing={1.25} sx={{ pt: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      以下附件当前“实际发送长度”超过阈值（{Math.round(attachSendLimitChars)} 字符）。仍然发送可能导致响应慢或消耗更多 token。
                    </Typography>
                    <Stack spacing={0.75}>
                      {sendWarn.items.map((it: any, i: number) => (
                        <Paper key={String(it?.id || i)} variant="outlined" sx={{ p: 1 }}>
                          <Typography sx={{ fontWeight: 900 }} noWrap>
                            {String(it?.name || '文件')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            当前发送 {Math.round(Number(it?.pct ?? 100))}%：{Number(it?.sendLen || 0)}/{Number(it?.rawLen || 0)} 字符
                          </Typography>
                        </Paper>
                      ))}
                    </Stack>
                  </Stack>
                </DialogContent>
                <DialogActions>
                  <Button onClick={closeSendWarn}>取消</Button>
                  <Button variant="contained" color="warning" onClick={confirmSendWarn}>
                    仍然发送
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
                zIndex: 1299,
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

                {Array.isArray((s.draft as any)?.files) && (s.draft as any).files.length ? (
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {(s.draft as any).files.map((f: any) => {
                      const id = String(f?.id || '')
                      const name = String(f?.name || '文件')
                      const pending = !!f?.pending
                      const err = String(f?.error || '').trim()
                      const pct0 = Math.round(Number(f?.sendPct ?? 100))
                      const pct = clampNum(pct0, 0, 100)
                      const rawLen = String(f?.text || '').trim().length
                      const sendLen = Math.max(0, Math.ceil((rawLen * pct) / 100))
                      const warn = !pending && !err && rawLen > 0 && sendLen > attachSendLimitChars
                      const label = pending
                        ? `${name}（解析中…）`
                        : err
                          ? `${name}（失败）`
                          : warn
                            ? `${name}（超长提醒）`
                            : pct < 100
                              ? `${name}（${pct}%）`
                              : name
                      return (
                        <Chip
                          key={id || name}
                          size="small"
                          label={label}
                          variant="outlined"
                          color={err ? 'error' : warn ? 'warning' : 'default'}
                          onClick={id ? (e) => openFileAdjust(e as any, id) : undefined}
                          onDelete={id ? () => controller.actions.removeDraftFile?.(id) : undefined}
                          sx={{ maxWidth: 320 }}
                        />
                      )
                    })}
                  </Stack>
                ) : null}

                <Stack direction="row" spacing={1} alignItems="flex-end">
                  <Tooltip title="图片">
                    <span>
                      <IconButton
                        aria-label="选择图片"
                        onClick={onPickImages}
                       disabled={s.loading || uiBusy || chatLocked || !activeRole}
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

                  <Tooltip title="文件（txt/md/pdf/docx/ppt/pptx）">
                    <span>
                      <IconButton
                        aria-label="选择文件"
                        component="label"
                        disabled={s.loading || uiBusy || chatLocked || !activeRole}
                        size="small"
                        sx={{
                          bgcolor: 'rgba(0,0,0,.05)',
                          borderRadius: '999px',
                          width: 36,
                          height: 36,
                          '&:hover': { bgcolor: 'rgba(0,0,0,.09)' },
                        }}
                      >
                        <AttachFileIcon fontSize="small" />
                        <input
                          hidden
                          type="file"
                          multiple
                          accept=".txt,.md,.pdf,.docx,.ppt,.pptx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                          onChange={onPickFilesChanged}
                        />
                      </IconButton>
                    </span>
                  </Tooltip>


                  <Tooltip title="临时切换模型">
                    <span>
                      <IconButton
                        aria-label="临时切换模型"
                        onClick={openTempModelPicker}
                        disabled={s.loading || uiBusy || chatLocked || !activeRole || !providers.length}
                        size="small"
                        sx={{
                          bgcolor: 'rgba(0,0,0,.05)',
                          borderRadius: '999px',
                          width: 36,
                          height: 36,
                          '&:hover': { bgcolor: 'rgba(0,0,0,.09)' },
                        }}
                      >
                        <StorageIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>

                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={8}
                    variant="outlined"
                    placeholder="输入消息…（Enter 发送 / Shift+Enter 换行；支持粘贴图片/选择文件）"
                    value={String(s.draft?.input || '')}
                    inputRef={(el) => {
                      composerInputRef.current = el as any
                    }}
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
                      color={draftFilesWarn ? 'warning' : 'primary'}
                      onClick={onSend}
                      disabled={
                        s.loading ||
                        !activeRole ||
                        draftFilesPending ||
                        (!String(s.draft?.input || '').trim() && !(s.draft?.images || []).length && !hasDraftFiles)
                      }
                      sx={{ borderRadius: 999 }}
                    >
                      发送
                    </Button>
                  )}
                </Stack>

                {hasChatOverride ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {`临时模型：${overrideProviderId}${overrideModelId ? ` / ${overrideModelId}` : ''}`}
                    </Typography>

                    <Button size="small" variant="text" onClick={() => controller.actions.clearChatModelOverride?.()} disabled={s.loading || uiBusy || chatLocked}>
                      清除
                    </Button>
                  </Stack>
                ) : null}
              </Stack>
            </Box>
        </Box>

        <Popover
          open={!!tempModelPickerEl}
          anchorEl={tempModelPickerEl}
          onClose={closeTempModelPicker}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box data-area="temp-model" sx={{ width: 420, p: 1.5 }}>
            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                  当前会话临时模型
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" onClick={closeTempModelPicker}>
                  关闭
                </Button>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                仅影响当前会话；不修改角色设置。
              </Typography>

              <FormControl size="small" fullWidth>
                <InputLabel id="chat-override-provider">供应商</InputLabel>
                <Select
                  labelId="chat-override-provider"
                  label="供应商"
                  value={String(tempModelProviderId || '')}
                  onChange={(e) => onTempProviderChanged(String(e.target.value || ''))}
                  disabled={s.loading || uiBusy || chatLocked || !providers.length}
                >
                  {providers.map((pp: any) => (
                    <MenuItem key={String(pp?.id || '')} value={String(pp?.id || '')}>
                      {String(pp?.name || '')}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {(() => {
                const pid = String(tempModelProviderId || '')
                const p = providers.find((x: any) => String(x?.id || '') === pid) || null
                const items = Array.isArray(p?.modelsCache?.items) ? (p.modelsCache.items as any[]).map((x) => String(x)) : []

                return (
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <FormControl size="small" fullWidth>
                        <InputLabel id="chat-override-model">模型</InputLabel>
                        <Select
                          labelId="chat-override-model"
                          label="模型"
                          value={String(tempModelPick || '')}
                          onChange={(e) => setTempModelPick(String(e.target.value || ''))}
                          disabled={s.loading || uiBusy || chatLocked || !pid}
                        >
                          <MenuItem value="">
                            <em>请选择…</em>
                          </MenuItem>
                          {items.map((id: string) => (
                            <MenuItem key={id} value={id}>
                              {id}
                            </MenuItem>
                          ))}
                          <MenuItem value="__custom__">自定义模型ID…</MenuItem>
                        </Select>
                      </FormControl>

                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RefreshIcon />}
                        onClick={() => controller.actions.refreshModels(pid, true)}
                        disabled={!pid || modelLoading || s.loading || uiBusy || chatLocked}
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        {modelLoading ? '刷新中…' : '刷新'}
                      </Button>
                    </Stack>

                    {String(tempModelPick || '') === '__custom__' ? (
                      <TextField
                        size="small"
                        label="自定义模型ID"
                        value={String(tempCustomModelId || '')}
                        onChange={(e) => setTempCustomModelId(e.target.value)}
                        placeholder="例如：gpt-4.1-mini / deepseek-chat"
                        fullWidth
                      />
                    ) : null}
                  </Stack>
                )
              })()}

              <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
                <Button variant="text" onClick={clearTempModelOverride} disabled={!hasChatOverride || s.loading || uiBusy || chatLocked}>
                  清除临时模型（跟随角色）
                </Button>
                <Button variant="contained" onClick={saveTempModelOverride} disabled={s.loading || uiBusy || chatLocked || !tempModelProviderId}>
                  保存
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Popover>

        <Popover
          open={!!fileAdjust.el}
          anchorEl={fileAdjust.el}
          onClose={closeFileAdjust}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box data-area="file-adjust" sx={{ width: 420, p: 1.5 }}>
            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle2" sx={{ fontWeight: 900 }} noWrap>
                  附件：{fileAdjustName}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" onClick={closeFileAdjust}>
                  关闭
                </Button>
              </Stack>

              {!fileAdjustItem ? (
                <Typography variant="body2" color="text.secondary">
                  未找到该附件。
                </Typography>
              ) : fileAdjustPending ? (
                <Typography variant="body2" color="text.secondary">
                  解析中…
                </Typography>
              ) : fileAdjustError ? (
                <Typography variant="body2" color="error">
                  {fileAdjustError}
                </Typography>
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary">
                    文件文本长度：{fileAdjustFullLen}；阈值：{attachSendLimitChars}；当前将发送：{fileAdjustSendLen}
                  </Typography>

                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>
                        发送百分比
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography variant="caption" color={fileAdjustTooLong ? 'error' : 'text.secondary'}>
                        {fileAdjustPct}%
                      </Typography>
                    </Stack>
                    <Slider
                      size="small"
                      value={fileAdjustPct}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(_e, v) => controller.actions.setDraftFileSendPct?.(String(fileAdjust.id || ''), v)}
                    />
                    {fileAdjustTooLong ? (
                      <Typography variant="caption" sx={{ color: 'warning.main' }}>
                        超过阈值：点击发送时会弹出确认提醒。
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        发送时仅取文件开头部分；不会自动截断。超过阈值会在点击发送时提示确认。
                      </Typography>
                    )}
                  </Box>

                  <Paper variant="outlined" sx={{ p: 1, bgcolor: 'grey.50', maxHeight: 200, overflow: 'auto' }}>
                    <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                      {(() => {
                        const sendLen = clampNum(fileAdjustSendLen, 0, fileAdjustFullLen)
                        const snippet = fileAdjustRaw.slice(0, sendLen)
                        if (snippet.length <= 4000) return snippet
                        const head = snippet.slice(0, 1500).trimEnd()
                        const tail = snippet.slice(Math.max(0, snippet.length - 1500)).trimStart()
                        return `${head}\n\n…（中间省略 ${Math.max(0, snippet.length - head.length - tail.length)} 字符）…\n\n${tail}`
                      })()}
                    </Typography>
                  </Paper>
                  <Typography variant="caption" color="text.secondary">
                    预览显示“将发送内容”的开头与截断点附近片段（超过 4000 字符会省略中间）。
                  </Typography>
                </>
              )}
            </Stack>
          </Box>
        </Popover>

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
              这会删除该会话下的全部消息记录，且不可恢复；同时会尝试删除该会话引用的本地图片文件（若其它会话仍引用则会保留）。
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
            models={s.models}
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

function StickersSettingsPanel(props: { controller: any; loading: boolean; data: any }) {
  const { controller, loading, data } = props
  const api = controller?.api

  const cfg = data?.settings?.stickers && typeof data.settings.stickers === 'object' ? data.settings.stickers : {}
  const enabled = !!cfg.enabled
  const categories = Array.isArray(cfg.categories) ? (cfg.categories as any[]).map((x) => String(x || '')).filter((x) => !!x) : []
  const stickerMap = cfg.map && typeof cfg.map === 'object' ? cfg.map : {}

  const [cat, setCat] = React.useState('')
  const [filter, setFilter] = React.useState('')
  const [confirmDelCat, setConfirmDelCat] = React.useState('')
  const [catMenuEl, setCatMenuEl] = React.useState<HTMLElement | null>(null)
  const [createCat, setCreateCat] = React.useState<{ open: boolean; name: string }>({ open: false, name: '' })
  const [rename, setRename] = React.useState<{ open: boolean; oldName: string; nextName: string }>({
    open: false,
    oldName: '',
    nextName: '',
  })

  React.useEffect(() => {
    const cur = String(cat || '')
    if (cur && categories.includes(cur)) return
    setCat(categories.length ? categories[0] : '')
  }, [categories, cat])

  // 注意：stickerMap 内部会“就地修改”，object 引用可能不变；这里不要 useMemo，否则 UI 会卡在旧列表。
  const names = (() => {
    const box = stickerMap && typeof stickerMap === 'object' ? (stickerMap as any)[String(cat || '')] : null
    const list = box && typeof box === 'object' ? Object.keys(box).map((x) => String(x || '')).filter((x) => !!x) : []
    const q = String(filter || '').trim().toLowerCase()
    const filtered = q ? list.filter((n) => n.toLowerCase().includes(q)) : list
    filtered.sort((a, b) => a.localeCompare(b))
    return filtered
  })()

  const tokenFor = (category: string, name: string) => `[[sticker:${String(category || '')}/${String(name || '')}]]`

  const buildCategoryPrompt = useEvent((categoryName: string) => {
    const catName = String(categoryName || '').trim()
    if (!catName) return ''

    const box = stickerMap && typeof stickerMap === 'object' ? (stickerMap as any)[catName] : null
    const all = box && typeof box === 'object' ? Object.keys(box).map((x) => String(x || '')).filter((x) => !!x) : []
    all.sort((a, b) => a.localeCompare(b))

    const LIMIT = 120
    const shown = all.slice(0, LIMIT)
    const more = all.length > shown.length
    const listText = `|${shown.join('|')}${more ? '|…|' : '|'}`

    return `你可以使用「${catName}」表情包，调用方式为：[[sticker:${catName}/名称]]（可选尺寸：[[sticker:${catName}/名称/128]]，单位 px，范围 16~4096）\n${catName}表情包列表有：${listText}`
  })

  const copyCategoryPrompt = useEvent(() => {
    const name = String(cat || '').trim()
    if (!name) return api?.ui?.showToast?.('请先选择分类')
    const prompt = buildCategoryPrompt(name)
    if (!prompt) return
    const writeText = api?.clipboard?.writeText
    if (typeof writeText !== 'function') return api?.ui?.showToast?.('未授权：clipboard.writeText')
    Promise.resolve()
      .then(() => writeText(prompt))
      .then(() => api?.ui?.showToast?.('已复制提示词'))
      .catch(() => api?.ui?.showToast?.('复制失败'))
  })

  const openCatMenu = useEvent((e: React.MouseEvent<HTMLElement>) => setCatMenuEl(e.currentTarget))
  const closeCatMenu = useEvent(() => setCatMenuEl(null))

  const openCreateCat = useEvent(() => {
    closeCatMenu()
    setCreateCat({ open: true, name: '' })
  })

  const closeCreateCat = useEvent(() => setCreateCat({ open: false, name: '' }))

  const onConfirmCreateCat = useEvent(() => {
    const name = String(createCat.name || '').trim()
    if (!name) return api?.ui?.showToast?.('请输入分类名')
    closeCreateCat()
    controller.actions.createStickerCategory?.(name)
  })

  const onPickImages = useEvent(async () => {
    if (!cat) return api?.ui?.showToast?.('请先选择分类')
    if (!api?.files?.pickImages) return api?.ui?.showToast?.('未授权：files.pickImages')
    try {
      const items = await api.files.pickImages(30)
      await controller.actions.addStickersFromPickedImages?.(cat, items)
    } catch (e) {
      api?.ui?.showToast?.(String((e as any)?.message || e || '选择图片失败'))
    }
  })

  const onOpenRename = useEvent((oldName: string) => {
    const n = String(oldName || '').trim()
    if (!n) return
    setRename({ open: true, oldName: n, nextName: n })
  })

  const onConfirmRename = useEvent(() => {
    if (!rename.open) return
    const oldName = String(rename.oldName || '').trim()
    const nextName = String(rename.nextName || '').trim()
    setRename({ open: false, oldName: '', nextName: '' })
    if (!cat || !oldName || !nextName) return
    controller.actions.renameSticker?.(cat, oldName, nextName)
  })

  const box = stickerMap && typeof stickerMap === 'object' ? (stickerMap as any)[String(cat || '')] : null

  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${TOPBAR_H}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 900 }}>表情包</Typography>
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch size="small" checked={enabled} onChange={() => controller.actions.toggleStickersEnabled?.()} />
              <Typography variant="body2" color="text.secondary">
                渲染
              </Typography>
            </Stack>
          </Stack>
          <Divider />

          <Typography variant="caption" color="text.secondary">
            协议：在消息中写 {tokenFor('分类', '名称')}，客户端会按“分类+名称”查表渲染为本地图片（不需要后缀）。
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <FormControl size="small" fullWidth>
              <InputLabel id="sticker-cat-settings">分类</InputLabel>
              <Select
                labelId="sticker-cat-settings"
                value={String(cat || '')}
                label="分类"
                onChange={(e) => setCat(String(e.target.value || ''))}
                disabled={loading}
              >
                {categories.length ? (
                  categories.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))
                ) : (
                  <MenuItem value="">
                    <em>暂无分类</em>
                  </MenuItem>
                )}
              </Select>
            </FormControl>

            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={copyCategoryPrompt}
              disabled={loading || !cat || typeof api?.clipboard?.writeText !== 'function'}
              sx={{ whiteSpace: 'nowrap' }}
            >
              复制提示词
            </Button>

            <Tooltip title="分类操作">
              <span>
                <IconButton aria-label="分类操作" onClick={openCatMenu} disabled={loading} size="small">
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Button startIcon={<ImageIcon />} variant="outlined" onClick={onPickImages} disabled={loading || !cat}>
              上传
            </Button>
            <Box sx={{ flex: 1 }} />
            <TextField size="small" label="搜索表情名" value={filter} onChange={(e) => setFilter(e.target.value)} disabled={loading || !cat} />
          </Stack>

          {!cat ? (
            <Typography variant="body2" color="text.secondary">
              先创建/选择一个分类。
            </Typography>
          ) : !names.length ? (
            <Typography variant="body2" color="text.secondary">
              这个分类还没有表情包。
            </Typography>
          ) : (
            <Stack spacing={1}>
              {names.slice(0, 300).map((name) => {
                const relPath = box && typeof box === 'object' ? String((box as any)?.[name]?.relPath || '') : ''
                const token = tokenFor(cat, name)
                return (
                  <Paper key={name} variant="outlined" sx={{ p: 1.25 }}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      {relPath ? <StickerInlineImage controller={controller} path={relPath} label={token} size={64} /> : null}
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography sx={{ fontWeight: 900 }} noWrap>
                          {name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {token}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => controller.api?.clipboard?.writeText?.(token)}
                        disabled={!controller.api?.clipboard?.writeText}
                      >
                        复制 token
                      </Button>
                      <Button size="small" variant="outlined" onClick={() => onOpenRename(name)} disabled={loading}>
                        改名
                      </Button>
                      <Button size="small" color="error" variant="outlined" onClick={() => controller.actions.deleteSticker?.(cat, name)}>
                        删除
                      </Button>
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          )}
        </Stack>
      </Paper>

      <Dialog open={!!confirmDelCat} onClose={() => setConfirmDelCat('')} maxWidth="xs" fullWidth>
        <DialogTitle>确认删除分类？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            这会删除分类下的全部表情包映射，并尝试删除对应图片文件。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelCat('')}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const name = String(confirmDelCat || '')
              setConfirmDelCat('')
              controller.actions.deleteStickerCategory?.(name)
            }}
            disabled={!confirmDelCat || loading}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Popover
        open={!!catMenuEl}
        anchorEl={catMenuEl}
        onClose={closeCatMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ minWidth: 180, p: 0.5 }}>
          <MenuItem
            onClick={openCreateCat}
            disabled={loading}
            sx={{ gap: 1 }}
          >
            <AddIcon fontSize="small" />
            新建分类
          </MenuItem>
          <MenuItem
            onClick={() => {
              const name = String(cat || '')
              closeCatMenu()
              if (!name) return api?.ui?.showToast?.('请先选择分类')
              setConfirmDelCat(name)
            }}
            disabled={loading || !cat}
            sx={{ gap: 1 }}
          >
            <DeleteOutlineIcon fontSize="small" />
            删除当前分类
          </MenuItem>
        </Box>
      </Popover>

      <Dialog open={createCat.open} onClose={closeCreateCat} maxWidth="xs" fullWidth>
        <DialogTitle>新建分类</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <TextField
              autoFocus
              size="small"
              label="分类名"
              value={createCat.name}
              onChange={(e) => setCreateCat((p) => ({ ...p, name: e.target.value }))}
              placeholder="例如：通用"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCreateCat}>取消</Button>
          <Button variant="contained" onClick={onConfirmCreateCat} disabled={!String(createCat.name || '').trim() || loading}>
            创建
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rename.open} onClose={() => setRename({ open: false, oldName: '', nextName: '' })} maxWidth="xs" fullWidth>
        <DialogTitle>表情包改名</DialogTitle>
        <DialogContent>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <TextField size="small" label="原名称" value={rename.oldName} disabled fullWidth />
            <TextField
              autoFocus
              size="small"
              label="新名称"
              value={rename.nextName}
              onChange={(e) => setRename((p) => ({ ...p, nextName: e.target.value }))}
              fullWidth
            />
            <Typography variant="caption" color="text.secondary">
              新 token：{tokenFor(cat || '分类', rename.nextName || '名称')}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRename({ open: false, oldName: '', nextName: '' })}>取消</Button>
          <Button variant="contained" onClick={onConfirmRename} disabled={!String(rename.nextName || '').trim() || loading}>
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function ToolRequestPresetsDialog(props: { open: boolean; onClose: () => void; controller: any; loading: boolean; userPresets: any[] }) {
  const { open, onClose, controller, loading, userPresets } = props
  const api = controller?.api
  const toast = (s: string) => api?.ui?.showToast?.(s)

  const [editor, setEditor] = React.useState(() => ({ open: false, title: '', text: '' }))

  const presetsUser = Array.isArray(userPresets)
    ? userPresets
        .map((x: any) => ({ id: String(x?.id || '').trim(), name: String(x?.name || '').trim(), raw: x }))
        .filter((x: any) => x.id && x.name)
        .slice(0, 60)
    : []

  const openEditor = (title: string, text: string) => setEditor({ open: true, title, text })
  const closeEditor = () => setEditor({ open: false, title: '', text: '' })

  const copyPresetJson = useEvent((preset: any) => {
    const text = stringifyToolRequestRenderPreset(preset)
    if (!text) return toast('复制失败（预设为空）')
    controller.api?.clipboard?.writeText?.(text).then(
      () => toast('已复制 JSON'),
      () => toast('复制失败'),
    )
  })

  const sample = `{\n  \"id\": \"my_preset\",\n  \"name\": \"我的预设\",\n  \"badgeText\": \"TOOL\",\n  \"vars\": {\n    \"bg\": \"linear-gradient(90deg, rgba(2,6,23,.92), rgba(34,211,238,.18), rgba(99,102,241,.28), rgba(34,211,238,.18), rgba(2,6,23,.92))\",\n    \"bgSize\": \"300% 300%\",\n    \"bgPos\": \"0% 50%\",\n    \"bgAnim\": \"fw-toolreq-flow-x 2.8s linear infinite\",\n    \"border\": \"rgba(99,102,241,.45)\",\n    \"shadow\": \"0 10px 28px rgba(0,0,0,.22)\",\n    \"radius\": \"14px\",\n    \"pad\": \"10px 12px\",\n    \"summaryColor\": \"rgba(224,242,254,.96)\",\n    \"badgeBg\": \"rgba(34,211,238,.12)\",\n    \"badgeBorder\": \"rgba(34,211,238,.25)\",\n    \"badgeColor\": \"rgba(34,211,238,.95)\",\n    \"preBg\": \"rgba(2,6,23,.78)\",\n    \"prePad\": \"10px 12px\",\n    \"preRadius\": \"12px\",\n    \"preBorder\": \"rgba(99,102,241,.25)\",\n    \"preColor\": \"rgba(226,232,240,.95)\",\n    \"backdrop\": \"none\"\n  }\n}\n`

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          工具调用渲染预设管理
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="outlined"
            onClick={() => openEditor('导入/新建预设（JSON）', sample)}
            disabled={loading}
            sx={{ whiteSpace: 'nowrap' }}
          >
            导入/新建
          </Button>
          <IconButton size="small" onClick={onClose} aria-label="关闭">
            <CloseIcon fontSize="inherit" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            <Typography variant="caption" color="text.secondary">
              说明：预设只影响 AI 回复中的 TOOL_REQUEST 工具调用块；内置预设不可编辑，但可以复制 JSON 或“复制为自定义”。
            </Typography>

            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography sx={{ fontWeight: 900 }}>内置预设</Typography>
              </Stack>
              <Stack spacing={1}>
                {BUILTIN_TOOL_REQUEST_PRESETS.map((p: any) => {
                  const id = String(p?.id || '').trim()
                  if (!id) return null
                  return (
                    <Paper key={id} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography sx={{ fontWeight: 900 }} noWrap>
                            {String(p?.name || id)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {id}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <Button size="small" variant="text" startIcon={<ContentCopyIcon fontSize="inherit" />} onClick={() => copyPresetJson(p)}>
                            复制 JSON
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => controller.actions.cloneToolRequestRenderPreset?.(id)} disabled={loading}>
                            复制为自定义
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  )
                })}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography sx={{ fontWeight: 900 }}>自定义预设</Typography>
              </Stack>
              {presetsUser.length ? (
                <Stack spacing={1}>
                  {presetsUser.map((p: any) => {
                    const id = String(p?.id || '').trim()
                    return (
                      <Paper key={id} variant="outlined" sx={{ p: 1.25 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontWeight: 900 }} noWrap>
                              {String(p?.name || id)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {id}
                            </Typography>
                          </Box>
                          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <Button size="small" variant="text" startIcon={<ContentCopyIcon fontSize="inherit" />} onClick={() => copyPresetJson(p.raw)}>
                              复制 JSON
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<EditOutlinedIcon fontSize="inherit" />}
                              onClick={() => openEditor(`编辑预设（${id}）`, stringifyToolRequestRenderPreset(p.raw) || '')}
                              disabled={loading}
                            >
                              编辑
                            </Button>
                            <Button size="small" variant="outlined" onClick={() => controller.actions.cloneToolRequestRenderPreset?.(id)} disabled={loading}>
                              复制
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              variant="text"
                              startIcon={<DeleteOutlineIcon fontSize="inherit" />}
                              onClick={() => controller.actions.deleteToolRequestRenderPreset?.(id)}
                              disabled={loading}
                            >
                              删除
                            </Button>
                          </Stack>
                        </Stack>
                      </Paper>
                    )
                  })}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  暂无自定义预设
                </Typography>
              )}
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editor.open} onClose={closeEditor} fullWidth maxWidth="md">
        <DialogTitle>{editor.title || '编辑 JSON'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            <TextField
              value={editor.text}
              onChange={(e) => setEditor((p) => ({ ...p, text: e.target.value }))}
              placeholder={sample}
              multiline
              minRows={14}
              fullWidth
              disabled={loading}
              sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            />
            <Typography variant="caption" color="text.secondary">
              支持导入单个对象、数组，或形如 {`{ presets: [...] }`} 的对象。导入时会按 id 覆盖同名自定义预设。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditor}>取消</Button>
          <Button
            variant="contained"
            onClick={() => {
              controller.actions.importToolRequestRenderPresetJson?.(editor.text)
              closeEditor()
            }}
            disabled={loading}
          >
            导入/保存
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

function PluginSettingsPage(props: {
  controller: any
  loading: boolean
  data: any
  roles: any[]
  providers: any[]
  models: any
  draft: any
  activeRoleId: string
  tab: 'appearance' | 'attachments' | 'roles' | 'providers' | 'services' | 'toolServer' | 'stickers'
}) {
  const { controller, loading, data, roles, providers, models, draft, activeRoleId, tab } = props
  const [toolServerTest, setToolServerTest] = React.useState(() => ({ loading: false, ok: null as null | boolean, msg: '', detail: '' }))
  const [toolServerTools, setToolServerTools] = React.useState(() => ({
    open: false,
    loading: false,
    ok: null as null | boolean,
    msg: '',
    detail: '',
    tools: [] as any[],
    count: 0,
  }))
  const [toolReqPresetsOpen, setToolReqPresetsOpen] = React.useState(false)

  const runToolServerTest = useEvent(async (baseUrlRaw: string, tokenRaw: string) => {
    const api = controller?.api
    const toast = (s: string) => api?.ui?.showToast?.(s)

    const base = String(baseUrlRaw || '').trim().replace(/\/+$/g, '')
    const token = String(tokenRaw || '').trim()

    if (!base) {
      setToolServerTest({ loading: false, ok: false, msg: 'Base URL 为空', detail: '' })
      toast('请先填写 Base URL')
      return
    }
    if (!/^https?:\/\//i.test(base)) {
      setToolServerTest({ loading: false, ok: false, msg: 'Base URL 无效（需 http/https）', detail: base })
      toast('Base URL 无效（需 http/https）')
      return
    }
    if (typeof api?.net?.request !== 'function') {
      setToolServerTest({ loading: false, ok: false, msg: '未授权：net.request', detail: '' })
      toast('未授权：net.request')
      return
    }

    setToolServerTest({ loading: true, ok: null, msg: '测试中…', detail: '' })

    try {
      const r1 = await api.net.request({ method: 'GET', url: `${base}/health`, timeoutMs: 8000 })
      const s1 = Number(r1?.status || 0)
      const b1 = String(r1?.body || '')
      let j1: any = null
      try {
        j1 = JSON.parse(b1 || '{}')
      } catch (_) {}
      const healthOk = s1 >= 200 && s1 < 300 && String(j1?.status || '').trim().toLowerCase() === 'ok'
      if (!healthOk) {
        const msg = s1 ? `健康检查失败（HTTP ${s1}）` : '健康检查失败'
        setToolServerTest({ loading: false, ok: false, msg, detail: b1 || '' })
        toast(msg)
        return
      }

      // 可选：如果用户填了 token，则顺便测一下鉴权接口是否通过（空 calls 不会执行任何工具）。
      if (token) {
        const r2 = await api.net.request({
          method: 'POST',
          url: `${base}/internal/tool-call/execute`,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ timeout_ms: 1, calls: [] }),
          timeoutMs: 8000,
        })
        const s2 = Number(r2?.status || 0)
        const b2 = String(r2?.body || '')
        if (s2 < 200 || s2 >= 300) {
          const msg = `连通 OK，但鉴权失败（HTTP ${s2}）`
          setToolServerTest({ loading: false, ok: false, msg, detail: b2 || '' })
          toast(msg)
          return
        }

        setToolServerTest({ loading: false, ok: true, msg: '连通 OK，鉴权 OK', detail: '' })
        toast('工具服务器连接正常')
        return
      }

      setToolServerTest({ loading: false, ok: true, msg: '连通 OK', detail: '' })
      toast('工具服务器连接正常')
    } catch (e: any) {
      const msg = String(e?.message || e || '测试失败')
      setToolServerTest({ loading: false, ok: false, msg: '测试失败', detail: msg })
      toast(msg || '测试失败')
    }
  })

  const runToolServerFetchTools = useEvent(async (baseUrlRaw: string, tokenRaw: string) => {
    const api = controller?.api
    const toast = (s: string) => api?.ui?.showToast?.(s)

    const base = String(baseUrlRaw || '').trim().replace(/\/+$/g, '')
    const token = String(tokenRaw || '').trim()

    if (!base) {
      setToolServerTools((p) => ({ ...p, loading: false, ok: false, msg: 'Base URL 为空', detail: '', tools: [], count: 0 }))
      toast('请先填写 Base URL')
      return
    }
    if (!/^https?:\/\//i.test(base)) {
      setToolServerTools((p) => ({ ...p, loading: false, ok: false, msg: 'Base URL 无效（需 http/https）', detail: base, tools: [], count: 0 }))
      toast('Base URL 无效（需 http/https）')
      return
    }
    if (typeof api?.net?.request !== 'function') {
      setToolServerTools((p) => ({ ...p, loading: false, ok: false, msg: '未授权：net.request', detail: '', tools: [], count: 0 }))
      toast('未授权：net.request')
      return
    }

    setToolServerTools((p) => ({ ...p, loading: true, ok: null, msg: '加载中…', detail: '' }))

    try {
      const r = await api.net.request({
        method: 'GET',
        url: `${base}/api/tools`,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        timeoutMs: 8000,
      })
      const s = Number(r?.status || 0)
      const b = String(r?.body || '')
      let j: any = null
      try {
        j = JSON.parse(b || '{}')
      } catch (_) {}

      if (s < 200 || s >= 300) {
        const code = String(j?.error || '').trim()
        const detail =
          code === 'ui_key_not_set'
            ? '服务端未设置 TOOL_CALL_SERVER_UI_KEY（/api/* 管理接口需要这个 Key）。'
            : b || ''
        const msg = `获取工具列表失败（HTTP ${s}）`
        setToolServerTools((p) => ({ ...p, loading: false, ok: false, msg, detail, tools: [], count: 0 }))
        toast(msg)
        return
      }

      const tools = Array.isArray(j?.tools) ? j.tools : []
      const count = Number.isFinite(Number(j?.count)) ? Number(j.count) : tools.length
      setToolServerTools((p) => ({ ...p, loading: false, ok: true, msg: '获取成功', detail: '', tools, count }))
      toast('已获取工具列表')
    } catch (e: any) {
      const msg = String(e?.message || e || '请求失败')
      setToolServerTools((p) => ({ ...p, loading: false, ok: false, msg: '请求失败', detail: msg, tools: [], count: 0 }))
      toast(msg || '请求失败')
    }
  })

  React.useEffect(() => {
    setToolServerTest({ loading: false, ok: null, msg: '', detail: '' })
  }, [String((data?.settings?.toolCallServer as any)?.baseUrl || ''), String((data?.settings?.toolCallServer as any)?.token || '')])

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
  const toolRequestRenderPreset = String((data?.settings as any)?.toolRequestRenderPreset || 'classic')
  const toolRequestRenderPresets = Array.isArray((data?.settings as any)?.toolRequestRenderPresets) ? ((data?.settings as any).toolRequestRenderPresets as any[]) : []
  const userMessageCollapseEnabled = !!data?.settings?.userMessageCollapseEnabled
  const userMessageCollapseLines = clampNum(Number(data?.settings?.userMessageCollapseLines ?? 8), 1, 50)
  const attachSendLimitChars = clampNum(Number(data?.settings?.attachments?.sendLimitChars ?? 80000), 1000, 2000000)
  const attachMaxFileSizeMbByKind0 = (data?.settings?.attachments as any)?.maxFileSizeMbByKind
  const attachMaxFileSizeMbByKind = attachMaxFileSizeMbByKind0 && typeof attachMaxFileSizeMbByKind0 === 'object' ? attachMaxFileSizeMbByKind0 : {}
  const attachMaxFileSizeMbTxt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.txt ?? 10), 0, 2048)
  const attachMaxFileSizeMbMd = clampNum(Number((attachMaxFileSizeMbByKind as any)?.md ?? 10), 0, 2048)
  const attachMaxFileSizeMbPdf = clampNum(Number((attachMaxFileSizeMbByKind as any)?.pdf ?? 10), 0, 2048)
  const attachMaxFileSizeMbDocx = clampNum(Number((attachMaxFileSizeMbByKind as any)?.docx ?? 10), 0, 2048)
  const attachMaxFileSizeMbPpt = clampNum(Number((attachMaxFileSizeMbByKind as any)?.ppt ?? 10), 0, 2048)

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

        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              工具调用渲染预设
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
              <InputLabel id="toolreq-preset">预设</InputLabel>
              <Select
                labelId="toolreq-preset"
                label="预设"
                value={toolRequestRenderPreset}
                onChange={(e) => controller.actions.setToolRequestRenderPreset?.(String(e.target.value || ''))}
                disabled={loading}
              >
                {(() => {
                  const out: any[] = []
                  const builtinIds = new Set<string>(BUILTIN_TOOL_REQUEST_PRESETS.map((x) => String(x?.id || '').trim()).filter((x) => !!x))
                  const userItems = toolRequestRenderPresets
                    .map((x: any) => ({ id: String(x?.id || '').trim(), name: String(x?.name || '').trim() }))
                    .filter((x: any) => x.id && x.name && !builtinIds.has(x.id))
                    .slice(0, 60)

                  const active = String(toolRequestRenderPreset || '').trim()
                  const hasActive =
                    !active ||
                    BUILTIN_TOOL_REQUEST_PRESETS.some((x) => String(x?.id || '').trim() === active) ||
                    userItems.some((x: any) => x.id === active)
                  if (active && !hasActive) out.push(<MenuItem key="missing" value={active}>{`（未找到）${active}`}</MenuItem>)

                  for (const p of BUILTIN_TOOL_REQUEST_PRESETS) {
                    const id = String((p as any)?.id || '').trim()
                    if (!id) continue
                    out.push(
                      <MenuItem key={`builtin:${id}`} value={id}>
                        {`（内置）${String((p as any)?.name || id)}`}
                      </MenuItem>,
                    )
                  }
                  for (const p of userItems) {
                    out.push(
                      <MenuItem key={`user:${p.id}`} value={p.id}>
                        {`（自定义）${p.name}`}
                      </MenuItem>,
                    )
                  }
                  return out
                })()}
              </Select>
            </FormControl>
            <Button size="small" variant="outlined" onClick={() => setToolReqPresetsOpen(true)} disabled={loading}>
              管理…
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            仅影响 AI 回复中 TOOL_REQUEST 工具调用块的展示样式。
          </Typography>
          <ToolRequestPresetsDialog
            open={toolReqPresetsOpen}
            onClose={() => setToolReqPresetsOpen(false)}
            controller={controller}
            loading={loading}
            userPresets={toolRequestRenderPresets}
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

  if (tab === 'attachments') {
    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${TOPBAR_H}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
        <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
          <Stack spacing={1.25}>
            <Typography sx={{ fontWeight: 900 }}>附件</Typography>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  单文件长度阈值
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {Math.round(attachSendLimitChars)} 字符
                </Typography>
              </Stack>
              <Slider
                size="small"
                value={attachSendLimitChars}
                min={1000}
                max={2000000}
                step={5000}
                onChange={(_e, v) => controller.actions.setAttachmentsSendLimitChars?.(v, false)}
                onChangeCommitted={(_e, v) => controller.actions.setAttachmentsSendLimitChars?.(v, true)}
                disabled={loading}
              />
              <Typography variant="caption" color="text.secondary">
                当任一附件“实际发送长度”超过该阈值，点击发送会弹出确认提醒；可在输入栏的附件条目里单独调节“发送百分比”。
              </Typography>
            </Box>
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  单文件大小上限
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  MB（0 表示不限制）
                </Typography>
              </Stack>

              <Stack spacing={1} sx={{ mt: 1 }}>
                <TextField
                  size="small"
                  label="TXT"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbTxt))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('txt', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('txt', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
                <TextField
                  size="small"
                  label="MD"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbMd))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('md', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('md', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
                <TextField
                  size="small"
                  label="PDF"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbPdf))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('pdf', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('pdf', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
                <TextField
                  size="small"
                  label="DOCX"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbDocx))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('docx', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('docx', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
                <TextField
                  size="small"
                  label="PPT/PPTX"
                  type="number"
                  value={String(Math.round(attachMaxFileSizeMbPpt))}
                  onChange={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('ppt', e.target.value, false)}
                  onBlur={(e) => controller.actions.setAttachmentsMaxFileSizeMb?.('ppt', (e.target as any).value, true)}
                  inputProps={{ min: 0, max: 2048, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">MB</InputAdornment> }}
                  disabled={loading}
                />
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                超过上限会在解析前直接拒绝；0 表示不限制。
              </Typography>
            </Box>
          </Stack>
        </Paper>
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

  if (tab === 'stickers') {
    return <StickersSettingsPanel controller={controller} loading={loading} data={data} />
  }

  if (tab === 'toolServer') {
    const cfg = (data?.settings?.toolCallServer && typeof data.settings.toolCallServer === 'object') ? data.settings.toolCallServer : {}
    const baseUrl = String((cfg as any).baseUrl || '')
    const token = String((cfg as any).token || '')

    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${TOPBAR_H}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontWeight: 900 }}>工具服务器</Typography>
              <Box sx={{ flex: 1 }} />
            </Stack>
            <Divider />
            <Stack spacing={1.25}>
              <TextField
                size="small"
                label="Base URL"
                value={baseUrl}
                onChange={(e) => controller.actions.setToolCallServerBaseUrl?.(e.target.value)}
                placeholder="http://localhost:9083"
                fullWidth
                disabled={loading}
              />
              <SecretField label="鉴权 Key" value={token} onValueChange={(next) => controller.actions.setToolCallServerToken?.(next)} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Button size="small" variant="outlined" onClick={() => runToolServerTest(baseUrl, token)} disabled={loading || toolServerTest.loading}>
                  {toolServerTest.loading ? '测试中…' : '测试连接'}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setToolServerTools((p) => ({ ...p, open: true }))
                    runToolServerFetchTools(baseUrl, token)
                  }}
                  disabled={loading || toolServerTools.loading}
                >
                  {toolServerTools.loading ? '加载工具…' : '查看工具列表'}
                </Button>
                {toolServerTest.ok === true ? <Chip size="small" color="success" label="连接正常" /> : null}
                {toolServerTest.ok === false ? <Chip size="small" color="error" label="连接失败" /> : null}
                {toolServerTest.ok === null ? <Chip size="small" variant="outlined" label="未测试" /> : null}
                {toolServerTest.msg ? (
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }} noWrap>
                    {toolServerTest.msg}
                  </Typography>
                ) : null}
              </Stack>
              {toolServerTest.detail ? (
                <Typography
                  variant="caption"
                  sx={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    color: 'text.secondary',
                  }}
                >
                  {toolServerTest.detail}
                </Typography>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                用于执行 AI 工具调用（ai-tool-call-server）。鉴权 Key 会保存在插件数据中。
              </Typography>
            </Stack>
          </Stack>
        </Paper>
        <ToolServerToolsDialog
          open={toolServerTools.open}
          loading={toolServerTools.loading}
          ok={toolServerTools.ok}
          msg={toolServerTools.msg}
          detail={toolServerTools.detail}
          tools={toolServerTools.tools}
          count={toolServerTools.count}
          onClose={() => setToolServerTools((p) => ({ ...p, open: false }))}
          onRefresh={() => runToolServerFetchTools(baseUrl, token)}
        />
      </Box>
    )
  }

  if (tab === 'services') {
    const cfg = (data?.settings?.aiServices?.mermaidFix && typeof data.settings.aiServices.mermaidFix === 'object') ? data.settings.aiServices.mermaidFix : {}
    const enabled = !!cfg.enabled
    const providerId = String(cfg.providerId || providers?.[0]?.id || '')
    const modelPick = String(cfg.modelId || '')
    const customModelId = String(cfg.customModelId || '')
    const systemPrompt = typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : ''
    const defaultPrompt = String(controller?.defaults?.mermaidFixSystemPrompt || '')
    const promptChanged = !!defaultPrompt && systemPrompt.trim() !== defaultPrompt.trim()

    const p = providers.find((x: any) => String(x?.id || '') === providerId) || null
    const modelItems = Array.isArray(p?.modelsCache?.items) ? (p.modelsCache.items as any[]).map((x) => String(x)) : []
    const hasPickInList = !!modelPick && modelPick !== '__custom__' && modelItems.some((x) => x === modelPick)
    const modelLoading = !!models?.loading

    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${TOPBAR_H}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontWeight: 900 }}>AI 微服务</Typography>
              <Box sx={{ flex: 1 }} />
            </Stack>
            <Divider />

            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ fontWeight: 900 }}>Mermaid AI 修复</Typography>
                <Box sx={{ flex: 1 }} />
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Switch size="small" checked={enabled} onChange={(e) => controller.actions.setMermaidFixEnabled?.(e.target.checked)} />
                  <Typography variant="body2" color="text.secondary">
                    启用
                  </Typography>
                </Stack>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                Mermaid 渲染失败时，可在错误块中点击“AI 修复”，用选定供应商的模型按系统提示词修复源码并替换到消息里。
              </Typography>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="mmfix-provider">供应商</InputLabel>
                  <Select
                    labelId="mmfix-provider"
                    value={providerId}
                    label="供应商"
                    onChange={(e) => controller.actions.setMermaidFixProviderId?.(e.target.value)}
                    disabled={loading || !providers.length}
                  >
                    {providers.map((pp: any) => {
                      const id = String(pp?.id || '')
                      return (
                        <MenuItem key={id} value={id}>
                          {id}
                        </MenuItem>
                      )
                    })}
                  </Select>
                </FormControl>

                <Stack direction="row" spacing={1} sx={{ pt: { xs: 0, sm: 0.5 } }}>
                  <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => controller.actions.refreshModels(providerId, true)} disabled={!providerId || modelLoading}>
                    {modelLoading ? '刷新中…' : '刷新模型'}
                  </Button>
                </Stack>
              </Stack>

              <FormControl size="small" fullWidth>
                <InputLabel id="mmfix-model">模型</InputLabel>
                <Select
                  labelId="mmfix-model"
                  value={hasPickInList ? modelPick : modelPick === '__custom__' ? '__custom__' : ''}
                  label="模型"
                  onChange={(e) => controller.actions.setMermaidFixModelId?.(e.target.value)}
                  disabled={loading || !providerId}
                >
                  <MenuItem value="">
                    <em>请选择…</em>
                  </MenuItem>
                  {modelItems.map((id: string) => (
                    <MenuItem key={id} value={id}>
                      {id}
                    </MenuItem>
                  ))}
                  <MenuItem value="__custom__">自定义模型ID…</MenuItem>
                </Select>
              </FormControl>

              {modelPick === '__custom__' ? (
                <TextField
                  size="small"
                  label="自定义模型ID"
                  value={customModelId}
                  onChange={(e) => controller.actions.setMermaidFixCustomModelId?.(e.target.value)}
                  placeholder="例如：gpt-4.1-mini / deepseek-chat"
                  fullWidth
                />
              ) : null}

              <TextField
                size="small"
                label="系统提示词"
                value={systemPrompt}
                onChange={(e) => controller.actions.setMermaidFixSystemPrompt?.(e.target.value)}
                placeholder="写入系统提示词…"
                fullWidth
                multiline
                minRows={8}
              />

              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color={promptChanged ? 'warning.main' : 'text.secondary'}>
                  {promptChanged ? '已自定义系统提示词' : '当前为默认系统提示词'}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => controller.actions.resetMermaidFixSystemPromptDefault?.()}
                  disabled={!defaultPrompt || !promptChanged}
                >
                  恢复默认
                </Button>
              </Stack>
            </Stack>
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

function ToolServerToolsDialog(props: {
  open: boolean
  loading: boolean
  ok: null | boolean
  msg: string
  detail: string
  tools: any[]
  count: number
  onClose: () => void
  onRefresh: () => void
}) {
  const { open, loading, ok, msg, detail, tools, count, onClose, onRefresh } = props
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    if (!open) setExpanded({})
  }, [open])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorageIcon fontSize="small" />
        工具列表
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {Number.isFinite(count) ? `(${count})` : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={onRefresh} disabled={loading}>
          刷新
        </Button>
        <IconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25}>
          <Typography variant="caption" color="text.secondary">
            说明：该列表来自工具服务器 `GET /api/tools`，需要服务端配置 `TOOL_CALL_SERVER_UI_KEY` 并用 Bearer 鉴权。
          </Typography>

          {loading ? (
            <Typography variant="body2" color="text.secondary">
              加载中…
            </Typography>
          ) : ok === false ? (
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Stack spacing={0.75}>
                <Typography sx={{ fontWeight: 900 }}>获取失败</Typography>
                <Typography variant="body2" color="text.secondary">
                  {msg || '请求失败'}
                </Typography>
                {detail ? (
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      color: 'text.secondary',
                    }}
                  >
                    {detail}
                  </Typography>
                ) : null}
              </Stack>
            </Paper>
          ) : null}

          {!loading && ok === true ? (
            tools?.length ? (
              <Stack spacing={1}>
                {tools.map((t: any) => {
                  const name = String(t?.name || '')
                  const desc = String(t?.description || '')
                  const params = Array.isArray(t?.parameters) ? t.parameters : []
                  const isOpen = !!expanded[name]

                  return (
                    <Paper key={name || Math.random()} variant="outlined" sx={{ overflow: 'hidden' }}>
                      <ListItemButton
                        onClick={() => setExpanded((p) => ({ ...p, [name]: !p[name] }))}
                        sx={{ py: 0.75, alignItems: 'flex-start' }}
                      >
                        <ListItemText
                          primary={
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                              <Typography sx={{ fontWeight: 900 }}>{name || '(未命名工具)'}</Typography>
                              {params.length ? <Chip size="small" variant="outlined" label={`${params.length} 参数`} /> : <Chip size="small" variant="outlined" label="无参数" />}
                            </Stack>
                          }
                          secondary={
                            desc ? (
                              <Typography variant="caption" color="text.secondary">
                                {desc}
                              </Typography>
                            ) : null
                          }
                        />
                        {isOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </ListItemButton>
                      <Collapse in={isOpen} timeout={180} unmountOnExit>
                        <Divider />
                        <Box sx={{ p: 1.25 }}>
                          {desc ? (
                            <Typography variant="body2" sx={{ mb: params.length ? 1 : 0 }}>
                              {desc}
                            </Typography>
                          ) : null}
                          {params.length ? (
                            <Stack spacing={0.75}>
                              {params.map((p: any, idx: number) => {
                                const pn = String(p?.name || '')
                                const pt = String(p?.type || '')
                                const pr = !!p?.required
                                const pd = String(p?.description || '')
                                const def = String(p?.default || '')
                                return (
                                  <Paper key={`${pn}-${idx}`} variant="outlined" sx={{ p: 1 }}>
                                    <Stack spacing={0.25}>
                                      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                                        <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontWeight: 900 }}>
                                          {pn || '(未命名参数)'}
                                        </Typography>
                                        {pt ? <Chip size="small" variant="outlined" label={pt} /> : null}
                                        {pr ? <Chip size="small" color="warning" label="必填" /> : <Chip size="small" variant="outlined" label="可选" />}
                                        {def ? <Chip size="small" variant="outlined" label={`默认: ${def}`} /> : null}
                                      </Stack>
                                      {pd ? (
                                        <Typography variant="caption" color="text.secondary">
                                          {pd}
                                        </Typography>
                                      ) : null}
                                    </Stack>
                                  </Paper>
                                )
                              })}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              无参数
                            </Typography>
                          )}
                        </Box>
                      </Collapse>
                    </Paper>
                  )
                })}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                暂无工具，或当前鉴权 Key 无权访问工具列表。
              </Typography>
            )
          ) : null}
        </Stack>
      </DialogContent>
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

  const [zoom, setZoom] = React.useState(() => clampNum(viewerZoom, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX))
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom

  React.useEffect(() => {
    if (!open) return
    const z = clampNum(viewerZoom, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
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
    const nz = clampNum(nextZoom, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
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
    const iw = Number(contentSize.w || 0)
    const ih = Number(contentSize.h || 0)
    const sw = Number(stageSize.w || 0)
    const sh = Number(stageSize.h || 0)
    if (!iw || !ih || !sw || !sh) return setOffset({ x: 0, y: 0 })
    const contentW = iw * safeFit
    const contentH = ih * safeFit
    const cx = Math.floor((sw - contentW) / 2)
    const cy = Math.floor((sh - contentH) / 2)
    setOffset(clampOffset({ x: cx, y: cy }, stageSize, contentSize, safeFit, 1))
  })

  React.useLayoutEffect(() => {
    if (!open) return
    userInteractedRef.current = false
    dragRef.current = null
    dragDownRef.current = null
    dragMovedRef.current = false
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
      BackdropProps={{ sx: { bgcolor: 'transparent' } }}
      PaperProps={{ sx: { bgcolor: 'transparent', boxShadow: 'none' } }}
    >
      <Box sx={{ position: 'relative', width: '100vw', height: '100vh', bgcolor: 'rgba(255,255,255,.86)' }}>
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
              <Typography color="rgba(0,0,0,.7)">无可预览的 Mermaid</Typography>
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

  const [zoom, setZoom] = React.useState(() => clampNum(viewerZoom, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX))
  const zoomRef = React.useRef(zoom)
  zoomRef.current = zoom

  React.useEffect(() => {
    if (!open) return
    const z = clampNum(viewerZoom, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
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
    const nz = clampNum(nextZoom, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
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

  React.useLayoutEffect(() => {
    if (!open) return
    userInteractedRef.current = false
    dragRef.current = null
    dragDownRef.current = null
    dragMovedRef.current = false
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
