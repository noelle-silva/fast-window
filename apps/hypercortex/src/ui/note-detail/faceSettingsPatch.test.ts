import { describe, expect, it } from 'vitest'

import { applyFaceSettingsPatch, areFaceSettingsEqual } from './faceSettingsPatch'

describe('applyFaceSettingsPatch', () => {
  it('补丁合并保留未提及的键', () => {
    const next = applyFaceSettingsPatch({ layout: 'mindMap', theme: 'dark' }, { layout: 'fishbone' })
    expect(next).toEqual({ layout: 'fishbone', theme: 'dark' })
  })

  it('值为 null 表示删除该键', () => {
    const next = applyFaceSettingsPatch({ layout: 'mindMap', scale: 1 }, { scale: null })
    expect(next).toEqual({ layout: 'mindMap' })
  })

  it('不修改原对象', () => {
    const origin = { layout: 'mindMap' }
    applyFaceSettingsPatch(origin, { theme: 'dark' })
    expect(origin).toEqual({ layout: 'mindMap' })
  })
})

describe('areFaceSettingsEqual', () => {
  it('键序无关、值逐项比较', () => {
    expect(areFaceSettingsEqual({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true)
    expect(areFaceSettingsEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(areFaceSettingsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it('空与缺省视为相等', () => {
    expect(areFaceSettingsEqual(null, undefined)).toBe(true)
    expect(areFaceSettingsEqual({}, null)).toBe(true)
  })
})
