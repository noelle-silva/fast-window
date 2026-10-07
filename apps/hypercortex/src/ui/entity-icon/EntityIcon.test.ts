import { describe, expect, it } from 'vitest'
import { entityIconBoxSx } from './EntityIcon'

// 回归守护：图标外框必须按 size 固定占位，不得使用 width/height:100%。
// 一旦回到 100%，行内布局会被图标吞掉，文字标签消失、图标被推到居中。
describe('entityIconBoxSx', () => {
  it('按给定尺寸固定占位，不使用 100%', () => {
    const sx = entityIconBoxSx(18)
    expect(sx.width).toBe(18)
    expect(sx.height).toBe(18)
    expect(sx.width).not.toBe('100%')
    expect(sx.height).not.toBe('100%')
    expect(sx.display).toBe('inline-flex')
    expect(sx.flexShrink).toBe(0)
  })

  it('允许调用方覆盖尺寸', () => {
    const sx = entityIconBoxSx(18, { width: 16, height: 16 })
    expect(sx.width).toBe(16)
    expect(sx.height).toBe(16)
  })
})
