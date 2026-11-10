import { describe, expect, it } from 'vitest'
import type { DeskEntry } from '../domain/desks'
import { deskEntryNoticeKey, resolveDeskNoticeDot } from './deskNotice'

function entry(overrides: Partial<DeskEntry> = {}): DeskEntry {
  return {
    targetKind: 'role',
    targetId: 'role-a',
    roleId: '',
    chatId: 'chat-1',
    addedAt: 0,
    key: 'role::role-a::::chat-1',
    title: '甲会话',
    targetName: '甲角色',
    roleName: '',
    avatarImage: '',
    roleAvatarImage: '',
    ...overrides,
  }
}

describe('桌面条目通知点', () => {
  it('角色条目的键就是三段直连', () => {
    expect(deskEntryNoticeKey(entry())).toBe('role:role-a:chat-1')
  })

  it('工作区条目折回「工作区|角色」再拼键，通知与运行卡都认这一把', () => {
    expect(
      deskEntryNoticeKey(entry({ targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'chat-2' })),
    ).toBe('workspace:ws-1::role-b:chat-2')
  })

  it('三种状态按「要人动手」排序：等待确认压过异常中断，异常中断压过已完成', () => {
    expect(
      resolveDeskNoticeDot({ notice: { kind: 'completed', changedAt: 1 }, waitingConfirmation: true }),
    ).toBe('waiting_confirmation')
    expect(
      resolveDeskNoticeDot({ notice: { kind: 'interrupted', changedAt: 1 }, waitingConfirmation: true }),
    ).toBe('waiting_confirmation')
    expect(
      resolveDeskNoticeDot({ notice: { kind: 'interrupted', changedAt: 1 }, waitingConfirmation: false }),
    ).toBe('error')
    expect(
      resolveDeskNoticeDot({ notice: { kind: 'completed', changedAt: 1 }, waitingConfirmation: false }),
    ).toBe('completed')
  })

  it('既没通知也不等待确认时不画点', () => {
    expect(resolveDeskNoticeDot({ notice: undefined, waitingConfirmation: false })).toBe('')
  })
})
