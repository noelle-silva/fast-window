import { describe, expect, it } from 'vitest'
import {
  PROJECTION_ASSIST_SETTING_KEYS,
  PROJECTION_DERIVED_SETTING_KEYS,
  PROJECTION_DEDICATED_SETTING_KEYS,
  projectionOwnedSettings,
  stripProjectionAssistSettings,
} from './projectionSettings'

function settingsFixture() {
  const aiServices: Record<string, any> = { localOnly: { enabled: true } }
  for (const key of PROJECTION_ASSIST_SETTING_KEYS) aiServices[key] = { enabled: true }
  return {
    providers: [{ id: 'p1' }],
    stickers: { enabled: true },
    aiServices,
    wallpaper: { activeId: 'w1' },
    chatFontSize: 16,
    branchTree: { dir: 'lr' },
  }
}

describe('projectionOwnedSettings', () => {
  it('剥离派生 / 专用 / assist 字段，保留其余客户端偏好', () => {
    const owned = projectionOwnedSettings(settingsFixture())

    for (const key of PROJECTION_DERIVED_SETTING_KEYS) expect(owned[key]).toBeUndefined()
    for (const key of PROJECTION_DEDICATED_SETTING_KEYS) expect(owned[key]).toBeUndefined()
    for (const key of PROJECTION_ASSIST_SETTING_KEYS) expect(owned.aiServices?.[key]).toBeUndefined()

    expect(owned.aiServices.localOnly).toEqual({ enabled: true })
    expect(owned.wallpaper).toEqual({ activeId: 'w1' })
    expect(owned.chatFontSize).toBe(16)
    expect(owned.branchTree).toEqual({ dir: 'lr' })
  })

  it('不修改入参', () => {
    const source = settingsFixture()
    projectionOwnedSettings(source)

    expect(source.providers).toEqual([{ id: 'p1' }])
    expect(source.stickers).toEqual({ enabled: true })
    for (const key of PROJECTION_ASSIST_SETTING_KEYS) expect(source.aiServices[key]).toEqual({ enabled: true })
  })
})

describe('stripProjectionAssistSettings', () => {
  it('只剥离 assist 子键，保留同一 aiServices 下的其它本地键', () => {
    const stripped = stripProjectionAssistSettings(settingsFixture())

    for (const key of PROJECTION_ASSIST_SETTING_KEYS) expect(stripped.aiServices?.[key]).toBeUndefined()
    expect(stripped.aiServices.localOnly).toEqual({ enabled: true })
    expect(stripped.providers).toBeDefined()
    expect(stripped.stickers).toBeDefined()
  })

  it('aiServices 缺失或不是对象时原样返回', () => {
    expect(stripProjectionAssistSettings({ streamEnabled: true })).toEqual({ streamEnabled: true })
    expect(stripProjectionAssistSettings({ aiServices: [] })).toEqual({ aiServices: [] })
  })
})
