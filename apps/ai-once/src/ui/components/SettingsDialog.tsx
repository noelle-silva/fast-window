import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { Alert, Box, Button, Dialog, Divider, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { activeProvider, createDefaultProvider } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'

type SettingsDialogProps = {
  controller: AiOnceController
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { controller } = props
  const editing = controller.state.editing
  const open = controller.state.dialog === 'settings' && !!editing
  const provider = activeProvider(editing)

  return (
    <Dialog open={open} onClose={controller.closeDialog} fullWidth maxWidth="md" PaperProps={{ sx: { maxHeight: 'min(86vh, 760px)', overflow: 'hidden' } }}>
      {editing && provider ? (
        <Box sx={{ p: { xs: 1.5, sm: 2 }, overflow: 'auto' }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>供应商与图片设置</Typography>
              <Typography variant="body2" color="text.secondary">维护 OpenAI 兼容接口、模型缓存和图片输入限制。</Typography>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                <InputLabel id="settings-provider-label">供应商</InputLabel>
                <Select
                  labelId="settings-provider-label"
                  label="供应商"
                  value={editing.settings.activeProviderId}
                  onChange={event => controller.mutateEditing(draft => { draft.settings.activeProviderId = event.target.value })}
                >
                  {editing.settings.providers.map(item => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
                </Select>
              </FormControl>
              <Button
                startIcon={<AddRoundedIcon fontSize="small" />}
                onClick={() => controller.mutateEditing(draft => {
                  const next = createDefaultProvider()
                  draft.settings.providers.unshift(next)
                  draft.settings.activeProviderId = next.id
                })}
              >
                新增供应商
              </Button>
              <Button
                color="error"
                startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                disabled={editing.settings.providers.length <= 1}
                onClick={() => controller.mutateEditing(draft => {
                  draft.settings.providers = draft.settings.providers.filter(item => item.id !== provider.id)
                  draft.settings.activeProviderId = draft.settings.providers[0]?.id || ''
                })}
              >
                删除当前
              </Button>
            </Stack>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
              <TextField label="名称" value={provider.name} onChange={event => controller.mutateEditing(draft => { const hit = draft.settings.providers.find(item => item.id === provider.id); if (hit) hit.name = event.target.value })} />
              <TextField label="API Key" type="password" value={provider.apiKey} onChange={event => controller.mutateEditing(draft => { const hit = draft.settings.providers.find(item => item.id === provider.id); if (hit) hit.apiKey = event.target.value })} />
              <TextField
                label="Base URL"
                value={provider.baseUrl}
                onChange={event => controller.mutateEditing(draft => {
                  const hit = draft.settings.providers.find(item => item.id === provider.id)
                  if (hit) {
                    hit.baseUrl = event.target.value
                    hit.modelsCache = { items: [], fetchedAt: 0 }
                  }
                })}
                sx={{ gridColumn: { xs: 'auto', sm: '1 / -1' } }}
              />
              <TextField label="图片张数" type="number" inputProps={{ min: 1 }} value={editing.settings.imageMaxCount} onChange={event => controller.mutateEditing(draft => { draft.settings.imageMaxCount = Math.max(1, Number(event.target.value) || 1) })} />
              <TextField label="单图 MB" type="number" inputProps={{ min: 0.5, step: 0.5 }} value={editing.settings.imageMaxMb} onChange={event => controller.mutateEditing(draft => { draft.settings.imageMaxMb = Math.max(0.5, Number(event.target.value) || 0.5) })} />
            </Box>

            <Alert severity="info" sx={{ py: 0.5 }}>
              模型列表由当前供应商的兼容接口返回；修改 Base URL 后会清空旧模型缓存。
            </Alert>

            <Divider />

            <Stack direction="row" spacing={1} justifyContent="space-between" flexWrap="wrap">
              <Button startIcon={<RefreshRoundedIcon fontSize="small" />} onClick={() => void controller.refreshModels()} disabled={controller.state.busy}>
                刷新模型
              </Button>
              <Stack direction="row" spacing={1}>
                <Button onClick={controller.closeDialog}>取消</Button>
                <Button variant="contained" startIcon={<SaveRoundedIcon fontSize="small" />} onClick={() => void controller.saveEditing()} disabled={controller.state.busy}>
                  保存
                </Button>
              </Stack>
            </Stack>

            <Box component="pre" sx={{ m: 0, p: 1.25, maxHeight: 180, overflow: 'auto', borderRadius: 2, bgcolor: 'rgba(15, 23, 42, 0.035)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 }}>
              {JSON.stringify(controller.state.health, null, 2)}
            </Box>
          </Stack>
        </Box>
      ) : null}
    </Dialog>
  )
}
