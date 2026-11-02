import { describe, expect, it, vi } from 'vitest'
import { CLIENT_PREFERENCES_KEY } from '../domain/constants'
import { createEmptyShellData, createEmptyShellDataFromStorage } from './splitStorage'

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

  it('未连接业务端时仍可恢复客户端偏好', async () => {
    const storage = {
      get: vi.fn(async (key: string) =>
        key === CLIENT_PREFERENCES_KEY
          ? {
              ui: { sidebarWidth: 321 },
              settings: { chatFontSize: 19, branchTree: { dir: 'tb' } },
            }
          : null,
      ),
    }

    const data = await createEmptyShellDataFromStorage(storage)
    expect(data.ui.sidebarWidth).toBe(321)
    expect(data.settings.chatFontSize).toBe(19)
    expect(data.settings.branchTree.dir).toBe('tb')
    // 业务数据仍为空外壳。
    expect(data.roles).toEqual([])
    expect(data.settings.providers).toEqual([])
  })
})
