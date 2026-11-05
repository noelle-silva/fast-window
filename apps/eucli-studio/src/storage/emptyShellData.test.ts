import { describe, expect, it, vi } from 'vitest'
import { CLIENT_PREFERENCES_KEY } from '../domain/constants'
import { createEmptyShellData, createEmptyShellDataFromStorage, createFactoryClientData } from './splitStorage'

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

  it('显式恢复默认只重置客户端偏好，不丢业务派生视图与业务数据', () => {
    const providers = [{ id: 'p1', name: '供应商' }]
    const stickers = { enabled: true, categories: ['默认'], map: { 默认: {} } }
    const aiServices = { mermaidFix: { enabled: true }, localOnly: { enabled: true } }
    const roles = [{ id: 'role-1', name: '角色一' }]
    const current = {
      roles,
      ui: { sidebarWidth: 421, activeRoleId: 'role-1', activeTargetKind: 'role' },
      settings: {
        providers,
        stickers,
        aiServices,
        chatFontSize: 19,
        wallpaper: { enabled: true, activeId: 'w1', presets: [{ id: 'w1' }] },
        colorTheme: { activePresetId: 'sakura-night', importedPresets: [{ id: 'mine' }] },
      },
    }

    const factory = createFactoryClientData(current)

    expect(factory.roles).toBe(roles)
    expect(factory.settings.providers).toBe(providers)
    expect(factory.settings.stickers).toBe(stickers)
    expect(factory.settings.aiServices.mermaidFix).toEqual({ enabled: true })
    expect(factory.settings.aiServices.localOnly).toBeUndefined()
    expect(factory.settings.chatFontSize).toBe(createEmptyShellData().settings.chatFontSize)
    expect(factory.settings.wallpaper.presets).toEqual([])
    expect(factory.settings.colorTheme.activePresetId).toBe(createEmptyShellData().settings.colorTheme.activePresetId)
    expect(factory.ui.activeRoleId).toBe('')
  })
})
