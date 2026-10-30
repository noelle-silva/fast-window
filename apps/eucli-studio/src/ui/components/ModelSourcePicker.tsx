import * as React from 'react'
import { FormControl, InputLabel, MenuItem, Select, Stack } from '@mui/material'
import { modelGroupModelItems, registeredModelItems } from '../settings/modelItemSelectors'

// 模型来源选择：先选「供应商 / 模型组」，再选具体模型。
// 角色编辑与临时模型弹窗共用同一份呈现，状态由调用方持有，组件只做展示与回调。
export type ModelSourceKind = 'provider' | 'model_group'

export type ModelSourceSelection = {
  kind: ModelSourceKind
  providerId: string
  groupId: string
  modelId: string
}

export function ModelSourcePicker(props: {
  value: ModelSourceSelection
  providers: any[]
  modelGroups: any[]
  disabled?: boolean
  onSourceChanged: (kind: ModelSourceKind) => void
  onProviderChanged: (providerId: string) => void
  onModelGroupChanged: (groupId: string) => void
  onModelChanged: (modelId: string) => void
  trailing?: React.ReactNode
}) {
  const { value, providers, modelGroups, disabled, onSourceChanged, onProviderChanged, onModelGroupChanged, onModelChanged, trailing } = props

  const provider = providers.find((item: any) => String(item?.id || '') === value.providerId) || null
  const modelGroup = modelGroups.find((item: any) => String(item?.id || '') === value.groupId) || null
  const modelItems = value.kind === 'model_group' ? modelGroupModelItems(modelGroup) : registeredModelItems(provider)
  const hasPickInList = !!value.modelId && modelItems.some((item: any) => item.id === value.modelId)

  return (
    <Stack spacing={1.5}>
      <FormControl fullWidth size="small" disabled={disabled}>
        <InputLabel>模型来源</InputLabel>
        <Select label="模型来源" value={value.kind} onChange={(e) => onSourceChanged(String(e.target.value || '') === 'model_group' ? 'model_group' : 'provider')}>
          <MenuItem value="provider">供应商模型</MenuItem>
          <MenuItem value="model_group">模型组</MenuItem>
        </Select>
      </FormControl>

      {value.kind === 'provider' ? (
        <FormControl fullWidth size="small" disabled={disabled}>
          <InputLabel>供应商</InputLabel>
          <Select label="供应商" value={value.providerId} onChange={(e) => onProviderChanged(String(e.target.value || ''))}>
            {providers.map((item: any) => (
              <MenuItem key={String(item?.id || '')} value={String(item?.id || '')}>
                {String(item?.name || '')}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : (
        <FormControl fullWidth size="small" disabled={disabled}>
          <InputLabel>模型组</InputLabel>
          <Select label="模型组" value={value.groupId} onChange={(e) => onModelGroupChanged(String(e.target.value || ''))}>
            {modelGroups.map((item: any) => (
              <MenuItem key={String(item?.id || '')} value={String(item?.id || '')}>
                {String(item?.name || '')}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <FormControl fullWidth size="small" disabled={disabled}>
          <InputLabel>模型</InputLabel>
          <Select label="模型" value={value.modelId} onChange={(e) => onModelChanged(String(e.target.value || ''))}>
            <MenuItem value="">请选择模型</MenuItem>
            {!hasPickInList && value.modelId ? <MenuItem value={value.modelId}>{value.modelId}</MenuItem> : null}
            {modelItems.map((item: any) => (
              <MenuItem key={item.id} value={item.id}>
                {item.hint ? `${item.label} / ${item.hint}` : item.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {trailing}
      </Stack>
    </Stack>
  )
}
