import { beforeEach, describe, expect, it } from 'vitest'
import {
  addDeskDraft,
  findDeskDraftByPending,
  getDeskDrafts,
  getDeskDraftsVersion,
  removeDeskDraft,
  resetDeskDrafts,
} from './deskDrafts'

describe('桌面临时条目（内存态）', () => {
  beforeEach(() => {
    resetDeskDrafts()
  })

  it('登记后按顺序排，位置序号跟着走', () => {
    addDeskDraft({ pendingChatId: 'draft-1', targetKind: 'role', targetId: 'role-a' })
    addDeskDraft({ pendingChatId: 'draft-2', targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b' })

    expect(getDeskDrafts().map((it) => it.pendingChatId)).toEqual(['draft-1', 'draft-2'])
    expect(getDeskDrafts().map((it) => it.order)).toEqual([0, 1])
  })

  it('同一个草稿重复登记不会出现两条', () => {
    addDeskDraft({ pendingChatId: 'draft-1', targetKind: 'role', targetId: 'role-a' })
    addDeskDraft({ pendingChatId: 'draft-1', targetKind: 'role', targetId: 'role-a' })

    expect(getDeskDrafts()).toHaveLength(1)
  })

  it('工作区草稿必须带角色，缺了不登记', () => {
    expect(addDeskDraft({ pendingChatId: 'draft-x', targetKind: 'workspace', targetId: 'ws-1' })).toBeNull()
    expect(getDeskDrafts()).toEqual([])
  })

  it('移除返回被摘掉的那条，并按会话 id 查得到', () => {
    addDeskDraft({ pendingChatId: 'draft-1', targetKind: 'role', targetId: 'role-a' })

    expect(findDeskDraftByPending('draft-1')?.targetId).toBe('role-a')
    expect(removeDeskDraft('draft-1')?.pendingChatId).toBe('draft-1')
    expect(findDeskDraftByPending('draft-1')).toBeNull()
  })

  it('每次增删都推进版本号，供界面订阅', () => {
    const start = getDeskDraftsVersion()
    addDeskDraft({ pendingChatId: 'draft-1', targetKind: 'role', targetId: 'role-a' })
    expect(getDeskDraftsVersion()).toBeGreaterThan(start)

    const afterAdd = getDeskDraftsVersion()
    removeDeskDraft('draft-1')
    expect(getDeskDraftsVersion()).toBeGreaterThan(afterAdd)
  })
})
