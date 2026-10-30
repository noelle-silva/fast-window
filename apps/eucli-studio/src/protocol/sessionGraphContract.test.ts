import { describe, expect, it } from 'vitest'
import {
  SESSION_GRAPH_SCHEMA_VERSION,
  SessionGraphContractError,
  activePathIds,
  graphAsMessages,
  normalizeSessionGraph,
} from './sessionGraphContract'

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    parentId: '',
    branchId: 'main',
    createdAt: 1,
    role: 'user',
    text: 'hi',
    kind: 'message',
    ...overrides,
  }
}

function graph(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SESSION_GRAPH_SCHEMA_VERSION,
    chatId: 'chat-1',
    head: 'm2',
    nodes: [
      node({ id: 'm1', parentId: '', createdAt: 1, role: 'user' }),
      node({ id: 'm2', parentId: 'm1', createdAt: 2, role: 'assistant' }),
    ],
    ...overrides,
  }
}

describe('sessionGraphContract', () => {
  it('accepts a well-formed graph', () => {
    const normalized = normalizeSessionGraph(graph())
    expect(normalized.chatId).toBe('chat-1')
    expect(normalized.nodes).toHaveLength(2)
    expect(normalized.head).toBe('m2')
  })

  it('rejects an unsupported schemaVersion', () => {
    expect(() => normalizeSessionGraph(graph({ schemaVersion: 99 }))).toThrow(SessionGraphContractError)
  })

  it('rejects a missing nodes array', () => {
    expect(() => normalizeSessionGraph({ schemaVersion: SESSION_GRAPH_SCHEMA_VERSION })).toThrow(/nodes/)
  })

  // graph 只承载结构：正文出现即契约违约（那是 window / get 的职责）。
  it('rejects nodes carrying message content', () => {
    expect(() => normalizeSessionGraph(graph({
      nodes: [node({ id: 'm1', content: '正文' })],
    }))).toThrow(/不得携带消息正文/)
  })

  it('rejects nodes carrying parts', () => {
    expect(() => normalizeSessionGraph(graph({
      nodes: [node({ id: 'm1', parts: [{ type: 'text', text: 'x' }] })],
    }))).toThrow(/不得携带消息正文/)
  })

  it('rejects duplicate node ids', () => {
    expect(() => normalizeSessionGraph(graph({
      nodes: [node({ id: 'm1', createdAt: 1 }), node({ id: 'm1', createdAt: 2 })],
    }))).toThrow(/重复/)
  })

  it('rejects out-of-order nodes', () => {
    expect(() => normalizeSessionGraph(graph({
      nodes: [node({ id: 'm2', createdAt: 9 }), node({ id: 'm1', createdAt: 1 })],
    }))).toThrow(/升序/)
  })

  it('accepts a parent outside the node set (cross-window boundary)', () => {
    const normalized = normalizeSessionGraph(graph({
      nodes: [node({ id: 'm5', parentId: 'not-in-graph', createdAt: 5 })],
    }))
    expect(normalized.nodes[0].parentId).toBe('not-in-graph')
  })

  it('accepts parentMessageId / parentMid aliases', () => {
    const normalized = normalizeSessionGraph(graph({
      // 真实载荷用别名而非 parentId：这里显式去掉 parentId 才测到别名。
      nodes: [{ id: 'm1', parentMessageId: 'p1', branchId: 'main', createdAt: 1, role: 'user', text: '' }],
    }))
    expect(normalized.nodes[0].parentId).toBe('p1')
  })
})

describe('graphAsMessages', () => {
  it('maps structure to the shape buildChatTreeLayout consumes', () => {
    const messages = graphAsMessages(normalizeSessionGraph(graph({
      nodes: [
        node({ id: 'm1', parentId: '', createdAt: 1, role: 'user', text: '' }),
        node({ id: 'm2', parentId: 'm1', createdAt: 2, role: 'assistant', text: '' }),
      ],
    })))
    expect(messages).toEqual([
      { id: 'm1', parentMid: '', branchId: 'main', createdAt: 1, role: 'user', type: 'user', content: '' },
      { id: 'm2', parentMid: 'm1', branchId: 'main', createdAt: 2, role: 'assistant', type: 'assistant', content: '' },
    ])
  })

  it('never fabricates message bodies', () => {
    const messages = graphAsMessages(normalizeSessionGraph(graph({
      nodes: [node({ id: 'm1', text: '短文本', createdAt: 1 })],
    })))
    // 只带树需要的极短文本，不带 parts / 完整 content。
    expect(messages[0].content).toBe('短文本')
    expect(messages[0]).not.toHaveProperty('parts')
  })
})

describe('activePathIds', () => {
  it('walks from head back to root', () => {
    const normalized = normalizeSessionGraph(graph({
      head: 'm3',
      nodes: [
        node({ id: 'm1', parentId: '', createdAt: 1 }),
        node({ id: 'm2', parentId: 'm1', createdAt: 2 }),
        node({ id: 'm3', parentId: 'm2', createdAt: 3 }),
      ],
    }))
    expect([...activePathIds(normalized)].sort()).toEqual(['m1', 'm2', 'm3'])
  })

  it('honours an explicit head override', () => {
    const normalized = normalizeSessionGraph(graph({
      head: 'm3',
      nodes: [
        node({ id: 'm1', parentId: '', createdAt: 1 }),
        node({ id: 'm2', parentId: 'm1', createdAt: 2 }),
        node({ id: 'm3', parentId: 'm1', createdAt: 3 }),
      ],
    }))
    expect([...activePathIds(normalized, 'm2')].sort()).toEqual(['m1', 'm2'])
  })

  it('falls back to the latest leaf when head is absent', () => {
    const normalized = normalizeSessionGraph(graph({
      head: '',
      nodes: [
        node({ id: 'm1', parentId: '', createdAt: 1 }),
        node({ id: 'm2', parentId: 'm1', createdAt: 2 }),
        node({ id: 'm3', parentId: 'm1', createdAt: 3 }),
      ],
    }))
    expect([...activePathIds(normalized)].sort()).toEqual(['m1', 'm3'])
  })

  it('stops on a cycle instead of looping forever', () => {
    const normalized = normalizeSessionGraph(graph({
      head: 'a',
      nodes: [
        node({ id: 'a', parentId: 'b', createdAt: 1 }),
        node({ id: 'b', parentId: 'a', createdAt: 2 }),
      ],
    }))
    expect(activePathIds(normalized).size).toBeLessThanOrEqual(2)
  })
})
