import { describe, expect, it } from 'vitest'
import {
  activeChatIdExistsInBox,
  firstChatIdInBox,
  normalizeActiveChatId,
  readActiveChatSelection,
  reconcileActiveChatSelection,
  reconcileActiveChatSelectionFact,
  resolveActiveChatSelection,
  resolveActiveChatSelectionFact,
  withActiveChatSelection,
  writeActiveChatSelection,
} from './activeChatSelection'

function box(activeChatId: unknown, chatIds: string[] = [], metaIds: string[] = []) {
  return {
    activeChatId,
    chatMetas: metaIds.map((id) => ({ id })),
    chats: chatIds.map((id) => ({ id })),
  }
}

describe('activeChatSelection', () => {
  it('读取时统一归一化为 trim 后的字符串', () => {
    expect(normalizeActiveChatId('  chat-1 ')).toBe('chat-1')
    expect(normalizeActiveChatId(null)).toBe('')
    expect(readActiveChatSelection({ activeChatId: ' chat-2 ' })).toBe('chat-2')
    expect(readActiveChatSelection(null)).toBe('')
  })

  it('写入统一归一化，并对相同值保持幂等', () => {
    const target = box(' chat-1 ')
    expect(writeActiveChatSelection(target, 'chat-1')).toBe(true)
    expect(target.activeChatId).toBe('chat-1')
    expect(writeActiveChatSelection(target, 'chat-1')).toBe(false)

    expect(writeActiveChatSelection(target, ' chat-2 ')).toBe(true)
    expect(target.activeChatId).toBe('chat-2')
    expect(writeActiveChatSelection(null, 'chat-3')).toBe(false)
  })

  it('不可变副本不修改原对象', () => {
    const source = box('chat-1')
    const next = withActiveChatSelection(source, 'chat-2')

    expect(next).not.toBe(source)
    expect(source.activeChatId).toBe('chat-1')
    expect(next.activeChatId).toBe('chat-2')
  })

  it('存在性同时检查 chatMetas 与 chats', () => {
    const target = box('', ['chat-1'], ['chat-2'])
    expect(activeChatIdExistsInBox(target, 'chat-1')).toBe(true)
    expect(activeChatIdExistsInBox(target, 'chat-2')).toBe(true)
    expect(activeChatIdExistsInBox(target, 'chat-3')).toBe(false)
    expect(activeChatIdExistsInBox(target, '')).toBe(false)
  })

  it('第一条会话按调用方指定的列表顺序取值', () => {
    const target = box('', ['chat-1'], ['chat-2', 'chat-3'])
    expect(firstChatIdInBox(target)).toBe('chat-2')
    expect(firstChatIdInBox(target, 'chats')).toBe('chat-1')
    expect(firstChatIdInBox(box(''), 'chats')).toBe('')
  })

  it('候选解析只接受真实存在的会话，并保持候选优先级', () => {
    const target = box('', ['chat-1', 'chat-2'], ['chat-3'])
    expect(resolveActiveChatSelection(target, ['missing', 'chat-2', 'chat-1'])).toBe('chat-2')
    expect(resolveActiveChatSelection(target, ['chat-3'])).toBe('chat-3')
    expect(resolveActiveChatSelection(target, ['missing'])).toBe('')
  })

  it('失效的当前选择会按 prefer 顺序兜底到第一条', () => {
    const target = box('stale', ['chat-1'], ['chat-2'])
    expect(reconcileActiveChatSelection(target)).toBe('chat-2')
    expect(target.activeChatId).toBe('chat-2')

    const chatsFirst = box('stale', ['chat-1'], ['chat-2'])
    expect(reconcileActiveChatSelection(chatsFirst, undefined, 'chats')).toBe('chat-1')
    expect(chatsFirst.activeChatId).toBe('chat-1')
  })

  it('仍然有效的当前选择不会被覆盖', () => {
    const target = box('chat-2', ['chat-1'], ['chat-2'])
    expect(reconcileActiveChatSelection(target)).toBe('chat-2')
    expect(target.activeChatId).toBe('chat-2')
  })
})

describe('activeChatId 事实优先级', () => {
  it('用户意图压过运行期、服务端与本地投影', () => {
    const target = box('', ['user', 'runtime', 'server', 'local'], ['user', 'runtime', 'server', 'local'])
    expect(resolveActiveChatSelectionFact(target, {
      userIntent: 'user',
      runtimeTransient: 'runtime',
      serverFact: 'server',
      localProjection: 'local',
    })).toBe('user')
  })

  it('用户意图失效时依次回落到运行期、服务端、本地投影', () => {
    const target = box('', ['runtime', 'server', 'local'], [])
    expect(resolveActiveChatSelectionFact(target, {
      userIntent: 'missing',
      runtimeTransient: 'runtime',
      serverFact: 'server',
      localProjection: 'local',
    })).toBe('runtime')

    expect(resolveActiveChatSelectionFact(target, {
      userIntent: 'missing',
      runtimeTransient: 'missing',
      serverFact: 'server',
      localProjection: 'local',
    })).toBe('server')

    expect(resolveActiveChatSelectionFact(target, {
      userIntent: 'missing',
      runtimeTransient: 'missing',
      serverFact: 'missing',
      localProjection: 'local',
    })).toBe('local')
  })

  it('来源都失效时按额外候选顺序兜底', () => {
    const target = box('', ['chat-1', 'chat-2'], [])
    expect(resolveActiveChatSelectionFact(target, {
      userIntent: 'missing',
      fallbackCandidates: ['missing', 'chat-2', 'chat-1'],
    })).toBe('chat-2')
  })

  it('多窗口场景：本窗口用户已保存的选择不被服务端索引偏好覆盖', () => {
    const target = box('local-choice', ['local-choice', 'other-window-choice'], ['local-choice', 'other-window-choice'])
    expect(reconcileActiveChatSelectionFact(target, {
      userIntent: readActiveChatSelection(target),
      serverFact: 'other-window-choice',
    })).toBe('local-choice')
    expect(target.activeChatId).toBe('local-choice')
  })

  it('重启恢复：失效的本地选择回落到服务端索引，再由列表首条兜底', () => {
    const target = box('stale-local', ['chat-1', 'chat-2'], [])
    expect(reconcileActiveChatSelectionFact(target, {
      userIntent: readActiveChatSelection(target),
      serverFact: 'chat-2',
    })).toBe('chat-2')
    expect(target.activeChatId).toBe('chat-2')

    const empty = box('stale-local', ['chat-1'], [])
    expect(reconcileActiveChatSelectionFact(empty, {
      userIntent: readActiveChatSelection(empty),
      serverFact: 'missing',
    })).toBe('chat-1')
  })
})
