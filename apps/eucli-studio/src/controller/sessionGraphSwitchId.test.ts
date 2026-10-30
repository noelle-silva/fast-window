// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 架构约定守卫：正文/结构读取必须把 switchId 一路带到 box。
//
// 背景：P0 的三跳 trace（前端 → studio → box）依赖同一个 switchId。
// 如果某条读取路径漏传，studio 会为它另生成 trace，日志无法归因到同一次切换。
// 这里用源码扫描锁住三个读取入口的调用点，防止以后新增路径时再次漏传。
const CONTROLLER_SOURCE = readFileSync(new URL('./createControllerV2.ts', import.meta.url), 'utf8')

describe('正文加载链路的 switchId 传递', () => {
  it('sessionGraph 调用点必须传 switchId', () => {
    const calls = CONTROLLER_SOURCE.match(/sessionSwitch\.sessionGraph\([^)]*\)/g) || []
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call).toMatch(/switchId/)
    }
  })

  it('loadSessionGraph 从 currentSwitchSpan 取 switchId，而不是另造一个', () => {
    const start = CONTROLLER_SOURCE.indexOf('async function loadSessionGraph')
    expect(start).toBeGreaterThanOrEqual(0)
    const body = CONTROLLER_SOURCE.slice(start, start + 800)
    expect(body).toContain('currentSwitchSpan()')
  })
})
