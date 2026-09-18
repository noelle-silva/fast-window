import { now } from '../core/utils'
import { normalizeReasoningEffort, normalizeReasoningFields } from '../domain/reasoning'

type ModelGroupsDraftMutator = (items: any[]) => any[]

export function createModelGroupsController(deps: {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  emit: () => void
  showToast?: (msg: string, options?: any) => void
}) {
  function currentBox() {
    const state = deps.getState()
    if (!state.modelGroups || typeof state.modelGroups !== 'object') state.modelGroups = defaultModelGroupsState()
    state.modelGroups = { ...defaultModelGroupsState(), ...state.modelGroups }
    return { state, box: state.modelGroups }
  }

  function patchBox(patch: Record<string, any>) {
    const { state, box } = currentBox()
    state.modelGroups = { ...defaultModelGroupsState(), ...box, ...patch }
  }

  function updateItems(mutator: ModelGroupsDraftMutator) {
    const { box } = currentBox()
    const items = normalizeModelGroups(mutator(normalizeModelGroups(box.items)))
    patchBox({ items, saveError: '' })
    deps.emit()
  }

  async function refreshModelGroups(force = false) {
    const { box } = currentBox()
    if (!force && Array.isArray(box.items) && box.items.length && now() - Number(box.fetchedAt || 0) < 60_000) return box.items
    patchBox({ loading: true, error: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/model-groups', timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const items = normalizeModelGroups(response?.body)
      patchBox({ loading: false, error: '', items, fetchedAt: now() })
      return items
    } catch (e: any) {
      const error = String(e?.message || e || '加载模型组失败')
      patchBox({ loading: false, error })
      deps.showToast?.(error, { kind: 'error' })
      return []
    } finally {
      deps.emit()
    }
  }

  async function saveModelGroups() {
    const { box } = currentBox()
    const items = normalizeModelGroups(box.items)
    patchBox({ saving: true, saveError: '' })
    deps.emit()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: '/api/model-groups', body: items, timeoutMs: 15_000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const saved = normalizeModelGroups(response?.body)
      patchBox({ saving: false, saveError: '', items: saved, fetchedAt: now() })
      deps.showToast?.('模型组已保存', { kind: 'success' })
      return true
    } catch (e: any) {
      const error = String(e?.message || e || '保存模型组失败')
      patchBox({ saving: false, saveError: error })
      deps.showToast?.(error, { kind: 'error' })
      return false
    } finally {
      deps.emit()
    }
  }

  function createModelGroup() {
    updateItems((items) => [{ id: makeClientId('mg'), name: uniqueName('新模型组', items), models: [] }, ...items])
  }

  function deleteModelGroup(groupId: any) {
    const id = String(groupId || '').trim()
    if (!id) return
    updateItems((items) => items.filter((group) => String(group?.id || '') !== id))
  }

  function setModelGroupField(groupId: any, field: any, value: any) {
    const id = String(groupId || '').trim()
    const key = String(field || '').trim()
    if (!id || !['name'].includes(key)) return
    updateItems((items) => items.map((group) => String(group?.id || '') === id ? { ...group, [key]: String(value ?? '') } : group))
  }

  function createModelGroupModel(groupId: any) {
    const id = String(groupId || '').trim()
    if (!id) return
    updateItems((items) => items.map((group) => {
      if (String(group?.id || '') !== id) return group
      const models = Array.isArray(group.models) ? group.models : []
      return { ...group, models: [...models, { id: makeClientId('mgm'), name: uniqueName('对外模型', models), strategy: 'sequential', members: [] }] }
    }))
  }

  function deleteModelGroupModel(groupId: any, modelIndexRaw: any) {
    const gid = String(groupId || '').trim()
    const modelIndex = normalizeModelIndex(modelIndexRaw)
    if (!gid || modelIndex < 0) return
    updateItems((items) => items.map((group) => {
      if (String(group?.id || '') !== gid) return group
      return { ...group, models: (Array.isArray(group.models) ? group.models : []).filter((_model: any, index: number) => index !== modelIndex) }
    }))
  }

  function setModelGroupModelField(groupId: any, modelIndexRaw: any, field: any, value: any) {
    const gid = String(groupId || '').trim()
    const modelIndex = normalizeModelIndex(modelIndexRaw)
    const key = String(field || '').trim()
    if (!gid || modelIndex < 0 || !['id', 'name', 'strategy', 'supportsReasoning', 'defaultReasoningEffort'].includes(key)) return
    updateItems((items) => items.map((group) => {
      if (String(group?.id || '') !== gid) return group
      return {
        ...group,
        models: (Array.isArray(group.models) ? group.models : []).map((model: any, index: number) => {
          if (index !== modelIndex) return model
          if (key === 'supportsReasoning') {
            return normalizeReasoningFields({ ...model, supportsReasoning: !!value })
          }
          if (key === 'defaultReasoningEffort') {
            return normalizeReasoningFields({ ...model, supportsReasoning: true, defaultReasoningEffort: normalizeReasoningEffort(value) })
          }
          const nextValue = key === 'strategy' && String(value || '') === 'weighted_random' ? 'weighted_random' : key === 'strategy' ? 'sequential' : String(value ?? '')
          return { ...model, [key]: nextValue }
        }),
      }
    }))
  }

  function createModelGroupMember(groupId: any, modelIndexRaw: any) {
    const gid = String(groupId || '').trim()
    const modelIndex = normalizeModelIndex(modelIndexRaw)
    if (!gid || modelIndex < 0) return
    updateItems((items) => items.map((group) => {
      if (String(group?.id || '') !== gid) return group
      return {
        ...group,
        models: (Array.isArray(group.models) ? group.models : []).map((model: any, index: number) => {
          if (index !== modelIndex) return model
          return { ...model, members: [...(Array.isArray(model.members) ? model.members : []), { providerId: '', modelId: '', weight: 1 }] }
        }),
      }
    }))
  }

  function deleteModelGroupMember(groupId: any, modelIndexRaw: any, memberIndexRaw: any) {
    const gid = String(groupId || '').trim()
    const modelIndex = normalizeModelIndex(modelIndexRaw)
    const memberIndex = Number(memberIndexRaw)
    if (!gid || modelIndex < 0 || !Number.isInteger(memberIndex) || memberIndex < 0) return
    updateItems((items) => items.map((group) => {
      if (String(group?.id || '') !== gid) return group
      return {
        ...group,
        models: (Array.isArray(group.models) ? group.models : []).map((model: any, index: number) => {
          if (index !== modelIndex) return model
          return { ...model, members: (Array.isArray(model.members) ? model.members : []).filter((_member: any, index: number) => index !== memberIndex) }
        }),
      }
    }))
  }

  function setModelGroupMemberField(groupId: any, modelIndexRaw: any, memberIndexRaw: any, field: any, value: any) {
    const gid = String(groupId || '').trim()
    const modelIndex = normalizeModelIndex(modelIndexRaw)
    const memberIndex = Number(memberIndexRaw)
    const key = String(field || '').trim()
    if (!gid || modelIndex < 0 || !Number.isInteger(memberIndex) || memberIndex < 0 || !['providerId', 'modelId', 'weight'].includes(key)) return
    updateItems((items) => items.map((group) => {
      if (String(group?.id || '') !== gid) return group
      return {
        ...group,
        models: (Array.isArray(group.models) ? group.models : []).map((model: any, index: number) => {
          if (index !== modelIndex) return model
          return {
            ...model,
            members: (Array.isArray(model.members) ? model.members : []).map((member: any, index: number) => {
              if (index !== memberIndex) return member
              const nextValue = key === 'weight' ? Math.max(1, Math.round(Number(value || 1))) : String(value ?? '')
              return { ...member, [key]: nextValue }
            }),
          }
        }),
      }
    }))
  }

  return {
    refreshModelGroups,
    saveModelGroups,
    createModelGroup,
    deleteModelGroup,
    setModelGroupField,
    createModelGroupModel,
    deleteModelGroupModel,
    setModelGroupModelField,
    createModelGroupMember,
    deleteModelGroupMember,
    setModelGroupMemberField,
  }
}

export function defaultModelGroupsState() {
  return {
    loading: false,
    error: '',
    saving: false,
    saveError: '',
    items: [] as any[],
    fetchedAt: 0,
  }
}

export function normalizeModelGroups(value: any): any[] {
  const list = Array.isArray(value) ? value : []
  return list
    .filter((group) => group && typeof group === 'object')
    .map((group) => ({
      id: String(group.id || '').trim(),
      name: String(group.name || '').trim(),
      models: normalizeGroupModels(group.models),
      createdAt: typeof group.createdAt === 'string' ? group.createdAt : undefined,
      updatedAt: typeof group.updatedAt === 'string' ? group.updatedAt : undefined,
    }))
    .filter((group) => group.id || group.name)
}

function normalizeGroupModels(value: any): any[] {
  const list = Array.isArray(value) ? value : []
  return list
    .filter((model) => model && typeof model === 'object')
    .map((model) => ({
      id: String(model.id || '').trim(),
      name: String(model.name || '').trim(),
      strategy: String(model.strategy || '') === 'weighted_random' ? 'weighted_random' : 'sequential',
      ...normalizeReasoningFields({
        supportsReasoning: !!model.supportsReasoning,
        defaultReasoningEffort: normalizeReasoningEffort(model.defaultReasoningEffort),
      }),
      members: normalizeGroupMembers(model.members),
      createdAt: typeof model.createdAt === 'string' ? model.createdAt : undefined,
      updatedAt: typeof model.updatedAt === 'string' ? model.updatedAt : undefined,
    }))
    .filter((model) => model.id || model.name)
}

function normalizeGroupMembers(value: any): any[] {
  const list = Array.isArray(value) ? value : []
  return list
    .filter((member) => member && typeof member === 'object')
    .map((member) => ({
      providerId: String(member.providerId || '').trim(),
      modelId: String(member.modelId || '').trim(),
      weight: Math.max(1, Math.round(Number(member.weight || 1))),
    }))
}

function normalizeModelIndex(value: any) {
  const index = Number(value)
  return Number.isInteger(index) && index >= 0 ? index : -1
}

function makeClientId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueName(base: string, items: any[]) {
  const used = new Set((Array.isArray(items) ? items : []).map((item: any) => String(item?.name || '')).filter(Boolean))
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}（${index}）`)) index++
  return `${base}（${index}）`
}
