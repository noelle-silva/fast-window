import { describe, expect, it } from 'vitest'
import {
  COMPOSER_TOOL_IDS,
  COMPOSER_TOOLS_DEFAULT_LAYOUT,
  applyComposerToolPlacement,
  composerToolArea,
  composerToolMeta,
  isComposerToolId,
  moveComposerToolWithinArea,
  normalizeComposerToolsLayout,
} from './composerToolsLayout'

describe('normalizeComposerToolsLayout', () => {
  it('returns the default layout for missing or invalid values', () => {
    expect(normalizeComposerToolsLayout(undefined)).toEqual(COMPOSER_TOOLS_DEFAULT_LAYOUT)
    expect(normalizeComposerToolsLayout(null)).toEqual(COMPOSER_TOOLS_DEFAULT_LAYOUT)
    expect(normalizeComposerToolsLayout('weird')).toEqual(COMPOSER_TOOLS_DEFAULT_LAYOUT)
  })

  it('keeps the user order and drops unknown ids', () => {
    const layout = normalizeComposerToolsLayout({
      inline: ['stream-toggle', 'unknown-button', 'image-picker'],
      menu: ['clean-reasoning'],
    })
    expect(layout.inline.slice(0, 2)).toEqual(['stream-toggle', 'image-picker'])
    expect(layout.menu).toContain('clean-reasoning')
    expect(layout.inline).not.toContain('unknown-button' as any)
  })

  it('deduplicates and gives inline priority over menu', () => {
    const layout = normalizeComposerToolsLayout({
      inline: ['image-picker', 'image-picker'],
      menu: ['image-picker', 'clean-reasoning'],
    })
    expect(layout.inline.filter((id) => id === 'image-picker')).toHaveLength(1)
    // 菜单首项仍是用户写的项；缺失的已知按钮按默认区域补在它后面。
    expect(layout.menu[0]).toBe('clean-reasoning')
    expect(layout.menu).not.toContain('image-picker')
  })

  it('puts every known button back exactly once', () => {
    const layout = normalizeComposerToolsLayout({ inline: ['image-picker'], menu: [] })
    const all = [...layout.inline, ...layout.menu]
    expect(all).toHaveLength(COMPOSER_TOOL_IDS.length)
    expect(new Set(all).size).toBe(COMPOSER_TOOL_IDS.length)
  })

  it('restores a missing button into the area of the default layout', () => {
    const layout = normalizeComposerToolsLayout({ inline: ['image-picker'], menu: [] })
    expect(layout.menu).toContain('clean-reasoning')
    expect(layout.inline).toContain('stream-toggle')
  })

  it('ships the prompt library and task entries inside the menu by default', () => {
    expect(COMPOSER_TOOLS_DEFAULT_LAYOUT.menu).toEqual([
      'clean-reasoning',
      'global-prompts',
      'role-prompts',
      'workspace-prompts',
      'task-tree-role',
      'task-tree-workspace',
    ])
  })

  it('restores the prompt library and task entries into the menu for older layouts', () => {
    const layout = normalizeComposerToolsLayout({
      inline: COMPOSER_TOOLS_DEFAULT_LAYOUT.inline,
      menu: ['clean-reasoning'],
    })

    expect(layout.menu).toEqual([
      'clean-reasoning',
      'global-prompts',
      'role-prompts',
      'workspace-prompts',
      'task-tree-role',
      'task-tree-workspace',
    ])
    expect(layout.inline).not.toContain('global-prompts')
  })
})

describe('composerToolArea', () => {
  it('reports the area that owns the button', () => {
    const layout = normalizeComposerToolsLayout({
      inline: ['image-picker'],
      menu: ['clean-reasoning'],
    })
    expect(composerToolArea(layout, 'image-picker')).toBe('inline')
    expect(composerToolArea(layout, 'clean-reasoning')).toBe('menu')
  })
})

describe('applyComposerToolPlacement', () => {
  it('moves a button out of the toolbar to the end of the menu', () => {
    const layout = normalizeComposerToolsLayout({
      inline: ['image-picker', 'stream-toggle'],
      menu: ['clean-reasoning'],
    })
    const next = applyComposerToolPlacement(layout, 'image-picker', false)
    expect(next.inline).not.toContain('image-picker')
    expect(next.menu[next.menu.length - 1]).toBe('image-picker')
  })

  it('moves a button back to the end of the toolbar', () => {
    const layout = normalizeComposerToolsLayout({
      inline: ['image-picker'],
      menu: ['clean-reasoning', 'stream-toggle'],
    })
    const next = applyComposerToolPlacement(layout, 'stream-toggle', true)
    expect(next.menu).not.toContain('stream-toggle')
    expect(next.inline[next.inline.length - 1]).toBe('stream-toggle')
  })

  it('returns the same layout when the button already sits in the target area', () => {
    const layout = normalizeComposerToolsLayout(undefined)
    expect(applyComposerToolPlacement(layout, 'image-picker', true)).toEqual(layout)
    expect(applyComposerToolPlacement(layout, 'clean-reasoning', false)).toEqual(layout)
  })

  it('ignores unknown ids', () => {
    const layout = normalizeComposerToolsLayout(undefined)
    expect(applyComposerToolPlacement(layout, 'nope', true)).toEqual(layout)
  })
})

describe('moveComposerToolWithinArea', () => {
  it('reorders inside the toolbar area only', () => {
    const layout = normalizeComposerToolsLayout({
      inline: ['image-picker', 'hook-prompt', 'model-switch'],
      menu: ['clean-reasoning'],
    })
    const next = moveComposerToolWithinArea(layout, 'model-switch', 'image-picker')
    expect(next.inline.slice(0, 3)).toEqual(['model-switch', 'image-picker', 'hook-prompt'])
    expect(next.menu).toEqual(layout.menu)
  })

  it('reorders inside the menu area only', () => {
    const layout = normalizeComposerToolsLayout({
      inline: ['image-picker'],
      menu: ['clean-reasoning', 'stream-toggle'],
    })
    const next = moveComposerToolWithinArea(layout, 'stream-toggle', 'clean-reasoning')
    expect(next.menu.slice(0, 2)).toEqual(['stream-toggle', 'clean-reasoning'])
    expect(next.inline[0]).toBe('image-picker')
  })

  it('refuses cross-area moves and unknown ids', () => {
    const layout = normalizeComposerToolsLayout({ inline: ['image-picker'], menu: ['clean-reasoning'] })
    expect(moveComposerToolWithinArea(layout, 'image-picker', 'clean-reasoning')).toEqual(layout)
    expect(moveComposerToolWithinArea(layout, 'image-picker', 'nope')).toEqual(layout)
    expect(moveComposerToolWithinArea(layout, 'image-picker', 'image-picker')).toEqual(layout)
  })
})

describe('composer tool registry helpers', () => {
  it('whitelists only registered ids', () => {
    expect(isComposerToolId('image-picker')).toBe(true)
    expect(isComposerToolId('image-picker ')).toBe(false)
    expect(isComposerToolId(undefined)).toBe(false)
  })

  it('describes every registered button', () => {
    for (const id of COMPOSER_TOOL_IDS) {
      const meta = composerToolMeta(id)
      expect(meta.id).toBe(id)
      expect(meta.name.length).toBeGreaterThan(0)
      expect(meta.description.length).toBeGreaterThan(0)
    }
  })
})
