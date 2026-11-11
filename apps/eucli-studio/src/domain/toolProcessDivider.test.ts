import { describe, expect, it } from 'vitest'
import { findToolProcessRanges } from './toolProcessDivider'

function user(id: string) {
  return { id, role: 'user', type: 'user', content: id }
}

function assistant(
  id: string,
  options?: { tools?: number; generationId?: string; status?: string },
) {
  const tools = Math.max(0, Number(options?.tools) || 0)
  const generationId = String(options?.generationId || '')
  const status = String(options?.status || '')
  return {
    id,
    role: 'assistant',
    type: 'assistant',
    content: '',
    parts: Array.from({ length: tools }, (_, index) => ({ id: `${id}-tool-${index}`, type: 'tool' })),
    ...(generationId ? { assistantRun: { generationId, status } } : {}),
  }
}

const isRunning = (message: any) => message?.assistantRun?.status === 'running'

describe('findToolProcessRanges 的运行态口径', () => {
  it('运行中的过渡消息留在过程内，收尾后才落回过程外', () => {
    const messages = [
      user('u1'),
      assistant('a1', { tools: 1, generationId: 'g1', status: 'completed' }),
      assistant('a2', { generationId: 'g1', status: 'running' }),
    ]

    const running = findToolProcessRanges(messages, { isLive: isRunning })
    expect(running).toEqual([{ start: 1, end: 2, rounds: 1, toolCalls: 1 }])

    const settledMessages = [
      messages[0],
      messages[1],
      assistant('a2', { generationId: 'g1', status: 'completed' }),
    ]
    const settled = findToolProcessRanges(settledMessages, { isLive: isRunning })
    expect(settled).toEqual([{ start: 1, end: 1, rounds: 1, toolCalls: 1 }])
  })

  it('工具部件落进来时，同一次运行里先到的思考算作过程开头', () => {
    const messages = [
      user('u1'),
      assistant('a1', { generationId: 'g1', status: 'running' }),
      assistant('a2', { tools: 2, generationId: 'g1', status: 'running' }),
    ]
    expect(findToolProcessRanges(messages, { isLive: isRunning })).toEqual([
      { start: 1, end: 2, rounds: 1, toolCalls: 2 },
    ])
  })

  it('过程中间的已收尾纯文本不切断区间', () => {
    const messages = [
      user('u1'),
      assistant('a1', { tools: 1, generationId: 'g1', status: 'completed' }),
      assistant('a2', { generationId: 'g1', status: 'completed' }),
      assistant('a3', { tools: 1, generationId: 'g1', status: 'completed' }),
      user('u2'),
    ]
    expect(findToolProcessRanges(messages, { isLive: isRunning })).toEqual([
      { start: 1, end: 3, rounds: 2, toolCalls: 2 },
    ])
  })

  it('用户消息仍然切开两段过程', () => {
    const messages = [
      user('u1'),
      assistant('a1', { tools: 1 }),
      user('u2'),
      assistant('a2', { tools: 1 }),
    ]
    expect(findToolProcessRanges(messages, { isLive: isRunning })).toEqual([
      { start: 1, end: 1, rounds: 1, toolCalls: 1 },
      { start: 3, end: 3, rounds: 1, toolCalls: 1 },
    ])
  })

  it('没有工具调用的纯文本回合不产生区间', () => {
    const messages = [user('u1'), assistant('a1', { generationId: 'g1', status: 'completed' })]
    expect(findToolProcessRanges(messages, { isLive: isRunning })).toEqual([])
  })

  // 运行期间的逐步演化：区间只该在工具部件首次落下时开启一次，
  // 之后每来一条新的过渡消息都不能把它切开重开——那正是「反复展开收起」的来源。
  it('流式推进过程中区间保持同一段，不在每轮重新开启', () => {
    const steps: any[][] = [
      // 第一轮：只有思考，还没工具
      [user('u1'), assistant('a1', { generationId: 'g1', status: 'running' })],
      // 工具部件落下：过程开启，思考被收回过程开头
      [user('u1'), assistant('a1', { tools: 1, generationId: 'g1', status: 'running' })],
      // 第二轮开始：新消息先只有思考，仍属于同一次运行
      [user('u1'), assistant('a1', { tools: 1, generationId: 'g1', status: 'running' }), assistant('a2', { generationId: 'g1', status: 'running' })],
      // 第二轮工具落下
      [
        user('u1'),
        assistant('a1', { tools: 1, generationId: 'g1', status: 'running' }),
        assistant('a2', { tools: 1, generationId: 'g1', status: 'running' }),
      ],
      // 最终回复流式中：仍算过程内，整段保持展开
      [
        user('u1'),
        assistant('a1', { tools: 1, generationId: 'g1', status: 'completed' }),
        assistant('a2', { tools: 1, generationId: 'g1', status: 'completed' }),
        assistant('a3', { generationId: 'g1', status: 'running' }),
      ],
    ]

    const seen = steps.map((messages) => findToolProcessRanges(messages, { isLive: isRunning }))
    expect(seen.map((ranges) => ranges.length)).toEqual([0, 1, 1, 1, 1])
    // 从开启那一刻起，起点与区间标识都不再变化
    expect(seen[1][0].start).toBe(1)
    expect(seen[2][0].start).toBe(1)
    expect(seen[3][0].start).toBe(1)
    expect(seen[4][0].start).toBe(1)

    // 收尾：最终回复落回过程外，过程只在这里收缩一次
    const settled = findToolProcessRanges(
      [
        user('u1'),
        assistant('a1', { tools: 1, generationId: 'g1', status: 'completed' }),
        assistant('a2', { tools: 1, generationId: 'g1', status: 'completed' }),
        assistant('a3', { generationId: 'g1', status: 'completed' }),
      ],
      { isLive: isRunning },
    )
    expect(settled).toEqual([{ start: 1, end: 2, rounds: 2, toolCalls: 2 }])
  })
})
