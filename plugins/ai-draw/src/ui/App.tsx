import * as React from 'react'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CssBaseline,
  Badge,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
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
import type { AiDrawFastWindowApi } from '../bridge/tauriCompat'
import { createAiDrawController } from '../controller/createController'
import { UI_MODE_LOCAL_EDIT, UI_MODE_NORMAL, type AiDrawProvider, type UiMode } from '../core/schema'
import { createClaudeTheme } from './theme'

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
  const state = controller.getState()
  return { controller, state }
}

function activeProviderFromState(data: any): AiDrawProvider | null {
  if (!data) return null
  const pid = String(data.activeProviderId || '')
  const ps = Array.isArray(data.providers) ? data.providers : []
  return ps.find((p) => p && p.id === pid) || ps[0] || null
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
  const { controller, state } = useAiDrawController(api)

  const data = state.data
  const provider = activeProviderFromState(data)
  const providers = Array.isArray(data?.providers) ? data!.providers : []

  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [promptLibOpen, setPromptLibOpen] = React.useState(false)
  const [refLibraryOpen, setRefLibraryOpen] = React.useState(false)
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('provider')
  const [refLibraryLimit, setRefLibraryLimit] = React.useState(36)
  const [taskAnchorEl, setTaskAnchorEl] = React.useState<HTMLElement | null>(null)
  const [imageDetailAnchorEl, setImageDetailAnchorEl] = React.useState<HTMLElement | null>(null)
  const [normalMoreAnchorEl, setNormalMoreAnchorEl] = React.useState<HTMLElement | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false)
  const [refLibraryItemMenu, setRefLibraryItemMenu] = React.useState<{ el: HTMLElement | null; path: string }>({ el: null, path: '' })

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
    void controller.refreshRefLibrary()
  }, [refLibraryOpen, controller])

  React.useEffect(() => {
    if (!refLibraryOpen) return
    const paths = Array.isArray(state.refLibrary.paths) ? state.refLibrary.paths : []
    const slice = paths.slice(0, Math.max(0, refLibraryLimit))
    for (const p of slice) controller.ensureRefLibraryItemLoaded(p)
  }, [refLibraryOpen, refLibraryLimit, state.refLibrary.paths, controller])

  const uiMode: UiMode = String(state.uiMode || UI_MODE_NORMAL) === UI_MODE_LOCAL_EDIT ? UI_MODE_LOCAL_EDIT : UI_MODE_NORMAL
  const autoSave = !!data?.autoSave

  const imageIndexText =
    state.imageHistory.length && state.imageHistoryIndex >= 0
      ? `${state.imageHistoryIndex + 1}/${state.imageHistory.length}`
      : `0/${state.imageHistory.length}`

  const canImagePrev = state.imageHistory.length > 0 && (state.imageHistoryIndex === -1 || state.imageHistoryIndex > 0)
  const canImageNext = state.imageHistory.length > 0 && state.imageHistoryIndex >= 0 && state.imageHistoryIndex < state.imageHistory.length - 1

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
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                p: 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
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
            </Box>
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
        <DialogContent sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
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
                  <Stack spacing={0.5} sx={{ overflow: 'auto' }}>
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
                  <Box sx={{ flex: 1 }} />
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
                  <Stack spacing={1} sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
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
                          setPromptItemMenu({ el: e.currentTarget, folderId: String(folder?.id || ''), promptId: p.id })
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
        <Box sx={{ p: 1.5, maxHeight: 520, overflow: 'auto' }}>
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

      <Dialog open={refLibraryOpen} onClose={() => setRefLibraryOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>参考图库</DialogTitle>
        <DialogContent>
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
            <Chip size="small" variant="outlined" label={`共 ${state.refLibrary.paths.length} 张`} />
          </Stack>

          {state.refLibrary.loading ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>加载中…</Typography>
          ) : state.refLibrary.paths.length ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 1,
              }}
            >
              {state.refLibrary.paths.slice(0, refLibraryLimit).map((p) => {
                const slot = state.refLibrary.itemsByPath[p] || { dataUrl: '', loading: false, error: '' }
                const name = p.split(/[\\/]/).pop() || p
                return (
                  <Paper key={p} variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
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
                        cursor: slot.dataUrl ? 'pointer' : 'default',
                      }}
                      role={slot.dataUrl ? 'button' : undefined}
                      tabIndex={slot.dataUrl ? 0 : undefined}
                      onClick={() => {
                        if (!slot.dataUrl) return
                        void controller.addRefImageFromLibrary(p)
                      }}
                      onKeyDown={(e) => {
                        if (!slot.dataUrl) return
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        void controller.addRefImageFromLibrary(p)
                      }}
                    >
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
                        <Box
                          component="img"
                          src={slot.dataUrl}
                          alt={name}
                          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
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
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>参考库为空。你可以点“导入图片到参考库”。</Typography>
          )}

          {state.refLibrary.paths.length > refLibraryLimit ? (
            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
              <Button size="small" variant="outlined" onClick={() => setRefLibraryLimit((n) => n + 36)}>
                加载更多
              </Button>
            </Box>
          ) : null}

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
                if (p) void controller.deleteRefLibraryItem(p)
              }}
              sx={{ color: 'error.main' }}
            >
              删除
            </MenuItem>
          </Menu>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRefLibraryOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  )
}
