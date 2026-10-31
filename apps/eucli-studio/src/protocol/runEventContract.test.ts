import { describe, expect, it } from 'vitest'
import {
  isLifecycleRunEventType,
  isTerminalRunEventType,
  readRunEventEnvelope,
  readRunLifecycleSnapshot,
} from './runEventContract'

// 回归：运行身份契约。
//
// 现场故障：`model_output` / `tool_requested` 的载荷里带着消息 id、工具计划 id，
// 前端把载荷的 `id` 当成运行 id 建卡，真实终态按真 runId 销账时找不到卡，
// 于是停止按钮与尾部占位永久残留。
//
// 契约：运行身份只来自信封；载荷必须自证是本运行的状态快照才能合并。

const runId = 'run-1793460437472526500-17741'
const messageId = '01a192929b3001c78cc9db2263cbf862'
const planId = 'tool-plan-1793452072626493300-17230'

describe('运行事件信封契约', () => {
  it('运行身份只来自信封：载荷里的消息 id 不参与身份判定', () => {
    const envelope = readRunEventEnvelope({ type: 'model_output', runId, payload: { id: messageId } })
    expect(envelope).toEqual({ id: '', runId, type: 'model_output', payload: { id: messageId } })
  })

  it('没有 runId 的信封不构成运行事实', () => {
    expect(readRunEventEnvelope({ type: 'run_started', payload: { id: runId } })).toBeNull()
    expect(readRunEventEnvelope(null)).toBeNull()
  })

  it('生命周期与终态事件集合是唯一来源', () => {
    for (const type of ['run_started', 'run_retrying', 'run_completed', 'run_failed', 'run_cancelled', 'run_canceled']) {
      expect(isLifecycleRunEventType(type)).toBe(true)
    }
    for (const type of ['run_completed', 'run_failed', 'run_cancelled', 'run_canceled']) {
      expect(isTerminalRunEventType(type)).toBe(true)
    }
    // 内容事件永远没有运行生死权。
    for (const type of ['model_output', 'tool_requested', 'assistant_message_delta', 'assistant_message_update', 'tool_output_update', 'async_tool_task_update']) {
      expect(isLifecycleRunEventType(type)).toBe(false)
      expect(isTerminalRunEventType(type)).toBe(false)
    }
  })
})

describe('运行状态快照必须自证身份', () => {
  it('payload.id 等于信封 runId 时才认读', () => {
    const snapshot = readRunLifecycleSnapshot(runId, {
      id: runId,
      roleId: 'role-1',
      sessionId: 'chat-1',
      lastMessageId: 'm2',
      status: 'running',
      stream: true,
    })
    expect(snapshot).toMatchObject({ id: runId, roleId: 'role-1', sessionId: 'chat-1', lastMessageId: 'm2', status: 'running' })
  })

  it('消息 id 冒充运行 id 一律拒绝', () => {
    expect(readRunLifecycleSnapshot(runId, { id: messageId, status: 'running', roleId: 'role-1', sessionId: 'chat-1' })).toBeNull()
  })

  it('工具计划 id 冒充运行 id 一律拒绝', () => {
    expect(readRunLifecycleSnapshot(runId, { id: planId, status: 'running', roleId: 'role-1', sessionId: 'chat-1' })).toBeNull()
  })

  it('内容事件载荷没有运行状态，拒绝合并', () => {
    expect(readRunLifecycleSnapshot(runId, { runId, messageId: 'm2', contentDelta: 'x' })).toBeNull()
    expect(readRunLifecycleSnapshot(runId, { id: runId })).toBeNull()
  })
})
