import { describe, expect, it } from 'vitest'
import {
  addRoleModelCandidate,
  defaultRoleModelCandidate,
  modelCandidateKey,
  moveRoleModelCandidate,
  normalizeDefaultCandidateId,
  normalizeRoleModelCandidates,
  normalizeRoleModelConfig,
  removeRoleModelCandidate,
  roleDefaultModelRef,
} from './roleModelCandidates'

const providerRef = (providerId: string, modelId: string) => ({ kind: 'provider', providerId, groupId: '', modelId })
const groupRef = (groupId: string, modelId: string) => ({ kind: 'model_group', providerId: '', groupId, modelId })

describe('角色候选模型池', () => {
  it('归一候选池：坐标不完整项被丢弃、同坐标只留一项', () => {
    const candidates = normalizeRoleModelCandidates([
      providerRef('openai', 'gpt-4.1'),
      providerRef('openai', 'gpt-4.1'),
      { kind: 'provider', providerId: '', modelId: 'orphan' },
      groupRef('main-group', 'balanced'),
    ])
    expect(candidates).toEqual([providerRef('openai', 'gpt-4.1'), groupRef('main-group', 'balanced')])
  })

  it('默认引用始终落在池内，池内没有该项时退回首个候选', () => {
    const candidates = normalizeRoleModelCandidates([providerRef('openai', 'gpt-4.1'), groupRef('main-group', 'balanced')])
    expect(normalizeDefaultCandidateId('provider:openai:gpt-4.1', candidates)).toBe('provider:openai:gpt-4.1')
    expect(normalizeDefaultCandidateId('provider:absent:x', candidates)).toBe(modelCandidateKey(candidates[0]))
    expect(normalizeDefaultCandidateId('', [])).toBe('')
  })

  it('默认候选缺失时返回空，不退回其它候选', () => {
    const role = {
      modelCandidates: [providerRef('openai', 'gpt-4.1')],
      defaultModelCandidateId: '',
    }
    expect(defaultRoleModelCandidate(role)).toBeNull()
    expect(roleDefaultModelRef(role)).toBeNull()
  })

  it('默认候选存在时它就是角色生效模型', () => {
    const role = {
      modelCandidates: [providerRef('openai', 'gpt-4.1'), groupRef('main-group', 'balanced')],
      defaultModelCandidateId: 'model_group:main-group:balanced',
    }
    expect(roleDefaultModelRef(role)).toEqual(groupRef('main-group', 'balanced'))
  })

  it('加入候选：重复坐标不重复加入', () => {
    const once = addRoleModelCandidate([], providerRef('openai', 'gpt-4.1'))
    const twice = addRoleModelCandidate(once, providerRef('openai', 'gpt-4.1'))
    expect(once).toHaveLength(1)
    expect(twice).toHaveLength(1)
  })

  it('移除候选：按坐标标识移除，其余保持顺序', () => {
    const candidates = [providerRef('openai', 'gpt-4.1'), groupRef('main-group', 'balanced')]
    expect(removeRoleModelCandidate(candidates, 'provider:openai:gpt-4.1')).toEqual([groupRef('main-group', 'balanced')])
  })

  it('整体归一：候选池与默认引用写回同一对象', () => {
    const role: any = {
      modelCandidates: [providerRef('openai', 'gpt-4.1')],
      defaultModelCandidateId: 'provider:absent:x',
    }
    normalizeRoleModelConfig(role)
    expect(role.modelCandidates).toEqual([providerRef('openai', 'gpt-4.1')])
    expect(role.defaultModelCandidateId).toBe('provider:openai:gpt-4.1')
  })

  it('整体归一：旧单一模型引用翻译为一个候选并成为默认', () => {
    const role: any = {
      modelRef: { kind: 'provider', providerId: 'openai', groupId: '', modelId: 'gpt-4.1' },
    }
    normalizeRoleModelConfig(role)
    expect(role.modelCandidates).toEqual([providerRef('openai', 'gpt-4.1')])
    expect(role.defaultModelCandidateId).toBe('provider:openai:gpt-4.1')
    expect(role.modelRef).toBeUndefined()
  })
})
describe('moveRoleModelCandidate 池内排序', () => {
  const a = providerRef('openai', 'gpt-4.1')
  const b = providerRef('openai', 'gpt-4o')
  const c = groupRef('main-group', 'balanced')
  const key = (ref: any) => modelCandidateKey(ref)

  it('向后拖：插到目标项之后', () => {
    expect(moveRoleModelCandidate([a, b, c], key(a), key(b), 'after')).toEqual([b, a, c])
  })

  it('向前拖：插到目标项之前', () => {
    expect(moveRoleModelCandidate([a, b, c], key(c), key(a), 'before')).toEqual([c, a, b])
  })

  it('拖到末尾：插到最后一项之后', () => {
    expect(moveRoleModelCandidate([a, b, c], key(a), key(c), 'after')).toEqual([b, c, a])
  })

  it('只重排不增删：条目集合保持不变', () => {
    const next = moveRoleModelCandidate([a, b, c], key(a), key(c), 'after')
    expect(next).toHaveLength(3)
    expect(new Set(next.map(key))).toEqual(new Set([a, b, c].map(key)))
  })

  it('标识缺失或相同：原样返回', () => {
    expect(moveRoleModelCandidate([a, b, c], key(a), key(a), 'after')).toEqual([a, b, c])
    expect(moveRoleModelCandidate([a, b, c], 'provider:absent:x', key(b), 'after')).toEqual([a, b, c])
    expect(moveRoleModelCandidate([a, b, c], key(a), 'provider:absent:x', 'before')).toEqual([a, b, c])
    expect(moveRoleModelCandidate([a, b, c], '', key(b), 'after')).toEqual([a, b, c])
  })
})
