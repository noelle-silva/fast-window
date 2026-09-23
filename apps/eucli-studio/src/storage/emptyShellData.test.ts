import { describe, expect, it } from 'vitest'
import { createEmptyShellData } from './splitStorage'

describe('createEmptyShellData', () => {
  it('提供会话界面可用的空外壳数据形状', () => {
    const data = createEmptyShellData()

    expect(data.roles).toEqual([])
    expect(data.groups).toEqual([])
    expect(data.workspaces).toEqual([])
    expect(data.chatsByRole).toEqual({})
    expect(data.chatsByGroup).toEqual({})
    expect(data.chatsByWorkspace).toEqual({})
    expect(data.settings.providers).toEqual([])
    expect(data.settings.stickers).toMatchObject({ enabled: false, categories: [], map: {} })
    expect(data.favorites).toEqual({ folders: [], chatRefsByFolderId: {} })
    expect(data.ui.activeRoleId).toBe('')
    expect(data.ui.activeTargetKind).toBe('role')
  })
})
