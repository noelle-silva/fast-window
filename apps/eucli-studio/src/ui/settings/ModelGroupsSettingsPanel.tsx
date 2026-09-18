import * as React from 'react'
import { Box, Button, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import { REASONING_EFFORT_OPTIONS } from '../../domain/reasoning'
import { SettingsListItem, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type ModelGroupsSettingsPanelProps = {
  controller: any
  loading: boolean
  modelGroups: any
  providers: any[]
}

export function ModelGroupsSettingsPanel(props: ModelGroupsSettingsPanelProps) {
  const { controller, loading, modelGroups, providers } = props
  const box = modelGroups && typeof modelGroups === 'object' ? modelGroups : {}
  const items = Array.isArray(box.items) ? box.items : []
  const busy = loading || !!box.loading || !!box.saving

  React.useEffect(() => {
    controller.actions.refreshModelGroups?.(false)
  }, [controller])

  return (
    <SettingsSurface>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900 }}>模型组</Typography>
              <Typography variant="caption" color="text.secondary">把已登记的供应商模型组合成对外模型入口。</Typography>
            </Box>
            <Button startIcon={<RefreshIcon />} variant="text" onClick={() => controller.actions.refreshModelGroups?.(true)} disabled={busy}>{box.loading ? '刷新中…' : '刷新'}</Button>
            <Button startIcon={<AddIcon />} variant="text" onClick={() => controller.actions.createModelGroup?.()} disabled={busy}>新建模型组</Button>
            <Button startIcon={<SaveIcon />} variant="contained" onClick={() => controller.actions.saveModelGroups?.()} disabled={busy}>{box.saving ? '保存中…' : '保存'}</Button>
          </Stack>
          {box.error ? <Typography variant="body2" color="error">{String(box.error || '')}</Typography> : null}
          {box.saveError ? <Typography variant="body2" color="error">{String(box.saveError || '')}</Typography> : null}

          <Stack spacing={1.5}>
            {items.length ? items.map((group: any) => (
              <ModelGroupCard key={String(group?.id || '')} controller={controller} group={group} providers={providers} busy={busy} />
            )) : (
              <Typography variant="body2" color="text.secondary">暂无模型组。</Typography>
            )}
          </Stack>
        </Stack>
    </SettingsSurface>
  )
}

function ModelGroupCard(props: { controller: any; group: any; providers: any[]; busy: boolean }) {
  const { controller, group, providers, busy } = props
  const groupId = String(group?.id || '')
  const models = Array.isArray(group?.models) ? group.models : []
  return (
    <SettingsListItem>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField size="small" label="模型组名称" value={String(group?.name || '')} onChange={(e) => controller.actions.setModelGroupField?.(groupId, 'name', e.target.value)} sx={{ flex: 1 }} />
          <Button size="small" startIcon={<AddIcon />} onClick={() => controller.actions.createModelGroupModel?.(groupId)} disabled={busy}>添加对外模型</Button>
          <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.deleteModelGroup?.(groupId)} disabled={busy}>删除组</Button>
        </Stack>

        {models.length ? models.map((model: any, modelIndex: number) => (
          <ModelGroupModelCard key={`${groupId}:model:${modelIndex}`} controller={controller} groupId={groupId} model={model} modelIndex={modelIndex} providers={providers} busy={busy} />
        )) : (
          <Typography variant="body2" color="text.secondary">这个模型组还没有对外模型。</Typography>
        )}
      </Stack>
    </SettingsListItem>
  )
}

function ModelGroupModelCard(props: { controller: any; groupId: string; model: any; modelIndex: number; providers: any[]; busy: boolean }) {
  const { controller, groupId, model, modelIndex, providers, busy } = props
  const modelId = String(model?.id || '')
  const members = Array.isArray(model?.members) ? model.members : []
  return (
    <SettingsSection tone="muted" sx={{ p: 1.25 }}>
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField
            size="small"
            label="对外模型 ID"
            value={modelId}
            onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'id', e.target.value)}
            helperText="用于角色或聊天引用这个对外入口，建议稳定后再被使用。"
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            label="显示名称"
            value={String(model?.name || '')}
            onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'name', e.target.value)}
            helperText="只给人看，方便在列表中识别，不承担引用身份。"
            sx={{ flex: 1 }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>策略</InputLabel>
            <Select label="策略" value={String(model?.strategy || '') === 'weighted_random' ? 'weighted_random' : 'sequential'} onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'strategy', e.target.value)}>
              <MenuItem value="sequential">顺序轮询</MenuItem>
              <MenuItem value="weighted_random">权重随机</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel control={<Switch checked={!!model?.supportsReasoning} onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'supportsReasoning', e.target.checked)} />} label="可推理" />
          {model?.supportsReasoning ? (
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>默认思考</InputLabel>
              <Select label="默认思考" value={String(model?.defaultReasoningEffort || 'medium')} onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'defaultReasoningEffort', e.target.value)}>
                {REASONING_EFFORT_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </Select>
            </FormControl>
          ) : null}
          <Button size="small" startIcon={<AddIcon />} onClick={() => controller.actions.createModelGroupMember?.(groupId, modelIndex)} disabled={busy}>添加成员</Button>
          <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.deleteModelGroupModel?.(groupId, modelIndex)} disabled={busy}>删除模型</Button>
        </Stack>

        {members.length ? members.map((member: any, index: number) => (
          <ModelGroupMemberRow key={index} controller={controller} groupId={groupId} modelIndex={modelIndex} member={member} memberIndex={index} providers={providers} busy={busy} />
        )) : (
          <Typography variant="caption" color="text.secondary">暂无成员模型。</Typography>
        )}
      </Stack>
    </SettingsSection>
  )
}

function ModelGroupMemberRow(props: { controller: any; groupId: string; modelIndex: number; member: any; memberIndex: number; providers: any[]; busy: boolean }) {
  const { controller, groupId, modelIndex, member, memberIndex, providers, busy } = props
  const providerId = String(member?.providerId || '')
  const provider = providers.find((item: any) => String(item?.id || '') === providerId) || null
  const registeredModels = Array.isArray(provider?.registeredModels) ? provider.registeredModels : []
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
      <FormControl size="small" sx={{ flex: 1 }}>
        <InputLabel>供应商</InputLabel>
        <Select label="供应商" value={providerId} onChange={(e) => controller.actions.setModelGroupMemberField?.(groupId, modelIndex, memberIndex, 'providerId', e.target.value)}>
          <MenuItem value=""><em>请选择供应商</em></MenuItem>
          {providers.map((providerItem: any) => <MenuItem key={String(providerItem?.id || '')} value={String(providerItem?.id || '')}>{String(providerItem?.name || '')}</MenuItem>)}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ flex: 1 }}>
        <InputLabel>登记模型</InputLabel>
        <Select label="登记模型" value={String(member?.modelId || '')} onChange={(e) => controller.actions.setModelGroupMemberField?.(groupId, modelIndex, memberIndex, 'modelId', e.target.value)} disabled={!providerId}>
          <MenuItem value=""><em>请选择模型</em></MenuItem>
          {registeredModels.map((model: any) => <MenuItem key={String(model?.id || '')} value={String(model?.id || '')}>{String(model?.name || model?.id || '')}</MenuItem>)}
        </Select>
      </FormControl>
      <TextField size="small" label="权重" type="number" value={String(member?.weight || 1)} onChange={(e) => controller.actions.setModelGroupMemberField?.(groupId, modelIndex, memberIndex, 'weight', e.target.value)} inputProps={{ min: 1, step: 1 }} sx={{ width: { xs: '100%', md: 120 } }} />
      <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.deleteModelGroupMember?.(groupId, modelIndex, memberIndex)} disabled={busy}>删除</Button>
    </Stack>
  )
}
