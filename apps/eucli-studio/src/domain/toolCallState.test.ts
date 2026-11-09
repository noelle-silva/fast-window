import { describe, expect, it } from 'vitest'
import { toolCallPhase, toolResultStatusText, toolResultTone, toolStateText, toolStateTone } from './toolCallState'

describe('工具调用状态词表', () => {
  it('调用状态与结果状态各有中文文案', () => {
    expect(toolStateText('needs_confirmation')).toBe('等待确认')
    expect(toolStateText('completed')).toBe('已完成')
    expect(toolStateText('cancelled')).toBe('已取消')
    expect(toolStateText('', '未知状态')).toBe('未知状态')
    expect(toolResultStatusText('success')).toBe('成功')
    expect(toolResultStatusText('failed')).toBe('失败')
    expect(toolResultStatusText('weird')).toBe('weird')
  })

  it('色相位按失败、成功、等待确认、运行中归类', () => {
    expect(toolStateTone('error')).toBe('danger')
    expect(toolStateTone('completed')).toBe('success')
    expect(toolStateTone('needs_confirmation')).toBe('warning')
    expect(toolStateTone('requested')).toBe('')
    expect(toolResultTone('success')).toBe('success')
    expect(toolResultTone('failure')).toBe('danger')
  })
})

describe('工具调用状态圆相位', () => {
  it('没有结果时由调用状态决定', () => {
    expect(toolCallPhase({ state: 'running' })).toBe('running')
    expect(toolCallPhase({ state: 'requested' })).toBe('running')
    expect(toolCallPhase({ state: 'needs_confirmation' })).toBe('pending')
    expect(toolCallPhase({ state: 'completed' })).toBe('success')
    expect(toolCallPhase({ state: 'error' })).toBe('error')
    expect(toolCallPhase({ state: 'cancelled' })).toBe('error')
  })

  it('结果存在时结果事实优先', () => {
    expect(toolCallPhase({ state: 'running', result: { status: 'success' } })).toBe('success')
    expect(toolCallPhase({ state: 'completed', result: { status: 'failed' } })).toBe('error')
    expect(toolCallPhase({ state: 'needs_confirmation', result: { status: 'success' } })).toBe('success')
  })

  it('结果状态无法识别时退回调用状态', () => {
    expect(toolCallPhase({ state: 'completed', result: { status: 'odd' } })).toBe('success')
    expect(toolCallPhase({ state: 'needs_confirmation', result: { status: 'odd' } })).toBe('pending')
    expect(toolCallPhase({ state: 'running', result: { status: 'odd' } })).toBe('running')
  })
})
