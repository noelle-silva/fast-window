import { describe, expect, it } from 'vitest'
import {
  APP_DATA_REFRESH_SCOPE,
  COMPOSER_REFRESH_SCOPE,
  GLOBAL_REFRESH_SCOPE,
  NAVIGATION_REFRESH_SCOPE,
  RUN_CARDS_REFRESH_SCOPE,
  SETTINGS_REFRESH_SCOPE,
  UI_SHELL_REFRESH_SCOPE,
  messageRefreshScope,
  refreshScopes,
} from './uiRefreshScope'

describe('刷新地址构造器', () => {
  it('产出稳定的基础地址', () => {
    expect(refreshScopes.global()).toBe(GLOBAL_REFRESH_SCOPE)
    expect(refreshScopes.appData()).toBe(APP_DATA_REFRESH_SCOPE)
    expect(refreshScopes.settings()).toBe(SETTINGS_REFRESH_SCOPE)
    expect(refreshScopes.navigation()).toBe(NAVIGATION_REFRESH_SCOPE)
    expect(refreshScopes.composer()).toBe(COMPOSER_REFRESH_SCOPE)
    expect(refreshScopes.runCards()).toBe(RUN_CARDS_REFRESH_SCOPE)
  })

  it('uiShell 在无分区时使用基础地址，有分区时带分区身份', () => {
    expect(refreshScopes.uiShell()).toBe(UI_SHELL_REFRESH_SCOPE)
    expect(refreshScopes.uiShell('  ')).toBe(UI_SHELL_REFRESH_SCOPE)
    expect(refreshScopes.uiShell('sidebar')).toBe('uiShell:sidebar')
  })

  it('实体、会话列表、会话与弹层地址格式稳定', () => {
    expect(refreshScopes.entities('roles')).toBe('entities:roles')
    expect(refreshScopes.chatList('role', 'role-1')).toBe('chatList:role:role-1')
    expect(refreshScopes.chatList('group', 'group-1')).toBe('chatList:group:group-1')
    expect(refreshScopes.session('role', 'role-1', 'chat-1')).toBe('session:role:role-1:chat-1')
    expect(refreshScopes.session('workspace', 'ws-1::role-1', 'chat-1')).toBe(
      'session:workspace:ws-1::role-1:chat-1',
    )
    expect(refreshScopes.overlays('rolePicker')).toBe('overlays:rolePicker')
  })

  it('消息地址带完整会话身份，不同会话的同名消息不会相撞', () => {
    const inRole = refreshScopes.message('role', 'role-1', 'chat-1', 'msg-1')
    const inGroup = refreshScopes.message('group', 'group-1', 'chat-1', 'msg-1')

    expect(inRole).toBe('message:role:role-1:chat-1:msg-1')
    expect(inGroup).toBe('message:group:group-1:chat-1:msg-1')
    expect(inRole).not.toBe(inGroup)
    expect(inRole).not.toBe(messageRefreshScope('msg-1'))
  })

  it('缺少必要身份时退化为 global 安全阀', () => {
    expect(refreshScopes.entities('')).toBe(GLOBAL_REFRESH_SCOPE)
    expect(refreshScopes.chatList('role', '')).toBe(GLOBAL_REFRESH_SCOPE)
    expect(refreshScopes.session('role', 'role-1', '')).toBe(GLOBAL_REFRESH_SCOPE)
    expect(refreshScopes.message('role', 'role-1', 'chat-1', '  ')).toBe(GLOBAL_REFRESH_SCOPE)
    expect(refreshScopes.overlays('')).toBe(GLOBAL_REFRESH_SCOPE)
  })

  it('旧 messageRefreshScope 保持兼容', () => {
    expect(messageRefreshScope('msg-1')).toBe('message:msg-1')
    expect(messageRefreshScope('  msg-2  ')).toBe('message:msg-2')
    expect(messageRefreshScope('')).toBe(GLOBAL_REFRESH_SCOPE)
    expect(messageRefreshScope(null)).toBe(GLOBAL_REFRESH_SCOPE)
    expect(messageRefreshScope(undefined)).toBe(GLOBAL_REFRESH_SCOPE)
  })
})
