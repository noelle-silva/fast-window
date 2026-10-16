import { describe, expect, it } from 'vitest'
import { resolveSidebarLineX, resolveSidebarWidthFromLine } from './sidebarResize'
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from './uiMode'

describe('侧边栏宽度拖拽几何：竖线位置 ↔ 宽度', () => {
  it('左侧栏：宽度 = 竖线到左锚点的距离', () => {
    expect(resolveSidebarWidthFromLine('left', 0, 320)).toBe(320)
    expect(resolveSidebarWidthFromLine('left', 40, 300)).toBe(260)
  })

  it('右侧栏：宽度 = 右锚点到竖线的距离', () => {
    expect(resolveSidebarWidthFromLine('right', 900, 640)).toBe(260)
    expect(resolveSidebarWidthFromLine('right', 800, 500)).toBe(300)
  })

  it('宽度夹在最小值与最大值之间', () => {
    expect(resolveSidebarWidthFromLine('left', 0, 50)).toBe(SIDEBAR_WIDTH_MIN)
    expect(resolveSidebarWidthFromLine('left', 0, 9999)).toBe(SIDEBAR_WIDTH_MAX)
    expect(resolveSidebarWidthFromLine('right', 800, 799)).toBe(SIDEBAR_WIDTH_MIN)
    expect(resolveSidebarWidthFromLine('right', 800, -500)).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('宽度取整', () => {
    expect(resolveSidebarWidthFromLine('left', 0, 300.6)).toBe(301)
    expect(resolveSidebarWidthFromLine('left', 0, 300.4)).toBe(300)
  })

  it('宽度 → 竖线横坐标（起点与限位回填用）', () => {
    expect(resolveSidebarLineX('left', 0, 300)).toBe(300)
    expect(resolveSidebarLineX('right', 800, 300)).toBe(500)
  })

  it('竖线位置经宽度夹取后回填，得到限位后的竖线坐标', () => {
    const anchorX = 0
    const lineX = resolveSidebarLineX('left', anchorX, resolveSidebarWidthFromLine('left', anchorX, 9999))
    expect(lineX).toBe(SIDEBAR_WIDTH_MAX)
  })
})
