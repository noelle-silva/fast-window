import { describe, expect, it } from 'vitest'
import {
  entityIconDraftFrom,
  entityIconEqual,
  entityIconFromDraft,
  normalizeEntityIcon,
  type EntityIcon,
} from './entityIcon'

describe('normalizeEntityIcon', () => {
  it('解析图标库种类', () => {
    expect(normalizeEntityIcon({ kind: 'library', name: 'Star' })).toEqual({ kind: 'library', name: 'Star' })
  })

  it('解析图片种类并保留路径', () => {
    expect(normalizeEntityIcon({ kind: 'image', path: 'Icons/folder_a.png' })).toEqual({ kind: 'image', path: 'Icons/folder_a.png' })
  })

  it('解析 SVG 种类', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    expect(normalizeEntityIcon({ kind: 'svg', svg })).toEqual({ kind: 'svg', svg })
  })

  it('默认与非法取值都归为无自定义图标', () => {
    expect(normalizeEntityIcon({ kind: 'default' })).toBeUndefined()
    expect(normalizeEntityIcon(null)).toBeUndefined()
    expect(normalizeEntityIcon({ kind: 'library', name: '' })).toBeUndefined()
    expect(normalizeEntityIcon({ kind: 'image', path: '  ' })).toBeUndefined()
    expect(normalizeEntityIcon({ kind: 'unknown', name: 'x' })).toBeUndefined()
  })
})

describe('entityIconDraftFrom / entityIconFromDraft', () => {
  it('无图标草稿为 default', () => {
    expect(entityIconDraftFrom(undefined)).toEqual({ kind: 'default' })
  })

  it('图片草稿带 dataUrl 时不能直接转回图标（等待落盘）', () => {
    expect(entityIconFromDraft({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' })).toBeUndefined()
  })

  it('图片草稿带 path 时转回图标', () => {
    expect(entityIconFromDraft({ kind: 'image', path: 'Icons/asset_a.png' })).toEqual({ kind: 'image', path: 'Icons/asset_a.png' })
  })

  it('库图标往返一致', () => {
    const icon: EntityIcon = { kind: 'library', name: 'Heart' }
    expect(entityIconFromDraft(entityIconDraftFrom(icon))).toEqual(icon)
  })
})

describe('entityIconEqual', () => {
  it('按种类与取值比较', () => {
    expect(entityIconEqual({ kind: 'library', name: 'Star' }, { kind: 'library', name: 'Star' })).toBe(true)
    expect(entityIconEqual({ kind: 'library', name: 'Star' }, { kind: 'library', name: 'Heart' })).toBe(false)
    expect(entityIconEqual(undefined, undefined)).toBe(true)
    expect(entityIconEqual({ kind: 'image', path: 'a' }, undefined)).toBe(false)
    expect(entityIconEqual({ kind: 'svg', svg: '<svg/>' }, { kind: 'svg', svg: '<svg/>' })).toBe(true)
  })
})
