import { describe, expect, it } from 'vitest'
import { isToolPartRunning, toolLiveElapsedMs, toolRunAnchorMs } from './toolRunTiming'

describe('isToolPartRunning', () => {
  it('only treats the running state as live execution', () => {
    expect(isToolPartRunning({ state: 'running' })).toBe(true)
    expect(isToolPartRunning({ state: ' running ' })).toBe(true)
    expect(isToolPartRunning({ state: 'needs_confirmation' })).toBe(false)
    expect(isToolPartRunning({ state: 'completed' })).toBe(false)
    expect(isToolPartRunning(undefined)).toBe(false)
  })
})

describe('toolRunAnchorMs', () => {
  it('anchors a running tool at its latest state transition', () => {
    expect(toolRunAnchorMs({ state: 'running', createdAt: 1000, updatedAt: 5000 })).toBe(5000)
  })

  it('falls back to the creation time when the transition time is missing', () => {
    expect(toolRunAnchorMs({ state: 'running', createdAt: 4200 })).toBe(4200)
  })

  it('reports no anchor for tools that are not running or lack timestamps', () => {
    expect(toolRunAnchorMs({ state: 'completed', updatedAt: 5000 })).toBe(0)
    expect(toolRunAnchorMs({ state: 'running' })).toBe(0)
    expect(toolRunAnchorMs(undefined)).toBe(0)
  })
})

describe('toolLiveElapsedMs', () => {
  it('converts a wall-clock instant into live elapsed time', () => {
    expect(toolLiveElapsedMs({ state: 'running', updatedAt: 5000 }, 8123)).toBe(3123)
  })

  it('never reports negative elapsed time when clocks disagree', () => {
    expect(toolLiveElapsedMs({ state: 'running', updatedAt: 5000 }, 4000)).toBe(0)
    expect(toolLiveElapsedMs({ state: 'running', updatedAt: 5000 }, 0)).toBe(0)
  })

  it('reports nothing once the tool is no longer running', () => {
    expect(toolLiveElapsedMs({ state: 'completed', updatedAt: 5000 }, 9000)).toBe(0)
  })
})
