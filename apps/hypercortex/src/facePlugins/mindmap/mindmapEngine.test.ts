// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

/**
 * 行为锁定（096 · 思维导图面）：
 * 引擎装配必须把本面所需的插件（节点拖拽 Drag、左键框选 Select、思维导图布局 MindMapLayoutPro）
 * 注册进导图库；缺注册会让对应能力整体缺失，且不会报错——必须在装配期锁死。
 */

const mocks = vi.hoisted(() => ({
  usePlugin: vi.fn(),
  dragPlugin: { plugin: 'drag' },
  selectPlugin: { plugin: 'select' },
  layoutProPlugin: { plugin: 'mindmap-layout-pro' },
}))

vi.mock('simple-mind-map', () => ({ default: { usePlugin: mocks.usePlugin } }))
vi.mock('simple-mind-map/src/plugins/Drag.js', () => ({ default: mocks.dragPlugin }))
vi.mock('simple-mind-map/src/plugins/Select.js', () => ({ default: mocks.selectPlugin }))
vi.mock('simple-mind-map/src/plugins/MindMapLayoutPro.js', () => ({ default: mocks.layoutProPlugin }))

import './mindmapEngine'

describe('mindmapEngine 装配', () => {
  it('注册节点拖拽、左键框选与思维导图布局插件', () => {
    expect(mocks.usePlugin).toHaveBeenCalledWith(mocks.dragPlugin)
    expect(mocks.usePlugin).toHaveBeenCalledWith(mocks.selectPlugin)
    expect(mocks.usePlugin).toHaveBeenCalledWith(mocks.layoutProPlugin)
  })
})
