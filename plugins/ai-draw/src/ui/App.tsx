import * as React from 'react'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CssBaseline,
  Badge,
  Checkbox,
  Collapse,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Menu,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import InfoRoundedIcon from '@mui/icons-material/InfoRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import NavigateBeforeRoundedIcon from '@mui/icons-material/NavigateBeforeRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import CollectionsRoundedIcon from '@mui/icons-material/CollectionsRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import type { AiDrawFastWindowApi } from '../bridge/tauriCompat'
import { createAiDrawController } from '../controller/createController'
import { UI_MODE_LOCAL_EDIT, UI_MODE_NORMAL, type AiDrawProvider, type UiMode } from '../core/schema'
import { createClaudeTheme } from './theme'
import { OverlayScrollArea } from './components/OverlayScrollArea'

type SettingsTab = 'provider' | 'plugin'

function useAiDrawController(api: AiDrawFastWindowApi) {
  const controller = React.useMemo(() => createAiDrawController(api), [api])
  React.useEffect(() => {
    void controller.init()
    return () => {}
  }, [controller])

  // 注意：controller 内部是“原地修改 state 对象”，所以 getSnapshot 不能直接返回同一个引用。
  // 用 revision 作为快照触发重渲染，然后在 render 时读取最新 state。
  React.useSyncExternalStore(controller.subscribe, controller.getRevision, controller.getRevision)
  const revision = controller.getRevision()
  const state = controller.getState()
  return { controller, state, revision }
}

function activeProviderFromState(data: any): AiDrawProvider | null {
  if (!data) return null
  const pid = String(data.activeProviderId || '')
  const ps = Array.isArray(data.providers) ? data.providers : []
  return ps.find((p: any) => p && p.id === pid) || ps[0] || null
}

function EditImageSelector(props: {
  dataUrl: string
  sel: { x: number; y: number; w: number; h: number } | null
  onSelChange: (sel: { x: number; y: number; w: number; h: number } | null) => void
}) {
  const { dataUrl, sel, onSelChange } = props
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const imgRef = React.useRef<HTMLImageElement | null>(null)
  const dragRef = React.useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null)
  const cleanupRef = React.useRef<(() => void) | null>(null)

  const [imgBox, setImgBox] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

  const recomputeImgBox = React.useCallback(() => {
    const host = hostRef.current
    const img = imgRef.current
    if (!host || !img) return
    const hr = host.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    const width = Math.max(0, ir.width)
    const height = Math.max(0, ir.height)
    // ir 相对 host 的偏移（用于绘制选区 overlay）。
    setImgBox({ left: ir.left - hr.left, top: ir.top - hr.top, width, height })
  }, [])

  React.useLayoutEffect(() => {
    recomputeImgBox()
    const host = hostRef.current
    const img = imgRef.current
    if (!host || !img) return

    const ro = new ResizeObserver(() => recomputeImgBox())
    ro.observe(host)
    ro.observe(img)
    return () => ro.disconnect()
  }, [recomputeImgBox, dataUrl])

  const toRel = (clientX: number, clientY: number) => {
    const img = imgRef.current
    if (!img) return null
    const r = img.getBoundingClientRect()
    const x = clamp01((clientX - r.left) / Math.max(1, r.width))
    const y = clamp01((clientY - r.top) / Math.max(1, r.height))
    return { x, y }
  }

  const setFromPoints = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const x0 = Math.min(a.x, b.x)
    const y0 = Math.min(a.y, b.y)
    const x1 = Math.max(a.x, b.x)
    const y1 = Math.max(a.y, b.y)
    const w = Math.max(0, x1 - x0)
    const h = Math.max(0, y1 - y0)
    if (!(w > 0 && h > 0)) onSelChange(null)
    else onSelChange({ x: x0, y: y0, w, h })
  }

  const stopDrag = React.useCallback(() => {
    dragRef.current = null
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
  }, [])

  const minDragPx = 6

  const handleMove = React.useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      const d = dragRef.current
      if (!d || d.pointerId !== pointerId) return
      const p = toRel(clientX, clientY)
      if (!p) return

      // 不要在按下时就生成“一个固定大小的方块”。
      // 只有移动超过阈值后，才认为用户在框选。
      const imgW = Math.max(1, imgBox?.width || imgRef.current?.getBoundingClientRect().width || 1)
      const imgH = Math.max(1, imgBox?.height || imgRef.current?.getBoundingClientRect().height || 1)
      const dx = Math.abs(p.x - d.startX) * imgW
      const dy = Math.abs(p.y - d.startY) * imgH
      if (!d.moved && Math.max(dx, dy) < minDragPx) {
        // 仍处于“点击/微动”阶段：保持无选区。
        return
      }

      if (!d.moved) d.moved = true
      setFromPoints({ x: d.startX, y: d.startY }, p)
    },
    [imgBox, setFromPoints],
  )

  return (
    <Box
      ref={hostRef}
      sx={{
        position: 'relative',
        width: '100%',
        // 底图区域固定高度：图片完整显示（contain），容器内部不再“自然撑高”。
        height: 'min(540px, 67.5vh)',
        minHeight: 360,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 3,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={(e) => {
        if (!dataUrl) return
        const p = toRel(e.clientX, e.clientY)
        if (!p) return

        // 避免在可滚动容器中拖拽时触发滚动/选中文本。
        e.preventDefault()

        stopDrag()
        dragRef.current = { pointerId: e.pointerId, startX: p.x, startY: p.y, moved: false }
        ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)

        // 开始一次新的交互：先清空旧选区，避免“点一下就冒出方块”。
        onSelChange(null)

        // WebView 下 setPointerCapture 偶发不生效，这里加 window 级监听兜底。
        const onMove = (ev: PointerEvent) => {
          handleMove(ev.clientX, ev.clientY, ev.pointerId)
        }
        const onUp = (ev: PointerEvent) => {
          const d = dragRef.current
          if (!d || d.pointerId !== ev.pointerId) return
          stopDrag()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
        cleanupRef.current = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
        }
      }}
      onPointerMove={(e) => {
        handleMove(e.clientX, e.clientY, e.pointerId)
      }}
      onPointerUp={(e) => {
        const d = dragRef.current
        if (!d || d.pointerId !== e.pointerId) return
        stopDrag()
        ;(e.currentTarget as any).releasePointerCapture?.(e.pointerId)
      }}
      onPointerCancel={() => {
        stopDrag()
      }}
    >
      <Box
        component="img"
        ref={imgRef}
        src={dataUrl}
        alt="编辑底图"
        onLoad={() => recomputeImgBox()}
        sx={{ display: 'block', maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', background: '#fff' }}
      />
      {sel ? (
        <Box
          sx={{
            position: 'absolute',
            left: imgBox ? imgBox.left + sel.x * imgBox.width : `${sel.x * 100}%`,
            top: imgBox ? imgBox.top + sel.y * imgBox.height : `${sel.y * 100}%`,
            width: imgBox ? sel.w * imgBox.width : `${sel.w * 100}%`,
            height: imgBox ? sel.h * imgBox.height : `${sel.h * 100}%`,
            border: '2px solid rgba(201,100,66,0.95)',
            boxSizing: 'border-box',
            borderRadius: 0,
            background: 'rgba(201,100,66,0.10)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </Box>
  )
}

export function AiDrawApp(props: { api: AiDrawFastWindowApi }) {
  const { api } = props
  const theme = React.useMemo(() => createClaudeTheme(), [])
  const { controller, state, revision } = useAiDrawController(api)

  const data = state.data
  const provider = activeProviderFromState(data)
  const providers = Array.isArray(data?.providers) ? data!.providers : []

  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [promptLibOpen, setPromptLibOpen] = React.useState(false)
  const [promptHistoryOpen, setPromptHistoryOpen] = React.useState(false)
  const [promptHistoryMultiMode, setPromptHistoryMultiMode] = React.useState(false)
  const [promptHistorySelectedTexts, setPromptHistorySelectedTexts] = React.useState<string[]>([])
  const [promptHistoryDeleteConfirm, setPromptHistoryDeleteConfirm] = React.useState<{ open: boolean; texts: string[] }>({ open: false, texts: [] })
  const [promptHistoryItemMenu, setPromptHistoryItemMenu] = React.useState<{ open: boolean; x: number; y: number; text: string }>(
    { open: false, x: 0, y: 0, text: '' },
  )
  const [refLibraryOpen, setRefLibraryOpen] = React.useState(false)
  const [imageGalleryOpen, setImageGalleryOpen] = React.useState(false)
  const [imageGalleryLimit, setImageGalleryLimit] = React.useState(36)
  const imageGalleryScrollRef = React.useRef<HTMLDivElement | null>(null)
  const imageGallerySentinelRef = React.useRef<HTMLDivElement | null>(null)
  const imageGalleryLoadMoreCooldownRef = React.useRef(0)
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('provider')
  const [refLibraryLimit, setRefLibraryLimit] = React.useState(36)
  const refLibraryScrollRef = React.useRef<HTMLDivElement | null>(null)
  const refLibrarySentinelRef = React.useRef<HTMLDivElement | null>(null)
  const refLibraryLoadMoreCooldownRef = React.useRef(0)
  const [taskAnchorEl, setTaskAnchorEl] = React.useState<HTMLElement | null>(null)
  const [imageDetailAnchorEl, setImageDetailAnchorEl] = React.useState<HTMLElement | null>(null)
  const [normalMoreAnchorEl, setNormalMoreAnchorEl] = React.useState<HTMLElement | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false)
  const [refLibraryItemMenu, setRefLibraryItemMenu] = React.useState<{ el: HTMLElement | null; path: string }>({ el: null, path: '' })
  const [refFolderExpanded, setRefFolderExpanded] = React.useState<Record<string, boolean>>({})
  const [refFolderMenu, setRefFolderMenu] = React.useState<{ folderId: string; x: number; y: number; name: string }>(
    { folderId: '', x: 0, y: 0, name: '' },
  )
  const [addRefFolderDialog, setAddRefFolderDialog] = React.useState<{ open: boolean; parentId: string | null; name: string }>(
    { open: false, parentId: null, name: '' },
  )
  const [renameRefFolderDialog, setRenameRefFolderDialog] = React.useState<{ open: boolean; folderId: string; name: string }>(
    { open: false, folderId: '', name: '' },
  )
  const [deleteRefFolderConfirm, setDeleteRefFolderConfirm] = React.useState<{ open: boolean; folderId: string; name: string }>(
    { open: false, folderId: '', name: '' },
  )
  const [assignRefFolderDialog, setAssignRefFolderDialog] = React.useState<{
    open: boolean
    mode: 'set' | 'add'
    paths: string[]
    folderIds: string[]
  }>({ open: false, mode: 'set', paths: [], folderIds: [] })
  const [refMultiMode, setRefMultiMode] = React.useState(false)
  const [refSelectedPaths, setRefSelectedPaths] = React.useState<string[]>([])
  const [refMultiBusy, setRefMultiBusy] = React.useState(false)
  const [refMultiDeleteConfirm, setRefMultiDeleteConfirm] = React.useState<{ open: boolean; paths: string[] }>({ open: false, paths: [] })

  const [providerDeleteConfirm, setProviderDeleteConfirm] = React.useState<{ open: boolean; providerId: string; name: string }>({
    open: false,
    providerId: '',
    name: '',
  })

  const [promptFolderMenu, setPromptFolderMenu] = React.useState<{ folderId: string; x: number; y: number; name: string }>(
    { folderId: '', x: 0, y: 0, name: '' },
  )
  const [renamePromptFolderDialog, setRenamePromptFolderDialog] = React.useState<{ open: boolean; folderId: string; name: string }>(
    { open: false, folderId: '', name: '' },
  )
  const [deletePromptFolderConfirm, setDeletePromptFolderConfirm] = React.useState<{ open: boolean; folderId: string; name: string }>(
    { open: false, folderId: '', name: '' },
  )

  const [promptItemMenu, setPromptItemMenu] = React.useState<{ el: HTMLElement | null; folderId: string; promptId: string }>({
    el: null,
    folderId: '',
    promptId: '',
  })
  const [deletePromptConfirm, setDeletePromptConfirm] = React.useState<{ open: boolean; folderId: string; promptId: string }>({
    open: false,
    folderId: '',
    promptId: '',
  })

  const [addPromptItemDialog, setAddPromptItemDialog] = React.useState<{ open: boolean; text: string }>({ open: false, text: '' })

  const [promptHistoryQuery, setPromptHistoryQuery] = React.useState('')
  const [imageGalleryQuery, setImageGalleryQuery] = React.useState('')

  const [providerDraft, setProviderDraft] = React.useState<any>(null)
  const [pluginDraft, setPluginDraft] = React.useState<any>(null)

  React.useEffect(() => {
    if (!settingsOpen) return
    if (provider) {
      setProviderDraft({
        name: String(provider.name || ''),
        baseUrl: String(provider.baseUrl || ''),
        apiKey: String(provider.apiKey || ''),
        protocol: String(provider.protocol || 'images') === 'chat' ? 'chat' : 'images',
        modelsText: Array.isArray(provider.models) ? provider.models.join('\n') : '',
        model: String(provider.model || ''),
        customModel: String((provider as any).customModel || ''),
        size: String(provider.size || '1024x1024'),
        chatSystemPrompt: String((provider as any).chatSystemPrompt || ''),
      })
    }
    if (data) {
      setPluginDraft({
        autoSave: !!data.autoSave,
        shrinkRefImages: data.shrinkRefImages !== false,
        promptHistoryLimit: String(data.promptHistoryLimit ?? ''),
        requestTimeoutSec: String(data.requestTimeoutSec ?? ''),
      })
    }
  }, [settingsOpen, provider?.id, data?.version])

  React.useEffect(() => {
    if (!refLibraryOpen) return
    setRefLibraryLimit(36)
    setRefMultiMode(false)
    setRefSelectedPaths([])
    const root = refLibraryScrollRef.current
    if (root) root.scrollTop = 0
    void controller.loadRefLibraryIndex()
    void controller.refreshRefLibrary()
  }, [refLibraryOpen, controller])

  React.useEffect(() => {
    if (!imageGalleryOpen) return
    setImageGalleryLimit(36)
    const root = imageGalleryScrollRef.current
    if (root) root.scrollTop = 0
  }, [imageGalleryOpen])

  const refIndex = state.refLibrary.index
  const refFolders = Array.isArray(refIndex?.folders) ? refIndex!.folders : []
  const refFolderIdsByPath = refIndex && typeof (refIndex as any).folderIdsByPath === 'object' ? (refIndex as any).folderIdsByPath : {}
  const refActiveView = refIndex?.activeView || { kind: 'all' as const, folderId: refFolders[0]?.id || '' }

  const refFolderById = React.useMemo(() => {
    const m = new Map<string, any>()
    for (const f of refFolders) m.set(String((f as any)?.id || ''), f)
    return m
  }, [revision])

  const refChildrenByParent = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const f of refFolders) {
      const pid = String((f as any)?.parentId || '')
      const arr = map.get(pid) || []
      arr.push(String((f as any)?.id || ''))
      map.set(pid, arr)
    }
    return map
  }, [revision])

  const getRefItemFolderIds = React.useCallback((p: string) => {
    const raw = (refFolderIdsByPath as any)?.[p]
    return Array.isArray(raw) ? raw.map((x: any) => String(x || '').trim()).filter(Boolean) : []
  }, [revision])

  const refVisiblePathsAll = React.useMemo(() => {
    const paths = Array.isArray(state.refLibrary.paths) ? state.refLibrary.paths : []
    if (refActiveView.kind === 'all') return paths
    const fid = String(refActiveView.folderId || '').trim()
    if (!fid) return paths
    return paths.filter((p) => getRefItemFolderIds(p).includes(fid))
  }, [revision])

  const refActiveViewKey = refActiveView.kind === 'all' ? 'all' : `folder:${String(refActiveView.folderId || '').trim()}`
  const refSelectedSet = React.useMemo(() => new Set(refSelectedPaths), [refSelectedPaths])
  const refSelectedCount = refSelectedSet.size

  React.useEffect(() => {
    if (!refLibraryOpen) return
    setRefSelectedPaths([])
  }, [refLibraryOpen, refActiveViewKey])

  const refFolderImageCountById = React.useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of Array.isArray(state.refLibrary.paths) ? state.refLibrary.paths : []) {
      for (const fid of getRefItemFolderIds(p)) out[fid] = (out[fid] || 0) + 1
    }
    return out
  }, [revision])

  React.useEffect(() => {
    if (!refLibraryOpen) return
    const slice = refVisiblePathsAll.slice(0, Math.max(0, refLibraryLimit))
    for (const p of slice) controller.ensureRefLibraryItemLoaded(p)
  }, [refLibraryOpen, refLibraryLimit, refVisiblePathsAll, controller])

  React.useEffect(() => {
    if (!refLibraryOpen) return
    if (typeof IntersectionObserver === 'undefined') return
    const total = refVisiblePathsAll.length
    const limit = Math.max(0, refLibraryLimit)
    if (limit >= total) return

    const sentinel = refLibrarySentinelRef.current
    if (!sentinel) return

    const root = refLibraryScrollRef.current

    let done = false
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries && entries[0] && entries[0].isIntersecting
        if (!hit) return
        if (done) return
        done = true
        try {
          observer.disconnect()
        } catch {}
        setRefLibraryLimit((n) => Math.min(n + 36, total))
      },
      { root: root || null, rootMargin: '240px 0px', threshold: 0 },
    )

    try {
      observer.observe(sentinel)
    } catch {}

    return () => {
      done = true
      try {
        observer.disconnect()
      } catch {}
    }
  }, [refLibraryOpen, refLibraryLimit, refVisiblePathsAll.length])

  React.useEffect(() => {
    if (!refLibraryOpen) return
    let disposed = false
    let timer: any = null
    let poller: any = null
    let el: HTMLDivElement | null = null

    const attach = () => {
      if (disposed) return
      const next = refLibraryScrollRef.current
      if (!next) {
        timer = setTimeout(attach, 50)
        return
      }

      el = next

      const onScroll = () => {
        if (!el) return
        const total = refVisiblePathsAll.length
        const limit = Math.max(0, refLibraryLimit)
        if (limit >= total) return

        // 兜底：有些 WebView/滚动容器上 IntersectionObserver 可能不触发。
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 320
        if (!nearBottom) return

        const now = Date.now()
        if (now - refLibraryLoadMoreCooldownRef.current < 120) return
        refLibraryLoadMoreCooldownRef.current = now
        setRefLibraryLimit((n) => Math.min(n + 36, total))
      }

      el.addEventListener('scroll', onScroll, { passive: true })

      // 兜底：部分环境滚动事件可能不稳定，轮询判断是否接近底部。
      poller = setInterval(() => {
        try {
          onScroll()
        } catch {}
      }, 200)

      // 如果首屏内容不足以产生滚动条，也要自动补下一页。
      try {
        onScroll()
      } catch {}

      return () => {
        el?.removeEventListener('scroll', onScroll)
        if (poller) {
          try {
            clearInterval(poller)
          } catch {}
          poller = null
        }
      }
    }

    let detach: null | (() => void) = null
    detach = attach() || null

    return () => {
      disposed = true
      if (timer) {
        try {
          clearTimeout(timer)
        } catch {}
      }
      if (poller) {
        try {
          clearInterval(poller)
        } catch {}
      }
      if (detach) {
        try {
          detach()
        } catch {}
      }
    }
  }, [refLibraryOpen, refLibraryLimit, refVisiblePathsAll.length, refVisiblePathsAll])

  const toggleRefSelected = React.useCallback((path: string) => {
    const p = String(path || '').trim()
    if (!p) return
    setRefSelectedPaths((prev) => {
      const set = new Set(prev)
      if (set.has(p)) set.delete(p)
      else set.add(p)
      return Array.from(set)
    })
  }, [])

  const clearRefSelection = React.useCallback(() => {
    setRefSelectedPaths([])
  }, [])

  const uiMode: UiMode = String(state.uiMode || UI_MODE_NORMAL) === UI_MODE_LOCAL_EDIT ? UI_MODE_LOCAL_EDIT : UI_MODE_NORMAL
  const autoSave = !!data?.autoSave

  const imageIndexText =
    state.imageHistory.length && state.imageHistoryIndex >= 0
      ? `${state.imageHistoryIndex + 1}/${state.imageHistory.length}`
      : `0/${state.imageHistory.length}`

  const canImagePrev = state.imageHistory.length > 0 && (state.imageHistoryIndex === -1 || state.imageHistoryIndex > 0)
  const canImageNext = state.imageHistory.length > 0 && state.imageHistoryIndex >= 0 && state.imageHistoryIndex < state.imageHistory.length - 1

  const promptHistoryListNewestFirst = React.useMemo(() => {
    const list = Array.isArray(state.promptHistory) ? state.promptHistory : []
    return list.slice().reverse()
  }, [revision])

  const promptHistoryFiltered = React.useMemo(() => {
    const q = String(promptHistoryQuery || '').trim().toLowerCase()
    const list = promptHistoryListNewestFirst
    if (!q) return list
    return list.filter((x) => String(x || '').toLowerCase().includes(q))
  }, [promptHistoryListNewestFirst, promptHistoryQuery])

  const togglePromptHistorySelected = React.useCallback((text: string) => {
    const t = String(text || '').trim()
    if (!t) return
    setPromptHistorySelectedTexts((prev) => {
      const set = new Set(prev.map((x) => String(x || '').trim()).filter(Boolean))
      if (set.has(t)) set.delete(t)
      else set.add(t)
      return Array.from(set)
    })
  }, [])

  const clearPromptHistorySelection = React.useCallback(() => {
    setPromptHistorySelectedTexts([])
  }, [])

  const promptHistorySelectedSet = React.useMemo(
    () => new Set(promptHistorySelectedTexts.map((x) => String(x || '').trim()).filter(Boolean)),
    [promptHistorySelectedTexts],
  )

  const promptHistorySelectedCount = promptHistorySelectedSet.size

  React.useEffect(() => {
    if (!promptHistoryOpen) return
    // 打开弹窗时不强行切换模式，但清空上次选中，避免误删。
    clearPromptHistorySelection()
    setPromptHistoryItemMenu({ open: false, x: 0, y: 0, text: '' })
  }, [promptHistoryOpen, clearPromptHistorySelection])

  const imageHistoryListNewestFirst = React.useMemo(() => {
    const list = Array.isArray(state.imageHistory) ? state.imageHistory : []
    return list.slice().reverse()
  }, [revision])

  const imageHistoryFiltered = React.useMemo(() => {
    const q = String(imageGalleryQuery || '').trim().toLowerCase()
    const list = imageHistoryListNewestFirst
    if (!q) return list
    return list.filter((it) => String(it?.savedPath || '').toLowerCase().includes(q))
  }, [imageHistoryListNewestFirst, imageGalleryQuery])

  const imageGalleryShownCount = Math.min(Math.max(0, imageGalleryLimit), imageHistoryFiltered.length)

  React.useEffect(() => {
    if (!imageGalleryOpen) return
    // 搜索条件变化时，重置为首屏并滚到顶部。
    setImageGalleryLimit(36)
    const root = imageGalleryScrollRef.current
    if (root) root.scrollTop = 0
  }, [imageGalleryOpen, imageGalleryQuery])

  React.useEffect(() => {
    if (!imageGalleryOpen) return
    // 参考图库同款机制：对当前 slice(0, limit) 做 ensure。
    // controller 内部有并发限流与重试节流，避免一次性并发太多导致卡顿。
    const slice = imageHistoryFiltered.slice(0, Math.max(0, imageGalleryLimit))
    for (const it of slice) {
      const savedPath = String(it?.savedPath || '').trim()
      if (savedPath) controller.ensureImageHistoryItemLoaded(savedPath)
    }
  }, [imageGalleryOpen, imageGalleryLimit, imageHistoryFiltered, controller])

  React.useEffect(() => {
    if (!imageGalleryOpen) return
    if (typeof IntersectionObserver === 'undefined') return
    const total = imageHistoryFiltered.length
    const limit = Math.max(0, imageGalleryLimit)
    if (limit >= total) return

    const sentinel = imageGallerySentinelRef.current
    if (!sentinel) return
    const root = imageGalleryScrollRef.current

    let done = false
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries && entries[0] && entries[0].isIntersecting
        if (!hit) return
        if (done) return
        done = true
        try {
          observer.disconnect()
        } catch {}
        setImageGalleryLimit((n) => Math.min(n + 36, total))
      },
      { root: root || null, rootMargin: '240px 0px', threshold: 0 },
    )

    try {
      observer.observe(sentinel)
    } catch {}

    return () => {
      done = true
      try {
        observer.disconnect()
      } catch {}
    }
  }, [imageGalleryOpen, imageGalleryLimit, imageHistoryFiltered.length, imageHistoryFiltered])

  React.useEffect(() => {
    if (!imageGalleryOpen) return
    let disposed = false
    let timer: any = null
    let poller: any = null
    let el: HTMLDivElement | null = null

    const attach = () => {
      if (disposed) return
      const next = imageGalleryScrollRef.current
      if (!next) {
        timer = setTimeout(attach, 50)
        return
      }

      el = next

      const onScroll = () => {
        if (!el) return
        const total = imageHistoryFiltered.length
        const limit = Math.max(0, imageGalleryLimit)
        if (limit >= total) return

        // 兜底：有些 WebView/滚动容器上 IntersectionObserver 可能不触发。
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 320
        if (!nearBottom) return

        const now = Date.now()
        if (now - imageGalleryLoadMoreCooldownRef.current < 120) return
        imageGalleryLoadMoreCooldownRef.current = now
        setImageGalleryLimit((n) => Math.min(n + 36, total))
      }

      el.addEventListener('scroll', onScroll, { passive: true })

      // 兜底：部分环境滚动事件可能不稳定，轮询判断是否接近底部。
      poller = setInterval(() => {
        try {
          onScroll()
        } catch {}
      }, 200)

      // 如果首屏内容不足以产生滚动条，也要自动补下一页。
      try {
        onScroll()
      } catch {}

      return () => {
        el?.removeEventListener('scroll', onScroll)
        if (poller) {
          try {
            clearInterval(poller)
          } catch {}
          poller = null
        }
      }
    }

    let detach: null | (() => void) = null
    detach = attach() || null

    return () => {
      disposed = true
      if (timer) {
        try {
          clearTimeout(timer)
        } catch {}
      }
      if (poller) {
        try {
          clearInterval(poller)
        } catch {}
      }
      if (detach) {
        try {
          detach()
        } catch {}
      }
    }
  }, [imageGalleryOpen, imageGalleryLimit, imageHistoryFiltered.length, imageHistoryFiltered])

  const nextMode: UiMode = uiMode === UI_MODE_LOCAL_EDIT ? UI_MODE_NORMAL : UI_MODE_LOCAL_EDIT

  const onTopbarPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const t = e.target as any
    if (!t || typeof t.closest !== 'function') return
    if (t.closest('button, a, input, textarea, select, [role="button"]')) return
    void api.ui.startDragging()
  }

  const clampBatch = (n: number) => Math.max(1, Math.min(20, Math.floor(n)))
  const nudgeBatch = (delta: number) => {
    const cur = Number.parseInt(String(state.batchCount || '').trim(), 10)
    const base = Number.isFinite(cur) && cur > 0 ? cur : 1
    controller.setBatchCount(String(clampBatch(base + delta)))
  }

  const onPaste = (e: React.ClipboardEvent) => {
    if (state.loading || state.submitting) return
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
    void controller.addRefImagesFromFiles(files)
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static" color="transparent" elevation={0}>
          <Box onPointerDown={onTopbarPointerDown} sx={{ height: 52, px: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title="返回主页">
              <IconButton
                size="small"
                onClick={() => {
                  try {
                    const back = (api as any)?.host?.back
                    if (typeof back === 'function') back()
                    else api.ui.showToast('宿主不支持返回')
                  } catch (e: any) {
                    api.ui.showToast(String(e?.message || e || '返回失败'))
                  }
                }}
                aria-label="返回主页"
              >
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Typography sx={{ fontWeight: 800, fontSize: 14, flexShrink: 0 }}>AI 绘图</Typography>

            <Button
              size="small"
              variant="contained"
              onClick={() => void controller.setUiMode(nextMode)}
              sx={{ borderRadius: 999, px: 1.25 }}
            >
              {uiMode === UI_MODE_LOCAL_EDIT ? '模式：局部' : '模式：普通'}
            </Button>

            <Box sx={{ flex: 1 }} />

            <Tooltip title="任务列表">
              <IconButton
                size="small"
                onClick={(e) => setTaskAnchorEl(e.currentTarget)}
                aria-label="打开任务列表"
              >
                <Badge
                  color="primary"
                  badgeContent={state.tasks.length ? state.tasks.length : 0}
                  invisible={!state.tasks.length}
                >
                  <TaskAltRoundedIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>

            {/* 提示词收藏夹入口移动到输入区“上一条/下一条”右侧 */}
            <Tooltip title="设置">
              <IconButton
                size="small"
                onClick={() => {
                  setSettingsTab('provider')
                  setSettingsOpen(true)
                }}
                aria-label="打开设置"
              >
                <SettingsRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </AppBar>

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 2, p: 2 }}>
          <Paper sx={{ width: 420, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {state.loading ? (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>加载中…</Typography>
            ) : null}

            <Stack direction="row" spacing={1} alignItems="center">
              <FormControl size="small" fullWidth>
                <InputLabel id="ai-draw-provider-label">供应商</InputLabel>
                <Select
                  labelId="ai-draw-provider-label"
                  label="供应商"
                  value={String(data?.activeProviderId || '')}
                  onChange={(e) => void controller.setActiveProviderId(String(e.target.value || ''))}
                >
                  {providers.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name || '供应商'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Stack direction="row" spacing={1}>
              <FormControl size="small" sx={{ flex: 1 }}>
                <InputLabel id="ai-draw-model-label">模型</InputLabel>
                <Select
                  labelId="ai-draw-model-label"
                  label="模型"
                  value={String((provider as any)?.model || '')}
                  onChange={(e) => (provider ? void controller.saveProvider(provider.id, { model: String(e.target.value || '') }) : undefined)}
                >
                  {(Array.isArray((provider as any)?.models) ? (provider as any).models : []).map((m: string) => (
                    <MenuItem key={m} value={m}>
                      {m}
                    </MenuItem>
                  ))}
                  <MenuItem value="__custom__">自定义…</MenuItem>
                </Select>
              </FormControl>

              <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.75 }}>
                <TextField
                  size="small"
                  label="批量"
                  value={state.batchCount}
                  onChange={(e) => controller.setBatchCount(e.target.value)}
                  sx={{ width: 72 }}
                  inputProps={{ inputMode: 'numeric' }}
                />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <IconButton size="small" onClick={() => nudgeBatch(1)} aria-label="批量加一" sx={{ p: 0.5 }}>
                    <KeyboardArrowUpRoundedIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => nudgeBatch(-1)} aria-label="批量减一" sx={{ p: 0.5 }}>
                    <KeyboardArrowDownRoundedIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
            </Stack>

            {String((provider as any)?.model || '') === '__custom__' ? (
              <TextField
                size="small"
                label="自定义模型"
                value={String((provider as any)?.customModel || '')}
                onChange={(e) => (provider ? void controller.saveProvider(provider.id, { customModel: e.target.value }) : undefined)}
                placeholder="例如：dall-e-3 / sdxl / 自建网关模型名"
              />
            ) : null}

            <TextField
              label={uiMode === UI_MODE_LOCAL_EDIT ? '修改要求' : '提示词'}
              value={state.prompt}
              onChange={(e) => controller.setPrompt(e.target.value)}
              onPaste={onPaste}
              multiline
              rows={9}
              placeholder={uiMode === UI_MODE_LOCAL_EDIT ? '例如：把选区改成落日油画风，保持结构不变…' : '例如：一只橘猫坐在书桌前，暖色调，插画风…'}
            />

            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="contained"
                onClick={() => controller.switchPromptHistory(-1)}
                disabled={!state.promptHistory.length}
              >
                ← 上一条
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => controller.switchPromptHistory(1)}
                disabled={!state.promptHistory.length}
              >
                下一条 →
              </Button>

              <Button
                size="small"
                variant="contained"
                onClick={() => setPromptLibOpen(true)}
                aria-label="打开提示词收藏夹"
              >
                提示词收藏夹
              </Button>

              <Tooltip title="提示词历史">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => {
                      setPromptHistoryQuery('')
                      setPromptHistoryOpen(true)
                    }}
                    disabled={!state.promptHistory.length}
                    aria-label="打开提示词历史"
                  >
                    <HistoryRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
            </Stack>

            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button size="small" variant="outlined" onClick={() => void controller.pickRefImages()}>
                  添加参考图
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PhotoLibraryRoundedIcon fontSize="small" />}
                  onClick={() => setRefLibraryOpen(true)}
                >
                  参考图库
                </Button>
                <Button size="small" variant="outlined" onClick={() => controller.clearRefImages()} disabled={!state.refImages.length}>
                  清空参考图
                </Button>
                <Box sx={{ flex: 1 }} />
                <Chip size="small" variant="outlined" label={`${state.refImages.length}/8`} />
              </Stack>

            {state.refImages.length ? (
              <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5 }}>
                  {state.refImages.map((img) => (
                    <Box key={img.id} sx={{ position: 'relative', width: 72, height: 72, flex: '0 0 auto' }}>
                      <Box
                        component="img"
                        src={img.dataUrl}
                        alt={img.name || '参考图'}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 2 }}
                      />
                      <IconButton
                        size="small"
                        onClick={() => controller.removeRefImage(img.id)}
                        sx={{ position: 'absolute', right: 2, top: 2, bgcolor: 'rgba(250,249,245,0.92)' }}
                        aria-label="移除参考图"
                      >
                        <DeleteRoundedIcon fontSize="inherit" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
              ) : null}
            </Stack>

            <Button
              variant="contained"
              disabled={state.submitting}
              onClick={() => void controller.generate()}
              sx={{ py: 1.1, fontWeight: 800 }}
            >
              {state.submitting ? '提交中…' : uiMode === UI_MODE_LOCAL_EDIT ? '开始局部修改' : '生成'}
            </Button>

            {state.error ? (
              <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
                {state.error}
              </Alert>
            ) : null}
          </Paper>

          <Paper sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Tooltip title="上一张">
                  <span>
                    <IconButton size="small" disabled={!canImagePrev} onClick={() => void controller.switchImageHistory(-1)}>
                      <NavigateBeforeRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="下一张">
                  <span>
                    <IconButton size="small" disabled={!canImageNext} onClick={() => void controller.switchImageHistory(1)}>
                      <NavigateNextRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>

                <Chip size="small" variant="outlined" label={imageIndexText} />

                <Tooltip title="批量预览">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setImageGalleryQuery('')
                        setImageGalleryOpen(true)
                      }}
                      disabled={!state.imageHistory.length}
                      aria-label="打开图片批量预览"
                    >
                      <CollectionsRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>

                <Box sx={{ flex: 1 }} />

                <Tooltip title="复制图片">
                  <span>
                    <IconButton size="small" disabled={!state.imageDataUrl} onClick={() => void controller.copyImage()}>
                      <ContentCopyRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>

                {uiMode === UI_MODE_NORMAL ? (
                  <>
                    <Tooltip title="更多">
                      <span>
                        <IconButton
                          size="small"
                          disabled={!state.savedPath}
                          onClick={(e) => setNormalMoreAnchorEl(e.currentTarget)}
                          aria-label="更多操作"
                        >
                          <MoreHorizRoundedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>

                    <Menu
                      open={!!normalMoreAnchorEl}
                      anchorEl={normalMoreAnchorEl}
                      onClose={() => setNormalMoreAnchorEl(null)}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    >
                      <MenuItem
                        onClick={() => {
                          setNormalMoreAnchorEl(null)
                          setDeleteConfirmOpen(true)
                        }}
                        sx={{ color: 'error.main' }}
                      >
                        删除
                      </MenuItem>
                    </Menu>
                  </>
                ) : null}

                <Tooltip title="详情">
                  <span>
                    <IconButton
                      size="small"
                      disabled={!state.imageDataUrl && !state.savedPath}
                      onClick={(e) => setImageDetailAnchorEl(e.currentTarget)}
                      aria-label="打开详情"
                    >
                      <Badge
                        color="primary"
                        variant="dot"
                        invisible={!(state.savedPath || (autoSave && state.imageDataUrl))}
                      >
                        <InfoRoundedIcon fontSize="small" />
                      </Badge>
                    </IconButton>
                  </span>
                </Tooltip>

                <Tooltip title={autoSave ? '自动保存已开启（手动保存可关闭自动保存）' : '保存图片'}>
                  <span>
                    <IconButton size="small" disabled={!state.imageDataUrl || autoSave} onClick={() => void controller.saveImage()}>
                      <SaveRoundedIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>

                <Tooltip title="打开输出目录">
                  <IconButton size="small" onClick={() => void controller.openOutputDir()}>
                    <FolderOpenRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
            <OverlayScrollArea
              sx={{ flex: 1, minHeight: 0 }}
              contentSx={{
                p: 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
              }}
            >
              {uiMode === UI_MODE_LOCAL_EDIT ? (
                <>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>底图（框选区域在这里）</Typography>
                    <Box sx={{ flex: 1 }} />
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ImageRoundedIcon fontSize="small" />}
                      onClick={() => void controller.pickEditImage()}
                    >
                      选择底图
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<RestartAltRoundedIcon />}
                      onClick={() => controller.clearEditImage()}
                      disabled={!state.edit.baseDataUrl}
                    >
                      清空
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => controller.setEditSelection(null)}
                      disabled={!state.edit.sel}
                    >
                      清空选区
                    </Button>
                  </Stack>

                  {state.edit.baseDataUrl ? (
                    <EditImageSelector
                      dataUrl={state.edit.baseDataUrl}
                      sel={state.edit.sel}
                      onSelChange={controller.setEditSelection}
                    />
                  ) : (
                    <Box
                      sx={{
                        minHeight: 260,
                        flexShrink: 0,
                        borderRadius: 4,
                        bgcolor: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>请选择一张底图，然后拖拽框选区域。</Typography>
                    </Box>
                  )}

                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>输出（在底部，不会替换底图与选区）</Typography>
                   <Box
                      sx={{
                        minHeight: 220,
                        flexShrink: 0,
                        borderRadius: 4,
                        bgcolor: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                       overflow: 'hidden',
                     }}
                   >
                     {state.imageDataUrl ? (
                       <Box
                         component="img"
                         src={state.imageDataUrl}
                         alt="局部输出结果"
                         sx={{ display: 'block', width: '100%', height: 'auto' }}
                       />
                     ) : (
                       <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>暂无输出图片</Typography>
                     )}
                   </Box>
                </>
              ) : (
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 420,
                    borderRadius: 4,
                    bgcolor: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {state.imageDataUrl ? (
                    <Box
                      component="img"
                      src={state.imageDataUrl}
                      alt="生成结果"
                      sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>暂无图片</Typography>
                  )}
                </Box>
              )}

              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" onClick={() => void controller.refreshImageHistory()}>
                  刷新输出
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setSettingsTab('plugin')
                    setSettingsOpen(true)
                  }}
                >
                  插件设置
                </Button>
              </Stack>
            </OverlayScrollArea>
          </Paper>
        </Box>
      </Box>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>确认删除？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            将从输出目录删除当前图片文件，此操作不可撤销。
          </Typography>
          {state.savedPath ? (
            <Typography sx={{ mt: 1, fontSize: 12, wordBreak: 'break-all' }}>{state.savedPath}</Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setDeleteConfirmOpen(false)
              void controller.deleteCurrentOutputImage()
            }}
            disabled={!state.savedPath}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={providerDeleteConfirm.open}
        onClose={() => setProviderDeleteConfirm({ open: false, providerId: '', name: '' })}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>确认删除供应商？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>将删除该供应商配置，此操作不可撤销。</Typography>
          <Typography sx={{ mt: 1, fontSize: 12 }}>{providerDeleteConfirm.name || '供应商'}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProviderDeleteConfirm({ open: false, providerId: '', name: '' })}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const pid = providerDeleteConfirm.providerId
              setProviderDeleteConfirm({ open: false, providerId: '', name: '' })
              if (!pid) return
              void controller.deleteProvider(pid)
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 860,
            maxWidth: 'calc(100vw - 24px)',
            height: 660,
            maxHeight: 'calc(100vh - 24px)',
            borderRadius: 3,
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <DialogTitle sx={{ flex: '0 0 auto' }}>设置</DialogTitle>
        <DialogContent sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <OverlayScrollArea>
          <Tabs
            value={settingsTab}
            onChange={(_e, v) => setSettingsTab(v)}
            sx={{ mb: 2 }}
          >
            <Tab value="provider" label="供应商" />
            <Tab value="plugin" label="插件" />
          </Tabs>

          {settingsTab === 'provider' ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center">
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel id="ai-draw-provider2-label">当前供应商</InputLabel>
                  <Select
                    labelId="ai-draw-provider2-label"
                    label="当前供应商"
                    value={String(data?.activeProviderId || '')}
                    onChange={(e) => void controller.setActiveProviderId(String(e.target.value || ''))}
                  >
                    {providers.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name || '供应商'}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>

              <Button startIcon={<AddRoundedIcon />} onClick={() => void controller.addProvider()} variant="outlined">
                新增
              </Button>

              <Button
                startIcon={<DeleteRoundedIcon />}
                color="error"
                onClick={() =>
                  setProviderDeleteConfirm({
                    open: true,
                    providerId: String(provider?.id || ''),
                    name: String((provider as any)?.name || ''),
                  })
                }
                variant="outlined"
                disabled={!provider || providers.length <= 1}
              >
                删除
              </Button>
            </Stack>

              <Stack direction="row" spacing={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="名称"
                  value={providerDraft?.name ?? ''}
                  onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), name: e.target.value }))}
                />
                <FormControl size="small" sx={{ width: 200 }}>
                  <InputLabel id="ai-draw-protocol-label">协议</InputLabel>
                  <Select
                    labelId="ai-draw-protocol-label"
                    label="协议"
                    value={providerDraft?.protocol ?? 'images'}
                    onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), protocol: String(e.target.value || 'images') }))}
                  >
                    <MenuItem value="images">images</MenuItem>
                    <MenuItem value="chat">chat</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              <TextField
                size="small"
                label="Base URL"
                value={providerDraft?.baseUrl ?? ''}
                onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), baseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
              <TextField
                size="small"
                label="API Key"
                value={providerDraft?.apiKey ?? ''}
                onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), apiKey: e.target.value }))}
                type="password"
              />

              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  label="尺寸"
                  select
                  value={providerDraft?.size ?? '1024x1024'}
                  onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), size: String(e.target.value || '1024x1024') }))}
                  sx={{ width: 220 }}
                >
                  {['1024x1024', '1024x1536', '1536x1024', '512x512'].map((x) => (
                    <MenuItem key={x} value={x}>
                      {x}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  size="small"
                  label="自定义模型名（当选择自定义时生效）"
                  value={providerDraft?.customModel ?? ''}
                  onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), customModel: e.target.value }))}
                  sx={{ flex: 1 }}
                />
              </Stack>

              <TextField
                size="small"
                label="模型列表（每行一个）"
                value={providerDraft?.modelsText ?? ''}
                onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), modelsText: e.target.value }))}
                multiline
                minRows={4}
                placeholder={'例如：\n' + 'gpt-image-1\n' + 'dall-e-3'}
              />

              <FormControl size="small">
                <InputLabel id="ai-draw-provider-model2-label">当前模型</InputLabel>
                <Select
                  labelId="ai-draw-provider-model2-label"
                  label="当前模型"
                  value={providerDraft?.model ?? ''}
                  onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), model: String(e.target.value || '') }))}
                >
                  {String(providerDraft?.modelsText || '')
                    .split(/\r?\n/g)
                    .map((x: any) => String(x || '').trim())
                    .filter(Boolean)
                    .map((m: string) => (
                      <MenuItem key={m} value={m}>
                        {m}
                      </MenuItem>
                    ))}
                  <MenuItem value="__custom__">自定义…</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                label="Chat System Prompt（可选）"
                value={providerDraft?.chatSystemPrompt ?? ''}
                onChange={(e) => setProviderDraft((d: any) => ({ ...(d || {}), chatSystemPrompt: e.target.value }))}
                multiline
                minRows={2}
              />
            </Stack>
          ) : null}

          {settingsTab === 'plugin' ? (
            <Stack spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!pluginDraft?.autoSave}
                    onChange={(e) => setPluginDraft((d: any) => ({ ...(d || {}), autoSave: e.target.checked }))}
                  />
                }
                label="生成后自动保存到输出目录（由后台执行写入）"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={!!pluginDraft?.shrinkRefImages}
                    onChange={(e) => setPluginDraft((d: any) => ({ ...(d || {}), shrinkRefImages: e.target.checked }))}
                  />
                }
                label="参考图自动压缩（更稳/更省流量）"
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  label="提示词历史上限"
                  value={pluginDraft?.promptHistoryLimit ?? ''}
                  onChange={(e) => setPluginDraft((d: any) => ({ ...(d || {}), promptHistoryLimit: e.target.value }))}
                  sx={{ width: 220 }}
                  inputProps={{ inputMode: 'numeric' }}
                />
                <TextField
                  size="small"
                  label="请求超时（秒）"
                  value={pluginDraft?.requestTimeoutSec ?? ''}
                  onChange={(e) => setPluginDraft((d: any) => ({ ...(d || {}), requestTimeoutSec: e.target.value }))}
                  sx={{ width: 220 }}
                  inputProps={{ inputMode: 'numeric' }}
                />
              </Stack>

              <Stack direction="row" spacing={1}>
                <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} onClick={() => void controller.pickOutputDir()}>
                  选择输出目录
                </Button>
                <Button variant="outlined" onClick={() => void controller.openOutputDir()}>
                  打开输出目录
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button color="error" variant="outlined" onClick={() => void controller.clearPromptHistory()}>
                  清空提示词历史
                </Button>
              </Stack>
              </Stack>
            ) : null}
          </OverlayScrollArea>
        </DialogContent>
        <DialogActions sx={{ flex: '0 0 auto' }}>
          <Button onClick={() => setSettingsOpen(false)}>关闭</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (settingsTab === 'provider' && provider) {
                void controller.saveProvider(provider.id, providerDraft || {})
              } else if (settingsTab === 'plugin') {
                void controller.savePluginSettings({
                  autoSave: !!pluginDraft?.autoSave,
                  shrinkRefImages: !!pluginDraft?.shrinkRefImages,
                  promptHistoryLimit: Number(pluginDraft?.promptHistoryLimit),
                  requestTimeoutSec: Number(pluginDraft?.requestTimeoutSec),
                })
              }
              setSettingsOpen(false)
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={promptHistoryOpen}
        onClose={() => setPromptHistoryOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 920,
            maxWidth: 'calc(100vw - 24px)',
            height: 'min(820px, calc(100vh - 24px))',
            borderRadius: 3,
            overflow: 'hidden',
          },
        }}
      >
        <DialogContent sx={{ p: 0, height: '100%' }}>
          <Box sx={{ position: 'relative', height: '100%', p: 2, pt: 5 }}>
            <IconButton
              size="small"
              onClick={() => setPromptHistoryOpen(false)}
              aria-label="关闭提示词历史"
              sx={{ position: 'absolute', right: 8, top: 8, bgcolor: 'rgba(250,249,245,0.92)' }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>

            <Stack spacing={1.25} sx={{ height: '100%' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  value={promptHistoryQuery}
                  onChange={(e) => setPromptHistoryQuery(e.target.value)}
                  placeholder="搜索历史提示词"
                  fullWidth
                />

                <Button
                  size="small"
                  variant={promptHistoryMultiMode ? 'contained' : 'outlined'}
                  onClick={() => {
                    setPromptHistoryMultiMode((m) => {
                      const next = !m
                      if (!next) clearPromptHistorySelection()
                      return next
                    })
                  }}
                >
                  {promptHistoryMultiMode ? '完成' : '多选'}
                </Button>

                {promptHistoryMultiMode ? (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteRoundedIcon fontSize="small" />}
                      disabled={!promptHistorySelectedCount}
                      onClick={() => {
                        const texts = Array.from(promptHistorySelectedSet)
                        if (!texts.length) return
                        setPromptHistoryDeleteConfirm({ open: true, texts })
                      }}
                    >
                      删除
                    </Button>
                    <Chip size="small" variant="outlined" color="primary" label={`已选 ${promptHistorySelectedCount} 条`} />
                  </>
                ) : null}
              </Stack>

              <OverlayScrollArea sx={{ flex: 1, minHeight: 0 }}>
                <Stack spacing={1} sx={{ pr: 0.5 }}>
                  {promptHistoryFiltered.length ? (
                    promptHistoryFiltered.map((t, idx) => {
                      const text = String(t || '')
                      const selected = promptHistoryMultiMode && promptHistorySelectedSet.has(String(text || '').trim())
                      return (
                        <Paper
                          key={`${idx}-${text.slice(0, 24)}`}
                          sx={{
                            p: 1,
                            cursor: 'pointer',
                            borderRadius: 2,
                            bgcolor: 'rgba(255,255,255,0.78)',
                            ...(selected ? { border: '1px solid', borderColor: 'primary.main' } : null),
                          }}
                          onClick={() => {
                            if (promptHistoryMultiMode) return togglePromptHistorySelected(text)
                            controller.setPrompt(text)
                            void api.clipboard
                              .writeText(text)
                              .then(() => api.ui.showToast('已复制并填入'))
                              .catch((e: any) => api.ui.showToast(`复制失败：${String(e?.message || e)}`))
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            if (promptHistoryMultiMode) return
                            const s = String(text || '').trim()
                            if (!s) return
                            setPromptHistoryItemMenu({ open: true, x: e.clientX, y: e.clientY, text: s })
                          }}
                        >
                          {promptHistoryMultiMode ? (
                            <Checkbox
                              size="small"
                              checked={promptHistorySelectedSet.has(String(text || '').trim())}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                              }}
                              onChange={() => togglePromptHistorySelected(text)}
                              inputProps={{ 'aria-label': '选择提示词' }}
                              sx={{ p: 0, mr: 1, mt: -0.25 }}
                            />
                          ) : null}
                          <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{text}</Typography>
                        </Paper>
                      )
                    })
                  ) : (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>暂无历史提示词</Typography>
                  )}
                </Stack>
              </OverlayScrollArea>
            </Stack>
          </Box>
        </DialogContent>
      </Dialog>

      <Menu
        open={promptHistoryItemMenu.open}
        onClose={() => setPromptHistoryItemMenu({ open: false, x: 0, y: 0, text: '' })}
        anchorReference="anchorPosition"
        anchorPosition={promptHistoryItemMenu.open ? { top: promptHistoryItemMenu.y, left: promptHistoryItemMenu.x } : undefined}
      >
        <MenuItem
          onClick={() => {
            const text = promptHistoryItemMenu.text
            setPromptHistoryItemMenu({ open: false, x: 0, y: 0, text: '' })
            if (!text) return
            controller.setPrompt(text)
            void api.clipboard
              .writeText(text)
              .then(() => api.ui.showToast('已复制并填入'))
              .catch((e: any) => api.ui.showToast(`复制失败：${String(e?.message || e)}`))
          }}
        >
          使用
        </MenuItem>
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            const text = promptHistoryItemMenu.text
            setPromptHistoryItemMenu({ open: false, x: 0, y: 0, text: '' })
            if (!text) return
            setPromptHistoryDeleteConfirm({ open: true, texts: [text] })
          }}
        >
          删除
        </MenuItem>
      </Menu>

      <Dialog
        open={promptHistoryDeleteConfirm.open}
        onClose={() => setPromptHistoryDeleteConfirm({ open: false, texts: [] })}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>确认删除提示词？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            将删除 {promptHistoryDeleteConfirm.texts.length} 条历史提示词（无法恢复）。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromptHistoryDeleteConfirm({ open: false, texts: [] })}>取消</Button>
          <Button
            color="error"
            variant="contained"
            disabled={!promptHistoryDeleteConfirm.texts.length}
            onClick={() => {
              const texts = promptHistoryDeleteConfirm.texts.slice()
              setPromptHistoryDeleteConfirm({ open: false, texts: [] })
              if (!texts.length) return
              void controller.deletePromptHistoryItems(texts).then(
                () => {
                  // 删除后保持在多选模式下，但清掉已选。
                  clearPromptHistorySelection()
                  api.ui.showToast('已删除')
                },
                (e: any) => api.ui.showToast(`删除失败：${String(e?.message || e)}`),
              )
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={imageGalleryOpen}
        onClose={() => setImageGalleryOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 980,
            maxWidth: 'calc(100vw - 24px)',
            height: 'min(860px, calc(100vh - 24px))',
            borderRadius: 3,
            overflow: 'hidden',
          },
        }}
      >
        <DialogContent sx={{ p: 0, height: '100%' }}>
          <Box sx={{ position: 'relative', height: '100%', p: 2, pt: 5 }}>
            <IconButton
              size="small"
              onClick={() => setImageGalleryOpen(false)}
              aria-label="关闭图片批量预览"
              sx={{ position: 'absolute', right: 8, top: 8, bgcolor: 'rgba(250,249,245,0.92)' }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>

            <Stack spacing={1.25} sx={{ height: '100%' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  value={imageGalleryQuery}
                  onChange={(e) => setImageGalleryQuery(e.target.value)}
                  placeholder="按文件名搜索（savedPath）"
                  fullWidth
                />
                <Button size="small" variant="contained" onClick={() => void controller.refreshImageHistory()}>
                  刷新
                </Button>
                <Chip size="small" variant="outlined" label={`${imageGalleryShownCount}/${imageHistoryFiltered.length}`} />
              </Stack>

              <OverlayScrollArea sx={{ flex: 1, minHeight: 0 }} scrollRef={imageGalleryScrollRef}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    gap: 1,
                    pr: 0.5,
                  }}
                >
                  {imageHistoryFiltered.length ? (
                    imageHistoryFiltered.slice(0, imageGalleryLimit).map((it, idx) => {
                      const savedPath = String(it?.savedPath || '').trim()
                      const dataUrl = String(it?.dataUrl || '').trim()
                      const loading = !!(it as any)?.loading
                      const error = String((it as any)?.error || '').trim()
                      const key = savedPath || `idx:${idx}`
                      return (
                        <Box
                          key={key}
                          sx={{
                            borderRadius: 2,
                            bgcolor: 'rgba(255,255,255,0.78)',
                            p: 1,
                            cursor: 'pointer',
                            overflow: 'hidden',
                          }}
                          data-saved-path={savedPath}
                          onMouseEnter={() => controller.ensureImageHistoryItemLoaded(savedPath)}
                          onFocus={() => controller.ensureImageHistoryItemLoaded(savedPath)}
                          tabIndex={0}
                          onClick={() => {
                            const realIndex = state.imageHistory.findIndex((x) => String(x?.savedPath || '').trim() === savedPath)
                            if (realIndex >= 0) {
                              void controller.refreshImageHistory(savedPath).catch(() => {})
                              // 直接跳到那张图（刷新后会 preferPath 命中）
                            }
                            setImageGalleryOpen(false)
                          }}
                        >
                          <Box
                            sx={{
                              height: 120,
                              borderRadius: 2,
                              bgcolor: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden',
                            }}
                          >
                            {dataUrl ? (
                              <Box
                                component="img"
                                src={dataUrl}
                                alt="输出缩略图"
                                loading="lazy"
                                decoding="async"
                                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : error ? (
                              <Typography sx={{ fontSize: 12, color: 'error.main' }}>加载失败</Typography>
                            ) : loading ? (
                              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>加载中…</Typography>
                            ) : (
                              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>未加载</Typography>
                            )}
                          </Box>
                          <Typography sx={{ mt: 0.75, fontSize: 11, color: 'text.secondary', wordBreak: 'break-all' }}>
                            {savedPath || '未知路径'}
                          </Typography>
                        </Box>
                      )
                    })
                  ) : (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>暂无输出图片</Typography>
                  )}
                </Box>

                {imageHistoryFiltered.length > imageGalleryLimit ? (
                  <Box ref={imageGallerySentinelRef} aria-hidden sx={{ height: 1, width: '100%' }} />
                ) : null}
              </OverlayScrollArea>
            </Stack>
          </Box>
        </DialogContent>
      </Dialog>

      <Dialog
        open={promptLibOpen}
        onClose={() => setPromptLibOpen(false)}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 920,
            maxWidth: 'calc(100vw - 24px)',
            height: 'min(820px, calc(100vh - 24px))',
            borderRadius: 3,
            overflow: 'hidden',
          },
        }}
      >
        <DialogContent sx={{ p: 0, height: '100%' }}>
          <Box sx={{ position: 'relative', height: '100%', p: 2, pt: 5 }}>
            <IconButton
              size="small"
              onClick={() => setPromptLibOpen(false)}
              aria-label="关闭提示词收藏夹"
              sx={{ position: 'absolute', right: 8, top: 8, bgcolor: 'rgba(250,249,245,0.92)' }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>

            {state.promptLib.loading ? (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>加载中…</Typography>
            ) : (
              <Box sx={{ display: 'flex', gap: 2, height: '100%', minHeight: 420, pt: 1 }}>
                <Paper variant="outlined" sx={{ width: 240, p: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>收藏夹</Typography>
                    <IconButton size="small" onClick={() => void controller.addPromptFolder('新收藏夹')} aria-label="新增收藏夹">
                      <AddRoundedIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <OverlayScrollArea sx={{ flex: 1, minHeight: 0 }}>
                    <Stack spacing={0.5} sx={{ pr: 0.5 }}>
                      {(state.promptLib.data?.folders || []).map((f) => (
                        <Button
                          key={f.id}
                          size="small"
                          variant={f.id === state.promptLib.data?.activeFolderId ? 'contained' : 'text'}
                          onClick={() => void controller.setActivePromptFolderId(f.id)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setPromptFolderMenu({ folderId: f.id, x: e.clientX, y: e.clientY, name: String(f.name || '') })
                          }}
                          sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                        >
                          {f.name}
                        </Button>
                      ))}
                    </Stack>
                  </OverlayScrollArea>
                </Paper>

                <Paper variant="outlined" sx={{ flex: 1, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>提示词</Typography>
                    <IconButton
                      size="small"
                      onClick={() => setAddPromptItemDialog({ open: true, text: String(state.prompt || '') })}
                      aria-label="添加到当前收藏夹"
                    >
                      <AddRoundedIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <OverlayScrollArea sx={{ flex: 1, minHeight: 0 }}>
                    <Stack spacing={1} sx={{ pr: 0.5 }}>
                      {(() => {
                        const d = state.promptLib.data
                        const fid = String(d?.activeFolderId || '')
                        const folder = (d?.folders || []).find((x) => x.id === fid) || (d?.folders || [])[0]
                        const prompts = folder?.prompts || []
                        return prompts.map((p) => (
                          <Paper
                            key={p.id}
                            variant="outlined"
                            sx={{ p: 1, cursor: 'pointer', position: 'relative' }}
                            onClick={() => {
                              const text = String(p.text || '')
                              void api.clipboard
                                .writeText(text)
                                .then(() => api.ui.showToast('已复制'))
                                .catch((e: any) => api.ui.showToast(`复制失败：${String(e?.message || e)}`))
                            }}
                          >
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setPromptItemMenu({
                                  el: e.currentTarget,
                                  folderId: String(folder?.id || ''),
                                  promptId: p.id,
                                })
                              }}
                              aria-label="更多操作"
                              sx={{ position: 'absolute', right: 6, top: 6, bgcolor: 'rgba(250,249,245,0.92)' }}
                            >
                              <MoreHorizRoundedIcon fontSize="inherit" />
                            </IconButton>
                            <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap', pr: 4 }}>{p.text}</Typography>
                          </Paper>
                        ))
                      })()}
                    </Stack>
                  </OverlayScrollArea>
                </Paper>
              </Box>
            )}
          </Box>
        </DialogContent>
      </Dialog>

      <Menu
        open={!!promptFolderMenu.folderId}
        onClose={() => setPromptFolderMenu({ folderId: '', x: 0, y: 0, name: '' })}
        anchorReference="anchorPosition"
        anchorPosition={promptFolderMenu.folderId ? { top: promptFolderMenu.y, left: promptFolderMenu.x } : undefined}
      >
        <MenuItem
          onClick={() => {
            const fid = promptFolderMenu.folderId
            const name = promptFolderMenu.name
            setPromptFolderMenu({ folderId: '', x: 0, y: 0, name: '' })
            setRenamePromptFolderDialog({ open: true, folderId: fid, name })
          }}
        >
          重命名
        </MenuItem>
        <MenuItem
          onClick={() => {
            const fid = promptFolderMenu.folderId
            const name = promptFolderMenu.name
            setPromptFolderMenu({ folderId: '', x: 0, y: 0, name: '' })
            setDeletePromptFolderConfirm({ open: true, folderId: fid, name })
          }}
          sx={{ color: 'error.main' }}
        >
          删除
        </MenuItem>
      </Menu>

      <Dialog
        open={renamePromptFolderDialog.open}
        onClose={() => setRenamePromptFolderDialog({ open: false, folderId: '', name: '' })}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>重命名收藏夹</DialogTitle>
        <DialogContent>
          <TextField
            size="small"
            label="名称"
            value={renamePromptFolderDialog.name}
            onChange={(e) => setRenamePromptFolderDialog((s) => ({ ...s, name: e.target.value }))}
            autoFocus
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenamePromptFolderDialog({ open: false, folderId: '', name: '' })}>取消</Button>
          <Button
            variant="contained"
            onClick={() => {
              const fid = renamePromptFolderDialog.folderId
              const name = String(renamePromptFolderDialog.name || '').trim()
              setRenamePromptFolderDialog({ open: false, folderId: '', name: '' })
              if (!fid) return
              void controller.renamePromptFolder(fid, name)
            }}
            disabled={!String(renamePromptFolderDialog.name || '').trim()}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deletePromptFolderConfirm.open}
        onClose={() => setDeletePromptFolderConfirm({ open: false, folderId: '', name: '' })}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>确认删除收藏夹？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>将删除收藏夹及其中所有条目，此操作不可撤销。</Typography>
          <Typography sx={{ mt: 1, fontSize: 12 }}>{deletePromptFolderConfirm.name || '收藏夹'}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletePromptFolderConfirm({ open: false, folderId: '', name: '' })}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const fid = deletePromptFolderConfirm.folderId
              setDeletePromptFolderConfirm({ open: false, folderId: '', name: '' })
              if (!fid) return
              void controller.deletePromptFolder(fid)
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        open={!!promptItemMenu.el}
        anchorEl={promptItemMenu.el}
        onClose={() => setPromptItemMenu({ el: null, folderId: '', promptId: '' })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            const folderId = promptItemMenu.folderId
            const promptId = promptItemMenu.promptId
            setPromptItemMenu({ el: null, folderId: '', promptId: '' })
            if (!folderId || !promptId) return
            setDeletePromptConfirm({ open: true, folderId, promptId })
          }}
          sx={{ color: 'error.main' }}
        >
          删除
        </MenuItem>
      </Menu>

      <Dialog
        open={deletePromptConfirm.open}
        onClose={() => setDeletePromptConfirm({ open: false, folderId: '', promptId: '' })}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>确认删除条目？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>此操作不可撤销。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletePromptConfirm({ open: false, folderId: '', promptId: '' })}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const fid = deletePromptConfirm.folderId
              const pid = deletePromptConfirm.promptId
              setDeletePromptConfirm({ open: false, folderId: '', promptId: '' })
              if (!fid || !pid) return
              void controller.deletePrompt(fid, pid)
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={addPromptItemDialog.open}
        onClose={() => setAddPromptItemDialog({ open: false, text: '' })}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>新增条目</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={5}
            label="内容"
            value={addPromptItemDialog.text}
            onChange={(e) => setAddPromptItemDialog((s) => ({ ...s, text: e.target.value }))}
            placeholder="输入要收藏的提示词…"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddPromptItemDialog({ open: false, text: '' })}>取消</Button>
          <Button
            variant="contained"
            onClick={() => {
              const text = String(addPromptItemDialog.text || '').trim()
              setAddPromptItemDialog({ open: false, text: '' })
              if (!text) return
              void controller.addPromptToActiveFolder(text)
            }}
            disabled={!String(addPromptItemDialog.text || '').trim()}
          >
            添加
          </Button>
        </DialogActions>
      </Dialog>

      <Popover
        open={!!taskAnchorEl}
        anchorEl={taskAnchorEl}
        onClose={() => setTaskAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 480, maxWidth: 'calc(100vw - 24px)', borderRadius: 3 } }}
      >
        <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 13 }}>任务</Typography>
          <Chip size="small" variant="outlined" label={String(state.tasks.length)} />
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={!state.tasks.length}
            onClick={() => void controller.cancelAllTasks()}
          >
            取消全部
          </Button>
          <Button size="small" variant="outlined" onClick={() => setTaskAnchorEl(null)}>
            关闭
          </Button>
        </Box>
        <Box sx={{ maxHeight: 520, overflow: 'hidden' }}>
          <OverlayScrollArea fill={false} contentSx={{ maxHeight: 520, p: 1.5 }}>
            {!state.tasks.length ? (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>暂无任务。</Typography>
            ) : (
              <Stack spacing={1}>
                {state.tasks.map((t) => (
                  <Paper key={t.id} variant="outlined" sx={{ p: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1, minWidth: 0 }} noWrap title={t.id}>
                        {t.id}
                      </Typography>
                      <Chip size="small" variant="outlined" label={t.status} />
                      <Button size="small" variant="text" color="error" onClick={() => void controller.cancelTask(t.id)}>
                        取消
                      </Button>
                    </Stack>
                    {t.prompt ? (
                      <Typography sx={{ mt: 0.75, fontSize: 12, color: 'text.primary', whiteSpace: 'pre-wrap' }}>
                        {t.prompt}
                      </Typography>
                    ) : null}
                  </Paper>
                ))}
              </Stack>
            )}
          </OverlayScrollArea>
        </Box>
      </Popover>

      <Popover
        open={!!imageDetailAnchorEl}
        anchorEl={imageDetailAnchorEl}
        onClose={() => setImageDetailAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 520, maxWidth: 'calc(100vw - 24px)', borderRadius: 3 } }}
      >
        <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 13 }}>详情</Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="outlined" onClick={() => setImageDetailAnchorEl(null)}>
            关闭
          </Button>
        </Box>
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {state.savedPath ? (
            <Alert
              severity="success"
              variant="outlined"
              action={
                <Button
                  size="small"
                  onClick={() => {
                    void api.clipboard
                      .writeText(state.savedPath)
                      .then(() => api.ui.showToast('已复制保存路径'))
                      .catch((e: any) => api.ui.showToast(`复制失败：${String(e?.message || e)}`))
                  }}
                >
                  复制路径
                </Button>
              }
            >
              已保存：{state.savedPath}
            </Alert>
          ) : autoSave && state.imageDataUrl ? (
            <Alert severity="info" variant="outlined">
              自动保存已开启：后台保存完成后会自动更新“已保存路径”。
            </Alert>
          ) : (
            <Alert severity="warning" variant="outlined">
              暂无保存信息。
            </Alert>
          )}

          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>输出目录</Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="outlined" onClick={() => void controller.openOutputDir()}>
                打开
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  const text = String(state.outputDir || '').trim()
                  if (!text) return api.ui.showToast('输出目录为空')
                  void api.clipboard
                    .writeText(text)
                    .then(() => api.ui.showToast('已复制输出目录'))
                    .catch((e: any) => api.ui.showToast(`复制失败：${String(e?.message || e)}`))
                }}
              >
                复制
              </Button>
            </Stack>
            <Typography
              sx={{ mt: 0.75, fontSize: 12, color: 'text.primary', wordBreak: 'break-all' }}
            >
              {state.outputDir || '未设置'}
            </Typography>
          </Paper>
        </Box>
      </Popover>

      <Dialog
        open={refLibraryOpen}
        onClose={() => setRefLibraryOpen(false)}
        fullWidth
        maxWidth="md"
        PaperProps={{ sx: { height: 680, maxHeight: '90vh' } }}
      >
        <DialogTitle sx={{ pr: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>参考图库</Typography>
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={() => setRefLibraryOpen(false)} aria-label="关闭参考图库">
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Button size="small" variant="outlined" onClick={() => void controller.refreshRefLibrary()} disabled={state.refLibrary.loading}>
              刷新
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => void controller.importRefLibraryFromPicker()}
              disabled={state.refLibrary.busy}
            >
              导入图片到参考库
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              variant={refMultiMode ? 'contained' : 'outlined'}
              startIcon={<TaskAltRoundedIcon fontSize="small" />}
              disabled={state.refLibrary.loading || refMultiBusy}
              onClick={() => {
                setRefMultiMode((v) => {
                  const next = !v
                  if (!next) clearRefSelection()
                  return next
                })
              }}
            >
              {refMultiMode ? '完成' : '多选'}
            </Button>
            {refMultiMode ? (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FolderOpenRoundedIcon fontSize="small" />}
                  disabled={!refSelectedCount || refMultiBusy}
                  onClick={() => {
                    const paths = refSelectedPaths.slice()
                    if (!paths.length) return
                    setAssignRefFolderDialog({ open: true, mode: 'add', paths, folderIds: [] })
                  }}
                >
                  收藏到收藏夹
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteRoundedIcon fontSize="small" />}
                  disabled={!refSelectedCount || refMultiBusy}
                  onClick={() => {
                    const paths = refSelectedPaths.slice()
                    if (!paths.length) return
                    setRefMultiDeleteConfirm({ open: true, paths })
                  }}
                >
                  删除
                </Button>
                <Chip size="small" variant="outlined" color="primary" label={`已选 ${refSelectedCount} 张`} />
              </>
            ) : null}
            <Chip
              size="small"
              variant="outlined"
              label={
                refActiveView.kind === 'all'
                  ? `共 ${state.refLibrary.paths.length} 张`
                  : `当前 ${refVisiblePathsAll.length} 张 / 共 ${state.refLibrary.paths.length} 张`
              }
            />
          </Stack>

          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {state.refLibrary.loading ? (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>加载中…</Typography>
            ) : (
              <Box sx={{ display: 'flex', gap: 1, height: '100%', minHeight: 0 }}>
                <Paper variant="outlined" sx={{ width: 260, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1, py: 0.75 }}>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>收藏夹</Typography>
                    <IconButton
                      size="small"
                      onClick={() => setAddRefFolderDialog({ open: true, parentId: null, name: '' })}
                      aria-label="新增收藏夹"
                    >
                      <CreateNewFolderRoundedIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <Divider />

                  <OverlayScrollArea sx={{ flex: 1, minHeight: 0 }}>
                    <List dense disablePadding>
                      <ListItemButton selected={refActiveView.kind === 'all'} onClick={() => void controller.setRefLibraryView({ kind: 'all' })}>
                        <ListItemText primary="全部" secondary={state.refLibrary.paths.length ? `${state.refLibrary.paths.length} 张` : undefined} />
                      </ListItemButton>
                      <Divider sx={{ my: 0.5 }} />

                      {(refChildrenByParent.get('') || []).map((fid) => {
                        const renderNode = (id: string, depth: number): React.ReactNode => {
                          const f: any = refFolderById.get(id)
                          if (!f) return null
                          const children = refChildrenByParent.get(id) || []
                          const expanded = refFolderExpanded[id] !== false
                          const selected = refActiveView.kind === 'folder' && String(refActiveView.folderId || '').trim() === id
                          const count = refFolderImageCountById[id] || 0
                          return (
                            <React.Fragment key={id}>
                              <ListItemButton
                                selected={selected}
                                sx={{ pl: 1 + depth * 2 }}
                                onClick={() => void controller.setRefLibraryView({ kind: 'folder', folderId: id })}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  setRefFolderMenu({ folderId: id, x: e.clientX, y: e.clientY, name: String(f.name || '') })
                                }}
                              >
                                <ListItemIcon sx={{ minWidth: 28 }}>
                                  {children.length ? (
                                    <IconButton
                                      size="small"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        setRefFolderExpanded((m) => ({ ...m, [id]: !(m[id] !== false) }))
                                      }}
                                      aria-label={expanded ? '收起' : '展开'}
                                    >
                                      {expanded ? <ExpandMoreRoundedIcon fontSize="small" /> : <ChevronRightRoundedIcon fontSize="small" />}
                                    </IconButton>
                                  ) : (
                                    <FolderOpenRoundedIcon fontSize="small" />
                                  )}
                                </ListItemIcon>
                                <ListItemText primary={String(f.name || '收藏夹')} secondary={count ? `${count} 张` : undefined} />
                              </ListItemButton>
                              {children.length ? (
                                <Collapse in={expanded} timeout="auto" unmountOnExit>
                                  {children.map((cid) => renderNode(cid, depth + 1))}
                                </Collapse>
                              ) : null}
                            </React.Fragment>
                          )
                        }
                        return renderNode(fid, 0)
                      })}
                    </List>
                  </OverlayScrollArea>
                </Paper>

                <OverlayScrollArea sx={{ flex: 1, minWidth: 0 }} scrollRef={refLibraryScrollRef}>
                  {refVisiblePathsAll.length ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: 1,
                      }}
                    >
                      {refVisiblePathsAll.slice(0, refLibraryLimit).map((p) => {
                        const slot = state.refLibrary.itemsByPath[p] || { dataUrl: '', loading: false, error: '' }
                        const name = p.split(/[\\/]/).pop() || p
                        const selected = refMultiMode && refSelectedSet.has(p)
                        return (
                          <Paper
                            key={p}
                            variant="outlined"
                            sx={{
                              p: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 1,
                              ...(selected ? { borderColor: 'primary.main' } : null),
                            }}
                          >
                            <Box
                              sx={{
                                position: 'relative',
                                height: 96,
                                borderRadius: 2,
                                bgcolor: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'hidden',
                                cursor: refMultiMode || slot.dataUrl ? 'pointer' : 'default',
                              }}
                              role={refMultiMode || slot.dataUrl ? 'button' : undefined}
                              tabIndex={refMultiMode || slot.dataUrl ? 0 : undefined}
                              onClick={() => {
                                if (refMultiMode) return toggleRefSelected(p)
                                if (!slot.dataUrl) return
                                void controller.addRefImageFromLibrary(p)
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return
                                e.preventDefault()
                                if (refMultiMode) return toggleRefSelected(p)
                                if (!slot.dataUrl) return
                                void controller.addRefImageFromLibrary(p)
                              }}
                            >
                              {refMultiMode ? (
                                <Checkbox
                                  size="small"
                                  checked={refSelectedSet.has(p)}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  onChange={() => toggleRefSelected(p)}
                                  inputProps={{ 'aria-label': `选择 ${name}` }}
                                  sx={{ position: 'absolute', left: 2, top: 2, bgcolor: 'rgba(250,249,245,0.92)' }}
                                />
                              ) : null}
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setRefLibraryItemMenu({ el: e.currentTarget, path: p })
                                }}
                                aria-label="更多操作"
                                sx={{ position: 'absolute', right: 4, top: 4, bgcolor: 'rgba(250,249,245,0.92)' }}
                              >
                                <MoreHorizRoundedIcon fontSize="inherit" />
                              </IconButton>

                              {slot.dataUrl ? (
                                <Box component="img" src={slot.dataUrl} alt={name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : slot.loading ? (
                                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>加载中…</Typography>
                              ) : slot.error ? (
                                <Typography sx={{ fontSize: 12, color: 'error.main' }}>加载失败</Typography>
                              ) : (
                                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>未加载</Typography>
                              )}
                            </Box>

                            <Typography sx={{ fontSize: 12 }} noWrap title={name}>
                              {name}
                            </Typography>
                          </Paper>
                        )
                      })}
                    </Box>
                  ) : (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      {state.refLibrary.paths.length
                        ? refActiveView.kind === 'folder'
                          ? '当前收藏夹为空。先点左侧“全部”，在图片菜单里把图片收藏进来。'
                          : '暂无图片。'
                        : '参考库为空。你可以点上面的“导入图片到参考库”。'}
                      </Typography>
                    )}

                    {refVisiblePathsAll.length > refLibraryLimit ? (
                      <Box ref={refLibrarySentinelRef} aria-hidden sx={{ height: 1, width: '100%' }} />
                    ) : null}
                </OverlayScrollArea>
              </Box>
            )}
          </Box>
          <Menu
            open={!!refLibraryItemMenu.el}
            anchorEl={refLibraryItemMenu.el}
            onClose={() => setRefLibraryItemMenu({ el: null, path: '' })}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem
              onClick={() => {
                const p = refLibraryItemMenu.path
                setRefLibraryItemMenu({ el: null, path: '' })
                if (!p) return
                setAssignRefFolderDialog({ open: true, mode: 'set', paths: [p], folderIds: getRefItemFolderIds(p) })
              }}
            >
              收藏到收藏夹…
            </MenuItem>
            {refActiveView.kind === 'folder' ? (
              <MenuItem
                onClick={() => {
                  const p = refLibraryItemMenu.path
                  const fid = String(refActiveView.folderId || '').trim()
                  setRefLibraryItemMenu({ el: null, path: '' })
                  if (!p || !fid) return
                  const cur = getRefItemFolderIds(p)
                  const has = cur.includes(fid)
                  const next = has ? cur.filter((x) => x !== fid) : cur.concat([fid])
                  void controller.setRefItemFolderIds(p, next)
                }}
              >
                {(() => {
                  const p = refLibraryItemMenu.path
                  const fid = String(refActiveView.folderId || '').trim()
                  const has = p && fid ? getRefItemFolderIds(p).includes(fid) : false
                  return has ? '从当前收藏夹移除' : '添加到当前收藏夹'
                })()}
              </MenuItem>
            ) : null}
            <Divider />
            <MenuItem
              onClick={() => {
                const p = refLibraryItemMenu.path
                setRefLibraryItemMenu({ el: null, path: '' })
                if (p) void controller.deleteRefLibraryItem(p)
              }}
              sx={{ color: 'error.main' }}
            >
              删除
            </MenuItem>
          </Menu>

          <Menu
            open={!!refFolderMenu.folderId}
            onClose={() => setRefFolderMenu({ folderId: '', x: 0, y: 0, name: '' })}
            anchorReference="anchorPosition"
            anchorPosition={refFolderMenu.folderId ? { top: refFolderMenu.y, left: refFolderMenu.x } : undefined}
          >
            <MenuItem
              onClick={() => {
                const fid = refFolderMenu.folderId
                setRefFolderMenu({ folderId: '', x: 0, y: 0, name: '' })
                setAddRefFolderDialog({ open: true, parentId: fid, name: '' })
              }}
            >
              新建子收藏夹
            </MenuItem>
            <MenuItem
              onClick={() => {
                const fid = refFolderMenu.folderId
                const name = refFolderMenu.name
                setRefFolderMenu({ folderId: '', x: 0, y: 0, name: '' })
                setRenameRefFolderDialog({ open: true, folderId: fid, name })
              }}
            >
              重命名
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                const fid = refFolderMenu.folderId
                const name = refFolderMenu.name
                setRefFolderMenu({ folderId: '', x: 0, y: 0, name: '' })
                setDeleteRefFolderConfirm({ open: true, folderId: fid, name })
              }}
              sx={{ color: 'error.main' }}
            >
              删除
            </MenuItem>
          </Menu>

          <Dialog open={addRefFolderDialog.open} onClose={() => setAddRefFolderDialog({ open: false, parentId: null, name: '' })} fullWidth maxWidth="xs">
            <DialogTitle>{addRefFolderDialog.parentId ? '新建子收藏夹' : '新建收藏夹'}</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                label="名称"
                value={addRefFolderDialog.name}
                onChange={(e) => setAddRefFolderDialog((d) => ({ ...d, name: e.target.value }))}
                fullWidth
                sx={{ mt: 1 }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setAddRefFolderDialog({ open: false, parentId: null, name: '' })}>取消</Button>
              <Button
                variant="contained"
                onClick={() => {
                  const { name, parentId } = addRefFolderDialog
                  setAddRefFolderDialog({ open: false, parentId: null, name: '' })
                  void controller.addRefFolder(name, parentId)
                }}
              >
                创建
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={renameRefFolderDialog.open}
            onClose={() => setRenameRefFolderDialog({ open: false, folderId: '', name: '' })}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>重命名收藏夹</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                label="名称"
                value={renameRefFolderDialog.name}
                onChange={(e) => setRenameRefFolderDialog((d) => ({ ...d, name: e.target.value }))}
                fullWidth
                sx={{ mt: 1 }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRenameRefFolderDialog({ open: false, folderId: '', name: '' })}>取消</Button>
              <Button
                variant="contained"
                onClick={() => {
                  const { folderId, name } = renameRefFolderDialog
                  setRenameRefFolderDialog({ open: false, folderId: '', name: '' })
                  void controller.renameRefFolder(folderId, name)
                }}
              >
                保存
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={deleteRefFolderConfirm.open}
            onClose={() => setDeleteRefFolderConfirm({ open: false, folderId: '', name: '' })}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>删除收藏夹</DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 1 }}>
                将删除“{deleteRefFolderConfirm.name || '收藏夹'}”以及它的所有子收藏夹；图片文件本身不会被删除，只会取消收藏关系。
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteRefFolderConfirm({ open: false, folderId: '', name: '' })}>取消</Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => {
                  const fid = deleteRefFolderConfirm.folderId
                  setDeleteRefFolderConfirm({ open: false, folderId: '', name: '' })
                  if (fid) void controller.deleteRefFolder(fid)
                }}
              >
                删除
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={assignRefFolderDialog.open}
            onClose={() => setAssignRefFolderDialog({ open: false, mode: 'set', paths: [], folderIds: [] })}
            fullWidth
            maxWidth="sm"
          >
            <DialogTitle>
              {assignRefFolderDialog.mode === 'add' && assignRefFolderDialog.paths.length > 1
                ? `批量收藏到收藏夹（${assignRefFolderDialog.paths.length} 张）`
                : '收藏到收藏夹'}
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
                {assignRefFolderDialog.mode === 'add'
                  ? '将把选中的图片添加到勾选的收藏夹（不会移除原有收藏）。'
                  : '同一张图片可以被多个收藏夹收藏。'}
              </Typography>
              <FormGroup sx={{ mt: 1 }}>
                {(() => {
                  const selected = new Set(assignRefFolderDialog.folderIds)
                  const render = (parent: string, depth: number): React.ReactNode[] => {
                    const ids = refChildrenByParent.get(parent) || []
                    const out: React.ReactNode[] = []
                    for (const id of ids) {
                      const f: any = refFolderById.get(id)
                      if (!f) continue
                      out.push(
                        <Box key={id} sx={{ pl: depth * 2 }}>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={selected.has(id)}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  setAssignRefFolderDialog((d) => {
                                    const cur = Array.isArray(d.folderIds) ? d.folderIds : []
                                    const has = cur.includes(id)
                                    const next = checked ? (has ? cur : cur.concat([id])) : cur.filter((x) => x !== id)
                                    return { ...d, folderIds: next }
                                  })
                                }}
                              />
                            }
                            label={String(f.name || '收藏夹')}
                          />
                        </Box>,
                      )
                      out.push(...render(id, depth + 1))
                    }
                    return out
                  }
                  return render('', 0)
                })()}
              </FormGroup>
            </DialogContent>
            <DialogActions>
              <Button
                disabled={refMultiBusy}
                onClick={() => setAssignRefFolderDialog({ open: false, mode: 'set', paths: [], folderIds: [] })}
              >
                取消
              </Button>
              <Button
                variant="contained"
                disabled={refMultiBusy}
                onClick={() => {
                  const d = assignRefFolderDialog
                  setAssignRefFolderDialog({ open: false, mode: 'set', paths: [], folderIds: [] })

                  const uniq: string[] = []
                  for (const x of Array.isArray(d.paths) ? d.paths : []) {
                    const p = String(x || '').trim()
                    if (!p) continue
                    if (!uniq.includes(p)) uniq.push(p)
                    if (uniq.length >= 5000) break
                  }
                  if (!uniq.length) return

                  setRefMultiBusy(true)
                  void (async () => {
                    try {
                      if (d.mode === 'set') {
                        await controller.setRefItemFolderIds(uniq[0], d.folderIds)
                        return
                      }
                      for (const p of uniq) {
                        const cur = getRefItemFolderIds(p)
                        const next = Array.from(new Set(cur.concat(d.folderIds))).filter(Boolean)
                        await controller.setRefItemFolderIds(p, next)
                      }
                      clearRefSelection()
                      api.ui.showToast(`已批量收藏 ${uniq.length} 张`)
                    } finally {
                      setRefMultiBusy(false)
                    }
                  })()
                }}
              >
                保存
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={refMultiDeleteConfirm.open}
            onClose={() => setRefMultiDeleteConfirm({ open: false, paths: [] })}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>删除选中图片？</DialogTitle>
            <DialogContent>
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
                将删除 {refMultiDeleteConfirm.paths.length} 张图片（无法恢复）。
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button disabled={refMultiBusy} onClick={() => setRefMultiDeleteConfirm({ open: false, paths: [] })}>
                取消
              </Button>
              <Button
                color="error"
                variant="contained"
                disabled={refMultiBusy || !refMultiDeleteConfirm.paths.length}
                onClick={() => {
                  const paths = refMultiDeleteConfirm.paths.slice()
                  setRefMultiDeleteConfirm({ open: false, paths: [] })
                  if (!paths.length) return
                  setRefMultiBusy(true)
                  void (async () => {
                    try {
                      await controller.deleteRefLibraryItems(paths)
                      clearRefSelection()
                    } finally {
                      setRefMultiBusy(false)
                    }
                  })()
                }}
              >
                删除
              </Button>
            </DialogActions>
          </Dialog>
        </DialogContent>
      </Dialog>
    </ThemeProvider>
  )
}
