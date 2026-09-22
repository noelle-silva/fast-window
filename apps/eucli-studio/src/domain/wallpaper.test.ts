import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WALLPAPER_VIEW,
  isWallpaperRelPath,
  normalizeWallpaperSettings,
  normalizeWallpaperView,
  wallpaperVeilAlpha,
} from './wallpaper'

const preset = (id: string, relPath = `wallpapers/${id}.webp`, view: any = undefined) => ({ id, relPath, view })

describe('isWallpaperRelPath', () => {
  it('接受壁纸目录下的合法文件', () => {
    expect(isWallpaperRelPath('wallpapers/abc_123.webp')).toBe(true)
    expect(isWallpaperRelPath('wallpapers/x.png')).toBe(true)
  })

  it('拒绝越级、非法标识与非法扩展名', () => {
    expect(isWallpaperRelPath('wallpapers/../x.png')).toBe(false)
    expect(isWallpaperRelPath('wallpapers/sub/x.png')).toBe(false)
    expect(isWallpaperRelPath('roles/r/avatar.png')).toBe(false)
    expect(isWallpaperRelPath('wallpapers/x.exe')).toBe(false)
    expect(isWallpaperRelPath('wallpapers/壁纸.png')).toBe(false)
  })
})

describe('wallpaperVeilAlpha', () => {
  it('透明度决定白纱浓度，磨砂开启时保留最小可见度', () => {
    expect(wallpaperVeilAlpha(40, 0)).toBeCloseTo(0.4)
    expect(wallpaperVeilAlpha(0, 12)).toBeCloseTo(0.01)
    expect(wallpaperVeilAlpha(0, 0)).toBe(0)
    expect(wallpaperVeilAlpha(180, 99)).toBe(1)
  })
})

describe('normalizeWallpaperView', () => {
  it('缺省时回落到默认取景', () => {
    expect(normalizeWallpaperView(undefined)).toEqual(DEFAULT_WALLPAPER_VIEW)
  })

  it('焦点与缩放夹取到合法范围', () => {
    expect(normalizeWallpaperView({ x: -10, y: 240, scale: 9 })).toEqual({ x: 0, y: 100, scale: 4 })
    expect(normalizeWallpaperView({ x: 30, y: 60, scale: 0.2 })).toEqual({ x: 30, y: 60, scale: 1 })
  })
})

describe('normalizeWallpaperSettings', () => {
  it('无数据时给出空设置', () => {
    expect(normalizeWallpaperSettings(undefined)).toEqual({ enabled: false, activeId: '', presets: [] })
  })

  it('过滤非法预设并去重', () => {
    const settings = normalizeWallpaperSettings({
      enabled: true,
      activeId: 'b',
      presets: [preset('a'), preset('a'), preset('bad id'), { id: 'c', relPath: 'roles/c.png' }, preset('b')],
    })
    expect(settings.presets.map((item) => item.id)).toEqual(['a', 'b'])
    expect(settings.activeId).toBe('b')
    expect(settings.enabled).toBe(true)
  })

  it('当前项失效时回落到第一个预设', () => {
    const settings = normalizeWallpaperSettings({ enabled: true, activeId: 'missing', presets: [preset('a'), preset('b')] })
    expect(settings.activeId).toBe('a')
  })

  it('没有预设时不保持启用状态', () => {
    expect(normalizeWallpaperSettings({ enabled: true, activeId: 'a', presets: [] })).toEqual({
      enabled: false,
      activeId: '',
      presets: [],
    })
  })

  it('预设取景会被归一化', () => {
    const settings = normalizeWallpaperSettings({
      enabled: true,
      activeId: 'a',
      presets: [preset('a', 'wallpapers/a.webp', { x: 999, y: -5, scale: 2.5 })],
    })
    expect(settings.presets[0].view).toEqual({ x: 100, y: 0, scale: 2.5 })
  })
})
