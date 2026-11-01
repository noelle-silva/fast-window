import { describe, expect, it } from 'vitest'
import { FACT_SOURCES, factSourceRank, pickFactCandidate, type FactCandidate } from './factPrecedence'

describe('factPrecedence', () => {
  it('来源顺序固定为 用户意图 > 运行期临时态 > 服务端事实 > 本地投影', () => {
    expect(FACT_SOURCES).toEqual(['user-intent', 'runtime-transient', 'server-fact', 'local-projection'])
    expect(factSourceRank('user-intent')).toBeGreaterThan(factSourceRank('runtime-transient'))
    expect(factSourceRank('runtime-transient')).toBeGreaterThan(factSourceRank('server-fact'))
    expect(factSourceRank('server-fact')).toBeGreaterThan(factSourceRank('local-projection'))
  })

  it('取来源等级最高的候选，跳过不可用值', () => {
    const candidates: FactCandidate<string>[] = [
      { source: 'local-projection', value: 'local' },
      { source: 'server-fact', value: 'server' },
      { source: 'runtime-transient', value: 'runtime' },
      { source: 'user-intent', value: 'user' },
    ]
    expect(pickFactCandidate(candidates, () => true)?.value).toBe('user')
    expect(pickFactCandidate(candidates, (value) => value !== 'user')?.value).toBe('runtime')
    expect(pickFactCandidate(candidates, (value) => value === 'server')?.value).toBe('server')
  })

  it('同来源时先到者胜出，不依赖排序稳定性', () => {
    const candidates: FactCandidate<string>[] = [
      { source: 'server-fact', value: 'first' },
      { source: 'server-fact', value: 'second' },
    ]
    expect(pickFactCandidate(candidates)?.value).toBe('first')
  })

  it('没有可用候选时返回 null', () => {
    expect(pickFactCandidate([{ source: 'user-intent', value: '' }], (value) => !!value)).toBeNull()
    expect(pickFactCandidate([])).toBeNull()
  })
})
