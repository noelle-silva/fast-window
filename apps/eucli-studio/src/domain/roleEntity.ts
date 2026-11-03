import { clampTemp } from '../core/utils'
import { normalizeDefaultCandidateId, normalizeRoleModelCandidates, type RoleModelCandidate } from './roleModelCandidates'
import { normalizeRoleToolPolicy } from './toolPolicy'

// 角色实体的规范化与写入比对属于领域规则：
// 保存路径与回读对账共用同一份快照，避免两处字段口径漂移。

function objectMap(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function objectList(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
}

function textField(source: unknown, key: string) {
  const box = objectMap(source)
  return String(box[key] ?? '').trim()
}

function numberField(source: unknown, key: string, fallback: number) {
  const value = objectMap(source)[key]
  return typeof value === 'number' && isFinite(value) ? value : fallback
}

function boolField(source: unknown, key: string, fallback: boolean) {
  const value = objectMap(source)[key]
  return typeof value === 'boolean' ? value : fallback
}

function promptText(prompts: Record<string, any>[]) {
  for (const prompt of prompts) {
    if (textField(prompt, 'role') === 'system') return String(prompt?.content ?? '').trim()
  }
  return ''
}

function modelRefFromCoordinate(coordinate: Record<string, any>): RoleModelCandidate {
  const kind = textField(coordinate, 'kind') || 'provider'
  return {
    kind,
    groupId: textField(coordinate, 'groupId'),
    providerId: textField(coordinate, 'providerId'),
    modelId: textField(coordinate, 'modelId'),
  }
}

function candidateId(ref: RoleModelCandidate) {
  return ref.kind === 'model_group' || ref.groupId
    ? `model_group:${ref.groupId}:${ref.modelId}`
    : `provider:${ref.providerId}:${ref.modelId}`
}

function modelCandidatesFromModelConfig(modelConfig: Record<string, any>): RoleModelCandidate[] {
  const raw = objectList(modelConfig.candidates)
  if (!raw.length) {
    const coordinate = objectMap(modelConfig.coordinate)
    if (!textField(coordinate, 'modelId')) return []
    return [modelRefFromCoordinate(coordinate)]
  }
  return raw
    .map((item) => modelRefFromCoordinate(objectMap(item.coordinate)))
    .filter((ref) => !!ref.modelId)
}

function defaultCandidateIdFromModelConfig(modelConfig: Record<string, any>, candidates: RoleModelCandidate[]) {
  const id = textField(modelConfig, 'defaultCandidateId')
  if (id) {
    for (const item of objectList(modelConfig.candidates)) {
      if (textField(item, 'id') !== id) continue
      return candidateId(modelRefFromCoordinate(objectMap(item.coordinate)))
    }
  }
  if (candidates.length === 1) return candidateId(candidates[0])
  return ''
}

// 直接 GET /api/roles/{id} 返回业务端的原生角色（prompts + modelConfig），
// 而本地保存路径使用 UI 形状（systemPrompt + modelCandidates）。
// 权威快照必须先把两种形状翻译成同一 UI 口径，否则每次回读都会误判为未写入。
function roleUiShape(role: any): any {
  const source = objectMap(role)
  const hasBoxModelConfig = !!source.modelConfig && typeof source.modelConfig === 'object'
  if (!hasBoxModelConfig && !Array.isArray(source.prompts)) return source

  const modelConfig = objectMap(source.modelConfig)
  const candidates = modelCandidatesFromModelConfig(modelConfig)
  return {
    id: textField(source, 'id'),
    name: textField(source, 'name') || '未命名角色',
    hookPromptPresetId: textField(source, 'hookPromptPresetId'),
    systemPrompt: promptText(objectList(source.prompts)),
    temperature: numberField(modelConfig, 'temperature', 1),
    temperatureEnabled: boolField(modelConfig, 'temperatureEnabled', false),
    modelCandidates: candidates,
    defaultModelCandidateId: defaultCandidateIdFromModelConfig(modelConfig, candidates),
    toolPolicy: source.toolPolicy,
  }
}

// roleWriteSnapshot 只覆盖角色实体本身「一次保存真正写入的字段」：
// createdAt / updatedAt 是服务端时间戳；avatarImage 属于 /avatar 独立资源，
// 不随角色实体返回，均不参与实体写入比对。
function roleWriteSnapshot(role: any) {
  const source = roleUiShape(role)
  const modelCandidates = normalizeRoleModelCandidates(source?.modelCandidates)
  return {
    id: String(source?.id || ''),
    name: String(source?.name || ''),
    systemPrompt: String(source?.systemPrompt || ''),
    temperature: clampTemp(source?.temperature),
    temperatureEnabled: source?.temperatureEnabled === true,
    hookPromptPresetId: String(source?.hookPromptPresetId || ''),
    modelCandidates,
    defaultModelCandidateId: normalizeDefaultCandidateId(source?.defaultModelCandidateId, modelCandidates),
    toolPolicy: normalizeRoleToolPolicy(source?.toolPolicy),
  }
}

// roleMatchesWrite 判断权威实体是否已经是本次写入后的值：
// 用于「写结果未知 → 回读」时决定保留本地还是回滚。
export function roleMatchesWrite(remote: any, intended: any): boolean {
  return JSON.stringify(roleWriteSnapshot(remote)) === JSON.stringify(roleWriteSnapshot(intended))
}
