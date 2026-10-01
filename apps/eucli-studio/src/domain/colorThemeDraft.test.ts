import { describe, expect, it } from 'vitest'
import {
  COLOR_THEME_BUILTIN_PRESETS,
  cloneColorThemeDraft,
  colorThemePresetsEqual,
  isColorThemePresetDirty,
  listColorThemePresets,
  materializeColorThemePreset,
  resolveColorThemePreview,
  uniqueColorThemePresetName,
  type ColorThemeDraft,
} from './colorTheme'

const BUILTIN = COLOR_THEME_BUILTIN_PRESETS[0]

function customPreset() {
  return {
    ...BUILTIN,
    id: 'imported-a',
    name: '自定 A',
    description: '测试用导入预设',
    colors: { ...BUILTIN.colors, primary: '#111111' },
  }
}

function baseSettings() {
  return { activePresetId: BUILTIN.id, importedPresets: [customPreset()] }
}

function idFactory() {
  let seq = 0
  return () => `generated-${(seq += 1)}`
}

describe('cloneColorThemeDraft', () => {
  it('copies presets deeply', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    expect(draft.activePresetId).toBe(BUILTIN.id)
    expect(draft.presets.length).toBe(COLOR_THEME_BUILTIN_PRESETS.length + 1)
    draft.presets[0].colors.primary = '#000000'
    expect(COLOR_THEME_BUILTIN_PRESETS[0].colors.primary).not.toBe('#000000')
  })
})

describe('isColorThemePresetDirty', () => {
  it('is clean for a fresh clone and for no draft', () => {
    expect(isColorThemePresetDirty(baseSettings(), null, BUILTIN.id)).toBe(false)
    expect(isColorThemePresetDirty(baseSettings(), cloneColorThemeDraft(baseSettings()), BUILTIN.id)).toBe(false)
  })

  it('detects edits per preset and ignores pure selection changes', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    draft.activePresetId = 'imported-a'
    expect(isColorThemePresetDirty(baseSettings(), draft, BUILTIN.id)).toBe(false)
    expect(isColorThemePresetDirty(baseSettings(), draft, 'imported-a')).toBe(false)

    draft.presets[0].colors.primary = '#000000'
    expect(isColorThemePresetDirty(baseSettings(), draft, BUILTIN.id)).toBe(true)
    expect(isColorThemePresetDirty(baseSettings(), draft, 'imported-a')).toBe(false)
  })

  it('treats draft-added presets as dirty', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    draft.presets.push({ ...customPreset(), id: 'draft-new', name: '新配色' })
    expect(isColorThemePresetDirty(baseSettings(), draft, 'draft-new')).toBe(true)
  })
})

describe('resolveColorThemePreview', () => {
  it('prefers the draft over persisted settings', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    draft.presets[0].colors.primary = '#010203'
    expect(resolveColorThemePreview(baseSettings(), draft).colors.primary).toBe('#010203')
    expect(resolveColorThemePreview(baseSettings(), null).colors.primary).toBe(BUILTIN.colors.primary)
  })
})

describe('materializeColorThemePreset', () => {
  it('returns null when the preset has no unsaved edits', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    expect(materializeColorThemePreset(baseSettings(), draft, BUILTIN.id, idFactory())).toBeNull()
  })

  it('turns an edited builtin preset into a copy while keeping the original', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    const builtin = draft.presets.find((preset) => preset.id === BUILTIN.id)!
    builtin.colors.primary = '#123456'

    const result = materializeColorThemePreset(baseSettings(), draft, BUILTIN.id, idFactory())!
    const all = listColorThemePresets(result.settings)
    expect(all.find((preset) => preset.id === BUILTIN.id)!.colors.primary).toBe(BUILTIN.colors.primary)

    const copy = all.find((preset) => preset.name === `${BUILTIN.name} 副本`)!
    expect(copy.colors.primary).toBe('#123456')
    expect(result.settings.activePresetId).toBe(copy.id)
    expect(isColorThemePresetDirty(result.settings, result.draft, BUILTIN.id)).toBe(false)
  })

  it('updates an edited imported preset in place without touching other presets', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    const imported = draft.presets.find((preset) => preset.id === 'imported-a')!
    imported.colors.primary = '#222222'
    imported.name = '自定 A 改'

    const result = materializeColorThemePreset(baseSettings(), draft, 'imported-a', idFactory())!
    const updated = listColorThemePresets(result.settings).find((preset) => preset.id === 'imported-a')!
    expect(updated.colors.primary).toBe('#222222')
    expect(updated.name).toBe('自定 A 改')
    expect(result.settings.activePresetId).toBe(BUILTIN.id)
    expect(isColorThemePresetDirty(result.settings, result.draft, 'imported-a')).toBe(false)
  })

  it('materializes a draft-added preset with a fresh id and activates it', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    draft.presets.push({ ...customPreset(), id: 'draft-1', name: '新配色' })
    draft.activePresetId = 'draft-1'

    const result = materializeColorThemePreset(baseSettings(), draft, 'draft-1', idFactory())!
    const added = listColorThemePresets(result.settings).find((preset) => preset.name === '新配色')!
    expect(added.id.startsWith('draft-')).toBe(false)
    expect(result.settings.activePresetId).toBe(added.id)
    expect(result.draft.activePresetId).toBe(added.id)
    expect(isColorThemePresetDirty(result.settings, result.draft, added.id)).toBe(false)
  })

  it('keeps other presets unsaved edits in the draft', () => {
    const draft = cloneColorThemeDraft(baseSettings())
    draft.presets.find((preset) => preset.id === BUILTIN.id)!.colors.primary = '#123456'
    draft.presets.find((preset) => preset.id === 'imported-a')!.colors.primary = '#654321'

    const result = materializeColorThemePreset(baseSettings(), draft, BUILTIN.id, idFactory())!
    expect(isColorThemePresetDirty(result.settings, result.draft, BUILTIN.id)).toBe(false)
    expect(isColorThemePresetDirty(result.settings, result.draft, 'imported-a')).toBe(true)
    expect(result.draft.presets.find((preset) => preset.id === 'imported-a')!.colors.primary).toBe('#654321')
  })

  it('keeps active preset when saving a non-active preset', () => {
    const settings = baseSettings()
    settings.activePresetId = 'imported-a'
    const draft = cloneColorThemeDraft(settings)
    draft.presets.find((preset) => preset.id === BUILTIN.id)!.colors.primary = '#123456'

    const result = materializeColorThemePreset(settings, draft, BUILTIN.id, idFactory())!
    expect(result.settings.activePresetId).toBe('imported-a')
  })

  it('names colliding copies uniquely', () => {
    const settings = baseSettings()
    settings.importedPresets.push({ ...customPreset(), id: 'imported-b', name: `${BUILTIN.name} 副本` })
    const draft = cloneColorThemeDraft(settings)
    draft.presets.find((preset) => preset.id === BUILTIN.id)!.colors.primary = '#123456'

    const result = materializeColorThemePreset(settings, draft, BUILTIN.id, idFactory())!
    const names = listColorThemePresets(result.settings).map((preset) => preset.name)
    expect(names).toContain(`${BUILTIN.name} 副本`)
    expect(names).toContain(`${BUILTIN.name} 副本 2`)
  })
})

describe('uniqueColorThemePresetName', () => {
  it('suffixes duplicated names', () => {
    expect(uniqueColorThemePresetName('新配色', new Set())).toBe('新配色')
    expect(uniqueColorThemePresetName('新配色', new Set(['新配色']))).toBe('新配色 2')
    expect(uniqueColorThemePresetName('新配色', new Set(['新配色', '新配色 2']))).toBe('新配色 3')
  })
})

describe('colorThemePresetsEqual', () => {
  it('compares identity fields and all colors', () => {
    const a = customPreset()
    const b: ColorThemeDraft['presets'][number] = JSON.parse(JSON.stringify(a))
    expect(colorThemePresetsEqual(a, b)).toBe(true)
    b.colors.border = '#000000'
    expect(colorThemePresetsEqual(a, b)).toBe(false)
  })
})
