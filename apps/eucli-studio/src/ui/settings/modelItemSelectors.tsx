import { MenuItem } from '@mui/material'

export function registeredModelItems(provider: any) {
  const models = Array.isArray(provider?.registeredModels) ? provider.registeredModels : []
  return models
    .map((model: any) => {
      const id = String(model?.id || '').trim()
      // 模型选项只呈现对外 ID：上游模型名不进入选择列表。
      return { id, label: id }
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
      // 模型组对外模型同样只认 ID：选项不引入额外名称。
      return { id, label: id }
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

// providerProtocolLabel 只用于列表里展示协议名。
// 展示名归业务端所有：从清单里查找，找不到就原样回显取值，
// 这样业务端新增协议时客户端不认识也能正确显示，而不是退化成"未选择协议"。
export function providerProtocolLabel(protocol: unknown, options: any[] = []) {
  const value = String(protocol || '').trim()
  if (!value) return '未选择协议'
  const matched = (Array.isArray(options) ? options : []).find((option: any) => String(option?.value || '').trim() === value)
  return String(matched?.label || '').trim() || value
}
