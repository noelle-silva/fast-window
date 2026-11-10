import { describe, expect, it } from 'vitest'
import { sessionSourceLabel, type SessionSource } from './sessionSourceLabel'

describe('会话来源标签', () => {
  function source(overrides: Partial<SessionSource> = {}): SessionSource {
    return { targetKind: 'role', targetName: '甲角色', roleName: '', ...overrides }
  }

  it('角色来源只显示角色名', () => {
    expect(sessionSourceLabel(source())).toBe('甲角色')
  })

  it('工作区来源显示「工作区名/角色名」', () => {
    expect(sessionSourceLabel(source({ targetKind: 'workspace', targetName: '工作区一', roleName: '乙角色' }))).toBe(
      '工作区一/乙角色',
    )
  })

  it('工作区来源缺角色名时退回工作区名', () => {
    expect(sessionSourceLabel(source({ targetKind: 'workspace', targetName: '工作区一' }))).toBe('工作区一')
  })

  it('群聊来源只显示群名', () => {
    expect(sessionSourceLabel(source({ targetKind: 'group', targetName: '甲群', roleName: '' }))).toBe('甲群')
  })

  it('名字两端空白不进标签，空角色名不算有效来源', () => {
    expect(sessionSourceLabel(source({ targetKind: 'workspace', targetName: ' 工作区一 ', roleName: '  ' }))).toBe('工作区一')
  })
})
