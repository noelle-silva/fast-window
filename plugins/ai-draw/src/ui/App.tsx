import * as React from 'react'
import {
  Alert,
  AppBar,
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
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
} from '@mui/material'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import BookmarksRoundedIcon from '@mui/icons-material/BookmarksRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import NavigateBeforeRoundedIcon from '@mui/icons-material/NavigateBeforeRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
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
  const dragRef = React.useRef<{ pointerId: number; startX: number; startY: number } | null>(null)

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

  const toRel = (clientX: number, clientY: number) => {
    const el = hostRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
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

  return (
    <Box
      ref={hostRef}
      sx={{
        position: 'relative',
        width: '100%',
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={(e) => {
        if (!dataUrl) return
        const p = toRel(e.clientX, e.clientY)
        if (!p) return
        dragRef.current = { pointerId: e.pointerId, startX: p.x, startY: p.y }
        ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)
        setFromPoints({ x: p.x, y: p.y }, { x: p.x, y: p.y })
      }}
      onPointerMove={(e) => {
        const d = dragRef.current
        if (!d || d.pointerId !== e.pointerId) return
        const p = toRel(e.clientX, e.clientY)
        if (!p) return
        setFromPoints({ x: d.startX, y: d.startY }, p)
      }}
      onPointerUp={(e) => {
        const d = dragRef.current
        if (!d || d.pointerId !== e.pointerId) return
        dragRef.current = null
        ;(e.currentTarget as any).releasePointerCapture?.(e.pointerId)
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
    >
      <Box
        component="img"
        src={dataUrl}
        alt="编辑底图"
        sx={{ display: 'block', width: '100%', height: 'auto', background: '#fff' }}
      />
      {sel ? (
        <Box
          sx={{
            position: 'absolute',
            left: `${sel.x * 100}%`,
            top: `${sel.y * 100}%`,
            width: `${sel.w * 100}%`,
            height: `${sel.h * 100}%`,
            border: '2px solid rgba(201,100,66,0.95)',
            boxSizing: 'border-box',
            borderRadius: 2,
            background: 'rgba(201,100,66,0.10)',
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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ height: 52, px: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
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

            <Chip
              size="small"
              variant="outlined"
              label={state.outputDir ? `输出：${state.outputDir}` : '输出：未设置'}
              sx={{ maxWidth: 560, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
              title={state.outputDir || ''}
            />

            <Box sx={{ flex: 1 }} />

            <Tooltip title="提示词收藏夹">
              <IconButton size="small" onClick={() => setPromptLibOpen(true)} aria-label="打开提示词收藏夹">
                <BookmarksRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
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

            {state.error ? <Alert severity="error">{state.error}</Alert> : null}

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

              <Tooltip title="新增供应商">
                <IconButton size="small" onClick={() => void controller.addProvider()} aria-label="新增供应商">
                  <AddRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title="删除当前供应商">
                <span>
                  <IconButton
                    size="small"
                    disabled={providers.length <= 1}
                    onClick={() => (provider ? void controller.deleteProvider(provider.id) : undefined)}
                    aria-label="删除供应商"
                  >
                    <DeleteRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
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

              <TextField
                size="small"
                label="批量"
                value={state.batchCount}
                onChange={(e) => controller.setBatchCount(e.target.value)}
                sx={{ width: 96 }}
                inputProps={{ inputMode: 'numeric' }}
              />
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
              minRows={6}
              maxRows={12}
              placeholder={uiMode === UI_MODE_LOCAL_EDIT ? '例如：把选区改成落日油画风，保持结构不变…' : '例如：一只橘猫坐在书桌前，暖色调，插画风…'}
            />

            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="outlined"
                onClick={() => controller.switchPromptHistory(-1)}
                disabled={!state.promptHistory.length}
              >
                ← 上一条
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => controller.switchPromptHistory(1)}
                disabled={!state.promptHistory.length}
              >
                下一条 →
              </Button>
              <Box sx={{ flex: 1 }} />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={uiMode === UI_MODE_LOCAL_EDIT}
                    onChange={(e) => void controller.setUiMode(e.target.checked ? UI_MODE_LOCAL_EDIT : UI_MODE_NORMAL)}
                  />
                }
                label={<Typography sx={{ fontSize: 12, color: 'text.secondary' }}>局部模式</Typography>}
              />
            </Stack>

            {uiMode === UI_MODE_LOCAL_EDIT ? (
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ImageRoundedIcon fontSize="small" />}
                    onClick={() => void controller.pickEditImage()}
                  >
                    选择底图
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<RestartAltRoundedIcon />} onClick={() => controller.clearEditImage()}>
                    清空
                  </Button>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={state.edit.baseDataUrl ? `已选：${state.edit.baseName} (${state.edit.baseW}x${state.edit.baseH})` : '未选择图片'}
                    sx={{ maxWidth: 260, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                    title={state.edit.baseName}
                  />
                </Stack>

                {state.edit.baseDataUrl ? (
                  <EditImageSelector dataUrl={state.edit.baseDataUrl} sel={state.edit.sel} onSelChange={controller.setEditSelection} />
                ) : null}
              </Stack>
            ) : null}

            <Divider />

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
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
                      />
                      <IconButton
                        size="small"
                        onClick={() => controller.removeRefImage(img.id)}
                        sx={{ position: 'absolute', right: 2, top: 2, bgcolor: 'rgba(250,249,245,0.92)', border: '1px solid #f0eee6' }}
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

            {state.tasks.length ? (
              <Paper variant="outlined" sx={{ p: 1, bgcolor: 'background.paper' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>任务</Typography>
                  <Chip size="small" label={String(state.tasks.length)} />
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" variant="outlined" color="error" onClick={() => void controller.cancelAllTasks()}>
                    取消全部
                  </Button>
                </Stack>
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                  {state.tasks.slice(0, 8).map((t) => (
                    <Stack key={t.id} direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1, minWidth: 0 }} noWrap title={t.id}>
                        {t.id}
                      </Typography>
                      <Chip size="small" variant="outlined" label={t.status} />
                      <Button size="small" variant="text" color="error" onClick={() => void controller.cancelTask(t.id)}>
                        取消
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            ) : null}
          </Paper>

          <Paper sx={{ flex: 1, minWidth: 0, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
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

            {state.savedPath ? (
              <Alert severity="success" variant="outlined">
                已保存：{state.savedPath}
              </Alert>
            ) : autoSave && state.imageDataUrl ? (
              <Alert severity="info" variant="outlined">
                自动保存已开启：后台保存完成后会自动更新“已保存路径”。
              </Alert>
            ) : null}

            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                borderRadius: 4,
                border: '1px solid',
                borderColor: 'divider',
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
          </Paper>
        </Box>
      </Box>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>设置</DialogTitle>
        <DialogContent dividers>
          <Tabs
            value={settingsTab}
            onChange={(_e, v) => setSettingsTab(v)}
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
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
                  onClick={() => (provider ? void controller.deleteProvider(provider.id) : undefined)}
                  variant="outlined"
                  disabled={providers.length <= 1}
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
        <DialogActions>
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

      <Dialog open={promptLibOpen} onClose={() => setPromptLibOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>提示词收藏夹</DialogTitle>
        <DialogContent dividers>
          {state.promptLib.loading ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>加载中…</Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 2, minHeight: 360 }}>
              <Paper variant="outlined" sx={{ width: 240, p: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>收藏夹</Typography>
                  <IconButton size="small" onClick={() => void controller.addPromptFolder('新收藏夹')}>
                    <AddRoundedIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Divider />
                <Stack spacing={0.5} sx={{ overflow: 'auto' }}>
                  {(state.promptLib.data?.folders || []).map((f) => (
                    <Button
                      key={f.id}
                      size="small"
                      variant={f.id === state.promptLib.data?.activeFolderId ? 'contained' : 'text'}
                      onClick={() => void controller.setActivePromptFolderId(f.id)}
                      sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                    >
                      {f.name}
                    </Button>
                  ))}
                </Stack>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteRoundedIcon fontSize="small" />}
                  onClick={() => {
                    const fid = state.promptLib.data?.activeFolderId || ''
                    if (fid) void controller.deletePromptFolder(fid)
                  }}
                  disabled={(state.promptLib.data?.folders || []).length <= 1}
                >
                  删除收藏夹
                </Button>
              </Paper>

              <Paper variant="outlined" sx={{ flex: 1, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>提示词</Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => void controller.addPromptToActiveFolder(state.prompt)}
                    disabled={!String(state.prompt || '').trim()}
                  >
                    把当前输入加入收藏
                  </Button>
                </Stack>
                <Divider />
                <Stack spacing={1} sx={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                  {(() => {
                    const d = state.promptLib.data
                    const fid = String(d?.activeFolderId || '')
                    const folder = (d?.folders || []).find((x) => x.id === fid) || (d?.folders || [])[0]
                    const prompts = folder?.prompts || []
                    return prompts.map((p) => (
                      <Paper key={p.id} variant="outlined" sx={{ p: 1 }}>
                        <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{p.text}</Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => {
                              controller.usePromptText(p.text)
                              setPromptLibOpen(false)
                            }}
                          >
                            使用
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => {
                              const fid2 = folder?.id || ''
                              if (fid2) void controller.deletePrompt(fid2, p.id)
                            }}
                          >
                            删除
                          </Button>
                        </Stack>
                      </Paper>
                    ))
                  })()}
                </Stack>
              </Paper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromptLibOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={refLibraryOpen} onClose={() => setRefLibraryOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>参考图库</DialogTitle>
        <DialogContent dividers>
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
                const name = p.split('/').pop() || p
                return (
                  <Paper key={p} variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box
                      sx={{
                        height: 96,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        bgcolor: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
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

                    <Typography sx={{ fontSize: 12 }} noWrap title={p}>
                      {name}
                    </Typography>

                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" onClick={() => void controller.addRefImageFromLibrary(p)}>
                        用作参考
                      </Button>
                      <Button size="small" variant="outlined" color="error" onClick={() => void controller.deleteRefLibraryItem(p)}>
                        删除
                      </Button>
                    </Stack>
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRefLibraryOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  )
}
