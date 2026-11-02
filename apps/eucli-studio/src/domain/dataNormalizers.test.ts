import { describe, expect, it } from 'vitest'
import { VERSION } from './constants'
import { normalizeData } from './dataNormalizers'

function normalizeWithSettings(settings: Record<string, any>) {
  return normalizeData({
    version: VERSION,
    settings,
    favorites: {},
    roles: [],
    chatsByRole: {},
    groups: [],
    chatsByGroup: {},
    workspaces: [],
    chatsByWorkspace: {},
    ui: {},
  })
}

describe('normalizeData · 表情包 map 排序真值', () => {
  it('重建 map 时保留 order；缺失 order 时维持旧形状', () => {
    const data = normalizeWithSettings({
      stickers: {
        enabled: true,
        categories: ['表情'],
        map: {
          表情: {
            b: { relPath: 'stickers/表情/b.png', order: 2, createdAt: 1, updatedAt: 2 },
            a: { relPath: 'stickers/表情/a.png', order: 1, createdAt: 3, updatedAt: 4 },
            z: { relPath: 'stickers/表情/z.png', createdAt: 5, updatedAt: 6 },
          },
        },
      },
    })

    const box = data.settings.stickers.map['表情']
    expect(box.b.order).toBe(2)
    expect(box.a.order).toBe(1)
    expect('order' in box.z).toBe(false)
  })
})

describe('normalizeData · 分支树默认值', () => {
  it('缺失时采用与后端一致的 view=float', () => {
    const data = normalizeWithSettings({})

    expect(data.settings.branchTree).toEqual({
      dir: 'lr',
      view: 'float',
      followSelected: true,
      modalHotkey: '',
    })
  })

  it('保留已存合法值', () => {
    const data = normalizeWithSettings({ branchTree: { dir: 'tb', view: 'right', followSelected: false, modalHotkey: 'F2' } })

    expect(data.settings.branchTree).toEqual({
      dir: 'tb',
      view: 'right',
      followSelected: false,
      modalHotkey: 'F2',
    })
  })
})

describe('normalizeData · 透明聊天背景派生', () => {
  const preset = { id: 'w1', relPath: 'wallpapers/w1.webp', view: { x: 50, y: 50, scale: 1 } }

  it('由 wallpaper.enabled 派生出 true', () => {
    const data = normalizeWithSettings({ wallpaper: { enabled: true, activeId: 'w1', presets: [preset] } })

    expect(data.settings.transparentChatBg).toBe(true)
  })

  it('壁纸关闭时派生为 false，不再保留反向双写残留', () => {
    const data = normalizeWithSettings({
      transparentChatBg: true,
      wallpaper: { enabled: false, activeId: 'w1', presets: [preset] },
    })

    expect(data.settings.transparentChatBg).toBe(false)
  })
})
