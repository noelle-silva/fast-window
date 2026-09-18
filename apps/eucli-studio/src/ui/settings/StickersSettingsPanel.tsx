import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Popover,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ImageIcon from '@mui/icons-material/Image'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { useEvent } from '../hooks/useEvent'
import { SettingsListItem, SettingsSurface } from './SettingsSurfaces'
import { StickerInlineImage } from '../components/MessageMedia'

export function StickersSettingsPanel(props: { controller: any; loading: boolean; data: any }) {
  const { controller, loading, data } = props
  const api = controller?.capabilities

  const cfg = data?.settings?.stickers && typeof data.settings.stickers === 'object' ? data.settings.stickers : {}
  const stickerNamingCfg = (data?.settings?.aiServices?.stickerNaming && typeof (data.settings.aiServices as any).stickerNaming === 'object')
    ? (data.settings.aiServices as any).stickerNaming
    : {}
  const stickerNamingEnabled = !!stickerNamingCfg.enabled
  const stickerNamingProviderId = String(stickerNamingCfg.providerId || '').trim()
  const stickerNamingModelId = String(stickerNamingCfg.modelId || '').trim()
  const stickerNamingReady = stickerNamingEnabled && !!stickerNamingProviderId && !!stickerNamingModelId
  const stickerNamingDisabledReason = !stickerNamingEnabled
    ? '请先在“设置 > AI 微服务”中启用表情包取名服务'
    : !stickerNamingProviderId || !stickerNamingModelId
      ? '请先在“设置 > AI 微服务”中配置表情包取名的供应商和模型'
      : ''
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
    if (!name) return api?.ui?.showToast?.('请先选择分类', { kind: 'error' })
    const prompt = buildCategoryPrompt(name)
    if (!prompt) return
    const writeText = api?.clipboard?.writeText
    if (typeof writeText !== 'function') return api?.ui?.showToast?.('未授权：clipboard.writeText', { kind: 'error' })
    Promise.resolve()
      .then(() => writeText(prompt))
      .then(() => api?.ui?.showToast?.('已复制提示词', { kind: 'success' }))
      .catch(() => api?.ui?.showToast?.('复制失败', { kind: 'error' }))
  })

  const openCatMenu = useEvent((e: React.MouseEvent<HTMLElement>) => setCatMenuEl(e.currentTarget))
  const closeCatMenu = useEvent(() => setCatMenuEl(null))

  const openCreateCat = useEvent(() => {
    closeCatMenu()
    setCreateCat({ open: true, name: '' })
  })

  const closeCreateCat = useEvent(() => setCreateCat({ open: false, name: '' }))

  const onConfirmCreateCat = useEvent(async () => {
    const name = String(createCat.name || '').trim()
    if (!name) return api?.ui?.showToast?.('请输入分类名', { kind: 'error' })
    const ok = await Promise.resolve(controller.actions.createStickerCategory?.(name)).catch(() => false)
    if (ok) closeCreateCat()
  })

  const onPickStickerImages = useEvent(() => {
    if (!cat) return api?.ui?.showToast?.('请先选择分类', { kind: 'error' })
    controller.actions.pickStickerImages?.(cat)
  })

  const onOpenRename = useEvent((oldName: string) => {
    const n = String(oldName || '').trim()
    if (!n) return
    setRename({ open: true, oldName: n, nextName: n })
  })

  const onConfirmRename = useEvent(async () => {
    if (!rename.open) return
    const oldName = String(rename.oldName || '').trim()
    const nextName = String(rename.nextName || '').trim()
    if (!cat || !oldName || !nextName) return
    const ok = await Promise.resolve(controller.actions.renameSticker?.(cat, oldName, nextName)).catch(() => false)
    if (ok) setRename({ open: false, oldName: '', nextName: '' })
  })

  const box = stickerMap && typeof stickerMap === 'object' ? (stickerMap as any)[String(cat || '')] : null

  return (
    <>
      <SettingsSurface>
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
              variant="text"
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
            <Button startIcon={<ImageIcon />} variant="text" onClick={onPickStickerImages} disabled={loading || !cat}>
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
                  <SettingsListItem key={name}>
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
                        variant="text"
                        onClick={() => controller.capabilities?.clipboard?.writeText?.(token)}
                        disabled={!controller.capabilities?.clipboard?.writeText}
                      >
                        复制 token
                      </Button>
                      <Tooltip title={stickerNamingDisabledReason || '使用当前配置的 AI 服务为该表情包自动取名'}>
                        <span>
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => {
                              Promise.resolve()
                                .then(() => controller.actions.aiGenerateStickerName?.(cat, name))
                                .catch(() => {})
                            }}
                            disabled={loading || !stickerNamingReady}
                          >
                            AI 取名
                          </Button>
                        </span>
                      </Tooltip>
                      <Button size="small" variant="text" onClick={() => onOpenRename(name)} disabled={loading}>
                        改名
                      </Button>
                      <Button size="small" color="error" variant="text" onClick={() => controller.actions.deleteSticker?.(cat, name)}>
                        删除
                      </Button>
                    </Stack>
                  </SettingsListItem>
                )
              })}
            </Stack>
          )}
        </Stack>
      </SettingsSurface>

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
              Promise.resolve(controller.actions.deleteStickerCategory?.(name))
                .then((ok) => { if (ok) setConfirmDelCat('') })
                .catch(() => {})
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
              if (!name) return api?.ui?.showToast?.('请先选择分类', { kind: 'error' })
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
    </>
  )
}
