import { describe, expect, it } from 'vitest'
import { roleMatchesWrite } from './roleEntity'
import { workspaceMatchesWrite } from './workspaceEntity'

// 描述是给人看的备注：它不进提示词，但确实是实体写入事实的一部分。
// 回读对账必须把它算进去，否则「描述没写进去」会被误判为写入成功。
describe('描述字段参与实体写入对账', () => {
  it('角色：描述不同即不算写完，首尾空白差异不算差异', () => {
    const intended = {
      id: 'role-1',
      name: '文案角色',
      systemPrompt: '你负责改文案',
      temperature: 1,
      temperatureEnabled: false,
      modelCandidates: [],
      defaultModelCandidateId: '',
      toolPolicy: {},
      description: '专门改文案',
    }

    expect(roleMatchesWrite({ ...intended, description: ' 专门改文案 ' }, intended)).toBe(true)
    expect(roleMatchesWrite({ ...intended, description: '专门写代码' }, intended)).toBe(false)
    expect(roleMatchesWrite({ ...intended, description: '' }, intended)).toBe(false)
  })

  it('工作区：描述不同即不算写完，首尾空白差异不算差异', () => {
    const intended = {
      id: 'workspace-1',
      name: '重构工作区',
      description: '临时重构项目\n搞完就删',
      prompt: '遵守项目约定',
      directories: [],
      registeredRoleIds: [],
    }

    expect(workspaceMatchesWrite({ ...intended, description: ' 临时重构项目\n搞完就删 ' }, intended)).toBe(true)
    expect(workspaceMatchesWrite({ ...intended, description: '临时重构项目' }, intended)).toBe(false)
    expect(workspaceMatchesWrite({ ...intended, description: '' }, intended)).toBe(false)
  })
})
