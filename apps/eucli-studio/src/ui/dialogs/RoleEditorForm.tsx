import * as React from 'react'
import { Box, Button, FormControl, InputLabel, MenuItem, Paper, Select, Slider, Stack, Switch, TextField, Typography } from '@mui/material'
import { EntityAvatar } from '../components/avatar/EntityAvatar'
import { RoleAvatarCropper } from '../components/avatar/RoleAvatarCropper'
import { PlaceholderSearchSection } from './PlaceholderSearchSection'
import { RoleModelSection } from './RoleModelSection'
import { RoleSystemPromptSection } from './RoleSystemPromptSection'
import { RoleToolsSection } from './RoleToolsSection'

function RoleDialogSection(props: { title: string; children: React.ReactNode }) {
  return (
    <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.5, bgcolor: 'var(--studio-paper-muted)', boxShadow: 'var(--studio-shadow-soft)' }}>
      <Stack spacing={1.25}>
        <Typography sx={{ fontWeight: 900 }}>{props.title}</Typography>
        {props.children}
      </Stack>
    </Paper>
  )
}

export function RoleEditorForm(props: { controller: any; providers: any[]; modelGroups: any[]; draft: any; models: any; tools: any; hookPrompts?: any; placeholders?: any; systemPlugins?: any }) {
  const { controller, providers, modelGroups, draft, models, tools, hookPrompts, placeholders, systemPlugins } = props

  const avatarImage = String(draft?.roleAvatarImage || '').trim()
  const avatarCropSrc = String(draft?.roleAvatarImageCropSrc || '').trim()

  const temp = Number(draft?.roleTemperature || 1)
  const temperatureEnabled = draft?.roleTemperatureEnabled === true
  const roleHookPromptPresetId = String(draft?.roleHookPromptPresetId || '')
  const hookPromptPresets = Array.isArray(hookPrompts?.library?.presets) ? hookPrompts.library.presets : []

  return (
    <Stack spacing={2}>
      <RoleDialogSection title="角色信息">
        <TextField label="角色名" value={String(draft?.roleName || '')} onChange={(e) => controller.actions.setDraft('roleName', e.target.value)} fullWidth />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <EntityAvatar kind="role" image={avatarImage} size={44} />
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
        <RoleSystemPromptSection
          controller={controller}
          roleName={String(draft?.roleName || '')}
          value={String(draft?.roleSystemPrompt || '')}
          onChange={(next) => controller.actions.setDraft('roleSystemPrompt', next)}
          placeholders={placeholders}
          systemPlugins={systemPlugins}
        />
      </RoleDialogSection>

      <RoleDialogSection title="占位符">
        <PlaceholderSearchSection controller={controller} placeholders={placeholders} systemPlugins={systemPlugins} />
      </RoleDialogSection>

      <RoleDialogSection title="模型">
        <RoleModelSection controller={controller} providers={providers} modelGroups={modelGroups} draft={draft} models={models} />
      </RoleDialogSection>

      <RoleDialogSection title="工具">
        <RoleToolsSection controller={controller} draft={draft} tools={tools} />
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
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              启用温度
            </Typography>
            <Typography variant="caption" color="text.secondary">
              关闭后不发送温度，走模型默认。
            </Typography>
          </Box>
          <Switch checked={temperatureEnabled} onChange={(e) => controller.actions.setDraft('roleTemperatureEnabled', e.target.checked)} />
        </Stack>
        <Typography variant="body2" sx={{ fontWeight: 900, opacity: temperatureEnabled ? 1 : 0.4 }}>
          温度：{Number.isFinite(temp) ? temp.toFixed(2) : '1.00'}
        </Typography>
        <Slider
          disabled={!temperatureEnabled}
          value={Number.isFinite(temp) ? temp : 1}
          min={0}
          max={2}
          step={0.05}
          onChange={(_e, v) => controller.actions.setDraft('roleTemperature', String(v))}
        />
      </RoleDialogSection>
    </Stack>
  )
}
