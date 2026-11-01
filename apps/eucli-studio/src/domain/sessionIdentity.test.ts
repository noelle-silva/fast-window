import { describe, expect, it } from 'vitest'
import {
  applySessionIdentity,
  mergeSessionIdentity,
  preserveSessionIdentity,
  realSessionTitle,
  sessionIdentityFromChat,
  sessionIdentityFromMeta,
} from './sessionIdentity'

describe('会话级事实的归并规则', () => {
  it('占位标题不算事实（「新聊天」/「群聊」/「工作区会话」）', () => {
    expect(realSessionTitle('新聊天')).toBe('')
    expect(realSessionTitle('群聊')).toBe('')
    expect(realSessionTitle('工作区会话')).toBe('')
    expect(realSessionTitle('真实标题')).toBe('真实标题')
    expect(sessionIdentityFromChat({ id: 'c1', title: '新聊天' })).toBeNull()
  })

  it('索引事实优先，缺失字段由次级事实补', () => {
    const merged = mergeSessionIdentity(
      { title: '', createdAt: 100, updatedAt: 0 },
      { title: '索引标题', createdAt: 0, updatedAt: 200 },
    )
    expect(merged).toEqual({ title: '索引标题', createdAt: 100, updatedAt: 200 })
  })

  it('chatMeta 转事实时保留正数时间', () => {
    expect(sessionIdentityFromMeta({ id: 'c1', title: '标题', createdAt: 1, updatedAt: 2, lastMessagePreview: '', messageCount: 0, hasPending: false, runStatus: 'idle', runStatusChangedAt: 0 }))
      .toEqual({ title: '标题', createdAt: 1, updatedAt: 2 })
  })

  it('applySessionIdentity 用真实事实覆盖兜底值，但更新时间只前进', () => {
    const chat = applySessionIdentity(
      { id: 'c1', title: '新聊天', createdAt: 5, updatedAt: 900 },
      { title: '真实标题', createdAt: 100, updatedAt: 500 },
    )
    expect(chat.title).toBe('真实标题')
    expect(chat.createdAt).toBe(100)
    // 已有 updatedAt 更新：不能被更旧的索引快照回退。
    expect(chat.updatedAt).toBe(900)
  })

  it('preserveSessionIdentity 拦住窗口切片的兜底覆盖', () => {
    const next = { id: 'c1', title: '新聊天', createdAt: 999, updatedAt: 1 }
    preserveSessionIdentity(next, { id: 'c1', title: '真实标题', createdAt: 100, updatedAt: 900 })
    expect(next.title).toBe('真实标题')
    expect(next.createdAt).toBe(100)
    expect(next.updatedAt).toBe(900)
  })

  it('preserveSessionIdentity 允许切片填补缺失，但不写入占位标题', () => {
    const next = { id: 'c1', title: '新聊天', createdAt: 0, updatedAt: 0 }
    preserveSessionIdentity(next, { id: 'c1', title: '', createdAt: 0, updatedAt: 0 })
    expect(next.title).toBe('新聊天')
    expect(next.createdAt).toBe(0)
    expect(next.updatedAt).toBe(0)
  })

  it('preserveSessionIdentity 用已加载会话的真实标题覆盖切片兜底标题', () => {
    const next = { id: 'c1', title: '新聊天', createdAt: 999, updatedAt: 1 }
    preserveSessionIdentity(next, { id: 'c1', title: '真实标题', createdAt: 0, updatedAt: 0 })
    expect(next.title).toBe('真实标题')
    // 已加载会话没有创建时间：不编造，保留切片值。
    expect(next.createdAt).toBe(999)
  })
})
