import * as React from 'react'
import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { RoleAvatarCropper } from '../components/avatar/RoleAvatarCropper'
import { ScrollableDialogContent } from '../components/ScrollableDialogContent'
import { RoleNativeToolsSection } from './RoleNativeToolsSection'
import { RoleToolWhitelistSection } from './RoleToolWhitelistSection'

function RoleDialogSection(props: { title: string; children: React.ReactNode }) {
  return (
    <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.5, bgcolor: 'rgba(15,23,42,.025)', boxShadow: 'var(--studio-shadow-soft)' }}>
      <Stack spacing={1.25}>
        <Typography sx={{ fontWeight: 900 }}>{props.title}</Typography>
        {props.children}
      </Stack>
    </Paper>
  )
}

export function RoleDialog(props: { open: boolean; controller: any; providers: any[]; modelGroups: any[]; draft: any; models: any; tools: any; hookPrompts?: any }) {
  const { open, controller, providers, modelGroups, draft, models, tools, hookPrompts } = props
  const [moreMenuEl, setMoreMenuEl] = React.useState<HTMLElement | null>(null)

  const editRoleId = String(draft?.editRoleId || '')
  const isNew = editRoleId === '__new__'

  const avatarEmoji = String(draft?.roleAvatar || '').trim() || '🙂'
  const avatarImage = String(draft?.roleAvatarImage || '').trim()
  const avatarCropSrc = String(draft?.roleAvatarImageCropSrc || '').trim()

  const providerId = String(draft?.roleProviderId || '')
  const modelSource = String(draft?.roleModelSource || '') === 'model_group' ? 'model_group' : 'provider'
  const modelGroupId = String(draft?.roleModelGroupId || '')
  const temp = Number(draft?.roleTemperature || 0.7)
  const roleHookPromptPresetId = String(draft?.roleHookPromptPresetId || '')
  const hookPromptPresets = Array.isArray(hookPrompts?.library?.presets) ? hookPrompts.library.presets : []
  const provider = providers.find((p: any) => String(p?.id || '') === providerId) || null
  const providerModels = Array.isArray(provider?.registeredModels) ? provider.registeredModels : []
  const modelGroup = modelGroups.find((group: any) => String(group?.id || '') === modelGroupId) || null
  const groupModels = Array.isArray(modelGroup?.models) ? modelGroup.models : []
  const providerModelItems = providerModels.map((model: any) => ({ id: String(model?.id || ''), label: String(model?.name || model?.id || ''), hint: String(model?.sourceModelId || '') })).filter((model: any) => model.id)
  const groupModelItems = groupModels.map((model: any) => ({ id: String(model?.id || ''), label: String(model?.name || model?.id || '') })).filter((model: any) => model.id)
  const modelItems = modelSource === 'model_group' ? groupModelItems : providerModelItems
  const modelPick = modelSource === 'model_group' ? String(draft?.roleModelGroupModelId || '') : String(draft?.roleModelId || '')
  const hasPickInList = !!modelPick && modelItems.some((x: any) => x.id === modelPick)

  return (
    <Dialog open={open} onClose={() => controller.actions.closeModal()} fullWidth maxWidth="md">
      <ScrollableDialogContent>
          <RoleDialogSection title="角色信息">
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
          </RoleDialogSection>

          <RoleDialogSection title="系统提示词">
            <TextField
              label="系统提示词"
              value={String(draft?.roleSystemPrompt || '')}
              onChange={(e) => controller.actions.setDraft('roleSystemPrompt', e.target.value)}
              fullWidth
              multiline
              rows={20}
              placeholder="写入系统提示词…"
            />
          </RoleDialogSection>

          <RoleDialogSection title="模型">
            <FormControl fullWidth>
              <InputLabel>模型来源</InputLabel>
              <Select label="模型来源" value={modelSource} onChange={(e) => controller.actions.roleModelSourceChanged?.(e.target.value)}>
                <MenuItem value="provider">供应商模型</MenuItem>
                <MenuItem value="model_group">模型组</MenuItem>
              </Select>
            </FormControl>

            <Stack spacing={1.5}>
              {modelSource === 'provider' ? (
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
              ) : (
                <FormControl fullWidth>
                  <InputLabel>模型组</InputLabel>
                  <Select label="模型组" value={modelGroupId} onChange={(e) => controller.actions.roleModelGroupChanged?.(e.target.value)}>
                    {modelGroups.map((group: any) => (
                      <MenuItem key={String(group?.id || '')} value={String(group?.id || '')}>
                        {String(group?.name || '')}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <FormControl fullWidth>
                <InputLabel>模型</InputLabel>
                <Select label="模型" value={modelPick} onChange={(e) => controller.actions.roleModelChanged(e.target.value)}>
                  <MenuItem value="">请选择模型</MenuItem>
                  {!hasPickInList && modelPick ? (
                    <MenuItem value={modelPick}>{modelPick}</MenuItem>
                  ) : null}
                  {modelItems.map((item: any) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.hint ? `${item.label} / ${item.hint}` : item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {modelSource === 'provider' ? (
              <Typography variant="caption" color="text.secondary">
                仅显示供应商设置中已登记的模型；原始模型列表请到供应商设置中刷新并登记。
              </Typography>
            ) : null}

            {models?.error ? (
              <Typography variant="body2" color="error">
                {String(models.error || '')}
              </Typography>
            ) : null}
          </RoleDialogSection>

          <RoleDialogSection title="工具">
            <RoleNativeToolsSection controller={controller} draft={draft} tools={tools} />
            <RoleToolWhitelistSection controller={controller} draft={draft} tools={tools} />
          </RoleDialogSection>

          <RoleDialogSection title="默认 hook 提示词">
            <FormControl fullWidth>
              <InputLabel>默认 hook 提示词</InputLabel>
              <Select label="默认 hook 提示词" value={roleHookPromptPresetId} onChange={(e) => controller.actions.setDraft('roleHookPromptPresetId', e.target.value)}>
                <MenuItem value="">无默认预设</MenuItem>
                {hookPromptPresets.map((preset: any) => {
                  const id = String(preset?.id || '')
                  if (!id) return null
                  return <MenuItem key={id} value={id}>{String(preset?.name || '未命名预设')}</MenuItem>
                })}
              </Select>
            </FormControl>
          </RoleDialogSection>

          <RoleDialogSection title="温度">
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              温度：{Number.isFinite(temp) ? temp.toFixed(2) : '0.70'}
            </Typography>
            <Slider value={Number.isFinite(temp) ? temp : 0.7} min={0} max={2} step={0.05} onChange={(_e, v) => controller.actions.setDraft('roleTemperature', String(v))} />
          </RoleDialogSection>
      </ScrollableDialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        {isNew ? (
          <Box />
        ) : (
          <IconButton size="small" aria-label="更多操作" onClick={(e) => setMoreMenuEl(e.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
        <Stack direction="row" spacing={1}>
          <Button onClick={() => controller.actions.closeModal()}>取消</Button>
          <Button variant="contained" onClick={() => controller.actions.saveRole()} disabled={!!avatarCropSrc}>
            保存
          </Button>
        </Stack>
        <Menu anchorEl={moreMenuEl} open={!!moreMenuEl} onClose={() => setMoreMenuEl(null)}>
          <MenuItem
            sx={{ color: 'error.main', gap: 1 }}
            onClick={() => {
              setMoreMenuEl(null)
              controller.actions.askDeleteRole(editRoleId)
            }}
          >
            <DeleteOutlineIcon fontSize="small" />
            删除角色
          </MenuItem>
        </Menu>
      </DialogActions>
    </Dialog>
  )
}
