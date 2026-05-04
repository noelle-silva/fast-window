import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { BUILTIN_TOOL_REQUEST_PRESETS, stringifyToolRequestRenderPreset } from '../../core/toolRequestPresets'
import { useEvent } from '../hooks/useEvent'

export function ToolRequestPresetsDialog(props: { open: boolean; onClose: () => void; controller: any; loading: boolean; userPresets: any[] }) {
  const { open, onClose, controller, loading, userPresets } = props
  const capabilities = controller?.capabilities
  const api = capabilities
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
    capabilities?.clipboard?.writeText?.(text).then(
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

