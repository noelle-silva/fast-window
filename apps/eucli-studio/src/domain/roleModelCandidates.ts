import { normalizeModelRef, type ModelRef } from './modelRefUtils'

// 角色候选模型：坐标即身份。候选池不允许同一模型出现两次，
// 因此候选标识直接由坐标推导，不额外维护一套会漂移的标识空间。
export type RoleModelCandidate = ModelRef

// modelCandidateKey 是候选模型在池内的唯一标识。
export function modelCandidateKey(ref: ModelRef): string {
  return ref.kind === 'model_group' ? `model_group:${ref.groupId}:${ref.modelId}` : `provider:${ref.providerId}:${ref.modelId}`
}

// normalizeRoleModelCandidates 归一候选池：坐标必须完整，同坐标只保留一项。
export function normalizeRoleModelCandidates(value: unknown): RoleModelCandidate[] {
  const list = Array.isArray(value) ? value : []
  const out: RoleModelCandidate[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const ref = normalizeModelRef(item)
    if (!ref) continue
    const key = modelCandidateKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

// normalizeDefaultCandidateId 保证默认引用始终落在池内；池内没有该项时退回首个候选。
export function normalizeDefaultCandidateId(value: unknown, candidates: RoleModelCandidate[]): string {
  const id = String(value ?? '').trim()
  if (id && candidates.some((candidate) => modelCandidateKey(candidate) === id)) return id
  return candidates[0] ? modelCandidateKey(candidates[0]) : ''
}

// defaultRoleModelCandidate 取默认候选；缺失即返回 null，不退回其它候选。
export function defaultRoleModelCandidate(role: unknown): RoleModelCandidate | null {
  const source = role && typeof role === 'object' ? (role as Record<string, unknown>) : null
  if (!source) return null
  const candidates = normalizeRoleModelCandidates(source.modelCandidates)
  const id = String(source.defaultModelCandidateId ?? '').trim()
  if (!id) return null
  return candidates.find((candidate) => modelCandidateKey(candidate) === id) || null
}

// roleDefaultModelRef 是角色当前生效模型的唯一读取入口：只认默认候选。
export function roleDefaultModelRef(role: unknown): ModelRef | null {
  return defaultRoleModelCandidate(role)
}

// normalizeRoleModelConfig 把角色的候选池与默认引用一次归一，写回同一对象。
// 早期客户端数据只有单一模型引用，这里把它翻译为「一个候选 + 它即默认」，
// 与业务端解码口径一致，不产生第二套读取分支。
export function normalizeRoleModelConfig(role: any) {
  if (!role || typeof role !== 'object') return
  let candidates = normalizeRoleModelCandidates(role.modelCandidates)
  let defaultId = String(role.defaultModelCandidateId ?? '').trim()
  if (!candidates.length) {
    const legacy = normalizeModelRef(role.modelRef)
    if (legacy) {
      candidates = [legacy]
      defaultId = modelCandidateKey(legacy)
    }
  }
  role.modelCandidates = candidates
  role.defaultModelCandidateId = normalizeDefaultCandidateId(defaultId, candidates)
  delete role.modelRef
}

// addRoleModelCandidate 往候选池加入一个模型；已在池内则不重复添加。
export function addRoleModelCandidate(candidates: unknown, ref: unknown): RoleModelCandidate[] {
  const next = normalizeRoleModelCandidates(candidates)
  const normalized = normalizeModelRef(ref)
  if (!normalized) return next
  const key = modelCandidateKey(normalized)
  if (next.some((candidate) => modelCandidateKey(candidate) === key)) return next
  return [...next, normalized]
}

// removeRoleModelCandidate 从候选池移除一个模型；默认引用由调用方重新归一。
export function removeRoleModelCandidate(candidates: unknown, id: unknown): RoleModelCandidate[] {
  const target = String(id ?? '').trim()
  if (!target) return normalizeRoleModelCandidates(candidates)
  return normalizeRoleModelCandidates(candidates).filter((candidate) => modelCandidateKey(candidate) !== target)
}
