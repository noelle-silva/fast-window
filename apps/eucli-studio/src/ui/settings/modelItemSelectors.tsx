import { MenuItem } from '@mui/material'

export function registeredModelItems(provider: any) {
  const models = Array.isArray(provider?.registeredModels) ? provider.registeredModels : []
  return models
    .map((model: any) => {
      const id = String(model?.id || '').trim()
      const label = String(model?.name || model?.id || '').trim() || id
      const hint = String(model?.sourceModelId || '').trim()
      return { id, label, hint }
    })
    .filter((model: any) => model.id)
}

export function providerSelectItems(providers: any[]) {
  const list = Array.isArray(providers) ? providers : []
  return list.map((provider: any) => {
    const id = String(provider?.id || '')
    const label = String(provider?.name || id)
    return (
      <MenuItem key={id} value={id}>
        {label}
      </MenuItem>
    )
  })
}

export function aiServiceSourceValue(sourceKind: string, sourceId: string) {
  const kind = String(sourceKind || '') === 'model_group' ? 'model_group' : 'provider'
  const id = String(sourceId || '')
  return id ? `${kind}:${id}` : ''
}

export function aiServiceSourceSelectItems(providers: any[], modelGroups: any[]) {
  const providerItems = (Array.isArray(providers) ? providers : []).map((provider: any) => {
    const id = String(provider?.id || '')
    const label = String(provider?.name || id)
    return (
      <MenuItem key={`provider:${id}`} value={`provider:${id}`}>
        {label}
      </MenuItem>
    )
  })
  const groupItems = (Array.isArray(modelGroups) ? modelGroups : []).map((group: any) => {
    const id = String(group?.id || '')
    const label = String(group?.name || id)
    return (
      <MenuItem key={`model_group:${id}`} value={`model_group:${id}`}>
        {`模型组 / ${label}`}
      </MenuItem>
    )
  })
  return [...providerItems, ...groupItems]
}

export function modelGroupModelItems(group: any) {
  const models = Array.isArray(group?.models) ? group.models : []
  return models
    .map((model: any) => {
      const id = String(model?.id || '').trim()
      const label = String(model?.name || model?.id || '').trim() || id
      return { id, label, hint: '' }
    })
    .filter((model: any) => model.id)
}

export function aiServiceModelSelection(config: any, providers: any[], modelGroups: any[]) {
  const groupId = String(config?.groupId || '').trim()
  const sourceKind = groupId || String(config?.kind || '').trim() === 'model_group' ? 'model_group' : 'provider'
  const fallbackProviderId = String(providers?.[0]?.id || '')
  const fallbackGroupId = String(modelGroups?.[0]?.id || '')
  const sourceId = sourceKind === 'model_group' ? groupId || fallbackGroupId : String(config?.providerId || fallbackProviderId)
  const source = sourceKind === 'model_group'
    ? (Array.isArray(modelGroups) ? modelGroups : []).find((item: any) => String(item?.id || '') === sourceId) || null
    : (Array.isArray(providers) ? providers : []).find((item: any) => String(item?.id || '') === sourceId) || null
  const modelItems = sourceKind === 'model_group' ? modelGroupModelItems(source) : registeredModelItems(source)
  const modelPick = String(config?.modelId || '')
  const hasPickInList = !!modelPick && modelItems.some((item: any) => item.id === modelPick)
  return { sourceKind, sourceId, modelPick, modelItems, hasPickInList }
}

export function providerProtocolLabel(protocol: unknown) {
  const value = String(protocol || '').trim()
  if (value === 'openai') return 'OpenAI 兼容'
  if (value === 'anthropic') return 'Anthropic'
  return '未选择协议'
}
