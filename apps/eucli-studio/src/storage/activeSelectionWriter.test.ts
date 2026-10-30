import { describe, expect, it, vi } from 'vitest'
import { createActiveSelectionWriter } from './activeSelectionWriter'
import { currentSwitchSpan, resetSwitchSpanForTests, setSwitchTraceSink, type SwitchMark } from '../domain/switchSpan'

describe('ActiveSelectionWriter', () => {
  it('只发偏好命令，不写索引数据事实', async () => {
    const calls: Array<{ scope: string; chatId: string; switchId?: string }> = []
    const applied: Array<{ scope: string; chatId: string }> = []
    const writer = createActiveSelectionWriter({
      hasCommand: () => true,
      setActiveChat: async (scope, chatId, options) => {
        calls.push({ scope: `${scope.kind}:${scope.targetId}`, chatId, switchId: options?.switchId })
        return { applied: true, preferenceRevision: 5, activeChatId: chatId }
      },
      applyLocalSelection: (scope, chatId) => applied.push({ scope: `${scope.kind}:${scope.targetId}`, chatId }),
    })

    const ok = await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-2')
    expect(ok).toBe(true)
    expect(calls).toEqual([{ scope: 'role:role-1', chatId: 'chat-2', switchId: expect.any(String) }])
    expect(applied).toEqual([{ scope: 'role:role-1', chatId: 'chat-2' }])
  })

  it('重复选中同一会话不发请求（幂等）', async () => {
    const setActiveChat = vi.fn(async (_scope: any, chatId: string) => ({ applied: true, preferenceRevision: 1, activeChatId: chatId }))
    const writer = createActiveSelectionWriter({
      hasCommand: () => true,
      setActiveChat,
      applyLocalSelection: () => {},
    })

    await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    expect(setActiveChat).toHaveBeenCalledTimes(1)
  })

  it('同一 scope 的连续点击严格串行，最终落点是最新一次', async () => {
    const order: string[] = []
    const writer = createActiveSelectionWriter({
      hasCommand: () => true,
      setActiveChat: async (_scope, chatId) => {
        await new Promise((resolve) => setTimeout(resolve, chatId === 'chat-1' ? 12 : 1))
        order.push(chatId)
        return { applied: true, preferenceRevision: 1, activeChatId: chatId }
      },
      applyLocalSelection: () => {},
    })

    const first = writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    const second = writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-2')
    await Promise.all([first, second])
    expect(order).toEqual(['chat-1', 'chat-2'])
  })

  it('不同 scope 互不阻塞', async () => {
    const completed: string[] = []
    const writer = createActiveSelectionWriter({
      hasCommand: () => true,
      setActiveChat: async (scope, chatId) => {
        await new Promise((resolve) => setTimeout(resolve, scope.targetId === 'role-1' ? 20 : 1))
        completed.push(`${scope.targetId}:${chatId}`)
        return { applied: true, preferenceRevision: 1, activeChatId: chatId }
      },
      applyLocalSelection: () => {},
    })

    const slow = writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    const fast = writer.select({ kind: 'role', targetId: 'role-2' }, 'chat-2')
    await Promise.all([slow, fast])
    expect(completed[0]).toBe('role-2:chat-2')
  })

  it('后端没有 setActiveChat 时退化为最小索引写', async () => {
    const legacy: Array<{ scope: string; chatId: string }> = []
    const writer = createActiveSelectionWriter({
      hasCommand: () => false,
      setActiveChat: async () => {
        throw new Error('不应该被调用')
      },
      writeLegacySelection: async (scope, chatId) => {
        legacy.push({ scope: `${scope.kind}:${scope.targetId}`, chatId })
      },
      applyLocalSelection: () => {},
    })

    const ok = await writer.select({ kind: 'group', targetId: 'group-1' }, 'gchat-1')
    expect(ok).toBe(true)
    expect(legacy).toEqual([{ scope: 'group:group-1', chatId: 'gchat-1' }])
  })

  it('命令失败时上报错误且不写本地偏好', async () => {
    const errors: string[] = []
    const applied: string[] = []
    const writer = createActiveSelectionWriter({
      hasCommand: () => true,
      setActiveChat: async () => {
        throw new Error('网络断了')
      },
      applyLocalSelection: (_scope, chatId) => applied.push(chatId),
      onError: (message) => errors.push(message),
    })

    const ok = await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    expect(ok).toBe(false)
    expect(errors).toEqual(['网络断了'])
    expect(applied).toEqual([])
  })

  it('失败后重试同一目标仍然会重新发请求（幂等只记成功）', async () => {
    let attempts = 0
    const writer = createActiveSelectionWriter({
      hasCommand: () => true,
      setActiveChat: async (_scope, chatId) => {
        attempts += 1
        if (attempts === 1) throw new Error('首次失败')
        return { applied: true, preferenceRevision: 1, activeChatId: chatId }
      },
      applyLocalSelection: () => {},
      onError: () => {},
    })

    await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
    expect(attempts).toBe(2)
  })

  it('switchId 贯穿前端入口边界', async () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    try {
      let seenSwitchId = ''
      const writer = createActiveSelectionWriter({
        hasCommand: () => true,
        setActiveChat: async (_scope, chatId, options) => {
          seenSwitchId = String(options?.switchId || '')
          return { applied: true, preferenceRevision: 1, activeChatId: chatId }
        },
        applyLocalSelection: () => {},
      })
      await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
      expect(seenSwitchId).toMatch(/^sw-/)
      const select = marks.find((mark) => mark.boundary === 'frontend.select')
      expect(select?.switchId).toBe(seenSwitchId)
      expect(select?.key).toBe('role:role-1:chat-1')
    } finally {
      resetSwitchSpanForTests()
    }
  })

  it('命令成功不结算：settled 属于绘制侧，不能在这里提前上报', async () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    try {
      const writer = createActiveSelectionWriter({
        hasCommand: () => true,
        setActiveChat: async (_scope, chatId) => ({ applied: true, preferenceRevision: 1, activeChatId: chatId }),
        applyLocalSelection: () => {},
      })
      await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')

      const boundaries = marks.map((mark) => mark.boundary)
      expect(boundaries).toContain('frontend.select')
      expect(boundaries).toContain('frontend.command')
      // 命令成功 ≠ 切换结束：正文与绘制还在后面。
      expect(boundaries).not.toContain('frontend.settled')
      expect(boundaries).not.toContain('frontend.failed')
    } finally {
      resetSwitchSpanForTests()
    }
  })

  it('绘制侧通过 currentSwitchSpan 补 painted / enhance / settled', async () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    try {
      const writer = createActiveSelectionWriter({
        hasCommand: () => true,
        setActiveChat: async (_scope, chatId) => ({ applied: true, preferenceRevision: 1, activeChatId: chatId }),
        applyLocalSelection: () => {},
      })
      await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')

      // 绘制侧只需要「最近一次切换」的句柄，不需要把 span 透传进渲染树。
      const span = currentSwitchSpan()
      expect(span).not.toBeNull()
      span!.mark('frontend.painted')
      span!.mark('frontend.enhanceStart')
      span!.mark('frontend.enhanceEnd')
      span!.settle()

      const boundaries = marks.map((mark) => mark.boundary)
      for (const expected of ['frontend.painted', 'frontend.enhanceStart', 'frontend.enhanceEnd', 'frontend.settled']) {
        expect(boundaries).toContain(expected)
      }
      // 全部 mark 共享同一个 switchId。
      expect(new Set(marks.map((mark) => mark.switchId)).size).toBe(1)
    } finally {
      resetSwitchSpanForTests()
    }
  })

  it('失败路径上报 failed 终态', async () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    try {
      const writer = createActiveSelectionWriter({
        hasCommand: () => true,
        setActiveChat: async () => {
          throw new Error('失败')
        },
        applyLocalSelection: () => {},
        onError: () => {},
      })
      await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
      const boundaries = marks.map((mark) => mark.boundary)
      // 失败是一次切换的终态：必须上报 failed（而不是 settled）。
      expect(boundaries).toContain('frontend.failed')
      expect(boundaries).not.toContain('frontend.settled')
      const failed = marks.find((mark) => mark.boundary === 'frontend.failed')
      expect(failed?.reason).toBe('失败')
    } finally {
      resetSwitchSpanForTests()
    }
  })

  it('成功路径上报 select 与 command，且不报 failed', async () => {
    const marks: SwitchMark[] = []
    setSwitchTraceSink((mark) => marks.push(mark))
    try {
      const writer = createActiveSelectionWriter({
        hasCommand: () => true,
        setActiveChat: async (_scope, chatId) => ({ applied: true, preferenceRevision: 1, activeChatId: chatId }),
        applyLocalSelection: () => {},
      })
      await writer.select({ kind: 'role', targetId: 'role-1' }, 'chat-1')
      const boundaries = marks.map((mark) => mark.boundary)
      expect(boundaries).toContain('frontend.command')
      expect(boundaries).not.toContain('frontend.failed')
    } finally {
      resetSwitchSpanForTests()
    }
  })
})
