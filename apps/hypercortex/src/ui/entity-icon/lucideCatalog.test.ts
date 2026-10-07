import { describe, expect, it } from 'vitest'
import { icons } from 'lucide-react'
import { AVAILABLE_LUCIDE_ICON_NAMES, getLucideIcon, pickRandomLucideIconName } from './lucideCatalog'

describe('lucideCatalog', () => {
  it('完整收录 lucide 图标库当前版本的全部图标', () => {
    expect(AVAILABLE_LUCIDE_ICON_NAMES.length).toBe(Object.keys(icons).length)
    expect(AVAILABLE_LUCIDE_ICON_NAMES.length).toBeGreaterThan(1000)
  })

  it('名单里的图标都在图标库中可用', () => {
    for (const name of AVAILABLE_LUCIDE_ICON_NAMES) {
      expect(getLucideIcon(name), name).toBeTruthy()
    }
  })

  it('getLucideIcon 大小写不敏感，未知名称返回空', () => {
    expect(getLucideIcon('star')).toBeTruthy()
    expect(getLucideIcon('Star')).toBeTruthy()
    expect(getLucideIcon('definitely-not-a-real-icon')).toBeUndefined()
  })

  it('随机图标始终落在可用名单内', () => {
    for (let i = 0; i < 20; i++) {
      expect(AVAILABLE_LUCIDE_ICON_NAMES).toContain(pickRandomLucideIconName())
    }
  })
})
