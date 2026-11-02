import { describe, expect, it } from 'vitest'
import {
  COMPOSER_REFRESH_SCOPE,
  GLOBAL_REFRESH_SCOPE,
  NAVIGATION_REFRESH_SCOPE,
  RUN_CARDS_REFRESH_SCOPE,
  SETTINGS_REFRESH_SCOPE,
  UI_SHELL_REFRESH_SCOPE,
  messageRefreshScope,
  refreshScopes,
} from './uiRefreshScope'

// 地址目录契约：所有刷新地址必须经 refreshScopes 构造，且前缀、退化规则、
// 会话身份与旧 messageRefreshScope 兼容行为保持稳定。
//
// 失败时说明有构造器改了地址格式或漏了身份字段；不要靠改测试来“适配”实现，
// 地址格式是生产者和消费者之间的字符串契约。

// 每个带动态段的构造器在这里给一份“完整身份”样例。
// 唯一性断言只使用完整身份样例，因为“缺身份 → global”本身就可能与 global 相同。
const COMPLETE_ADDRESS_SAMPLES = {
  global: refreshScopes.global(),
  uiShellBase: refreshScopes.uiShell(),
  uiShellSection: refreshScopes.uiShell('sidebar'),
  settings: refreshScopes.settings(),
  entities: refreshScopes.entities('roles'),
  navigation: refreshScopes.navigation(),
  chatList: refreshScopes.chatList('role', 'role-1'),
  session: refreshScopes.session('role', 'role-1', 'chat-1'),
  message: refreshScopes.message('role', 'role-1', 'chat-1', 'msg-1'),
  composer: refreshScopes.composer(),
  overlays: refreshScopes.overlays('rolePicker'),
  runCards: refreshScopes.runCards(),
  legacyMessage: messageRefreshScope('legacy-msg-1'),
} as const

describe('契约·刷新地址目录', () => {
  it('基础地址前缀稳定', () => {
    expect(refreshScopes.global()).toBe(GLOBAL_REFRESH_SCOPE)
    expect(refreshScopes.settings()).toBe(SETTINGS_REFRESH_SCOPE)
    expect(refreshScopes.navigation()).toBe(NAVIGATION_REFRESH_SCOPE)
    expect(refreshScopes.composer()).toBe(COMPOSER_REFRESH_SCOPE)
    expect(refreshScopes.runCards()).toBe(RUN_CARDS_REFRESH_SCOPE)
    expect(refreshScopes.uiShell()).toBe(UI_SHELL_REFRESH_SCOPE)
  })

  it('uiShell 分区地址带稳定前缀，空白分区退化为无分区地址', () => {
    expect(refreshScopes.uiShell('sidebar')).toBe('uiShell:sidebar')
    expect(refreshScopes.uiShell('sidebar').startsWith(`${UI_SHELL_REFRESH_SCOPE}:`)).toBe(true)
    expect(refreshScopes.uiShell('   ')).toBe(UI_SHELL_REFRESH_SCOPE)
    expect(refreshScopes.uiShell('')).toBe(UI_SHELL_REFRESH_SCOPE)
  })

  it('实体 / 列表 / 会话 / 弹层构造器前缀稳定', () => {
    expect(refreshScopes.entities('roles')).toBe('entities:roles')
    expect(refreshScopes.chatList('role', 'role-1')).toBe('chatList:role:role-1')
    expect(refreshScopes.chatList('group', 'group-1')).toBe('chatList:group:group-1')
    expect(refreshScopes.chatList('workspace', 'ws-1::role-1')).toBe('chatList:workspace:ws-1::role-1')
    expect(refreshScopes.session('role', 'role-1', 'chat-1')).toBe('session:role:role-1:chat-1')
    expect(refreshScopes.session('workspace', 'ws-1::role-1', 'chat-1')).toBe(
      'session:workspace:ws-1::role-1:chat-1',
    )
    expect(refreshScopes.overlays('rolePicker')).toBe('overlays:rolePicker')
  })

  it('message 地址必须带完整会话身份，不同会话的同名消息不会相撞', () => {
    const inRole = refreshScopes.message('role', 'role-1', 'chat-1', 'msg-1')
    const inGroup = refreshScopes.message('group', 'group-1', 'chat-1', 'msg-1')
    const otherChat = refreshScopes.message('role', 'role-1', 'chat-2', 'msg-1')

    expect(inRole).toBe('message:role:role-1:chat-1:msg-1')
    expect(inGroup).toBe('message:group:group-1:chat-1:msg-1')
    expect(inRole).not.toBe(inGroup)
    expect(inRole).not.toBe(otherChat)
    expect(inRole).not.toBe(messageRefreshScope('msg-1'))
  })

  it('缺少身份时一律退化为 global 安全阀', () => {
    const missing: Array<[string, string]> = [
      ['entities', refreshScopes.entities('')],
      ['entities(null)', refreshScopes.entities(null)],
      ['chatList 缺 targetId', refreshScopes.chatList('role', '')],
      ['chatList 缺 kind', refreshScopes.chatList('' as never, 'role-1')],
      ['session 缺 chatId', refreshScopes.session('role', 'role-1', '')],
      ['session 缺 targetId', refreshScopes.session('role', '', 'chat-1')],
      ['message 缺 mid', refreshScopes.message('role', 'role-1', 'chat-1', '  ')],
      ['message 缺 chatId', refreshScopes.message('role', 'role-1', '', 'msg-1')],
      ['overlays 缺 name', refreshScopes.overlays('')],
    ]

    for (const [label, address] of missing) {
      expect(address, `${label} 应该退化为 global`).toBe(GLOBAL_REFRESH_SCOPE)
    }
  })

  it('旧 messageRefreshScope(mid) 保持 `message:<mid>` 兼容，空身份退化为 global', () => {
    expect(messageRefreshScope('msg-1')).toBe('message:msg-1')
    expect(messageRefreshScope('  msg-2  ')).toBe('message:msg-2')
    expect(messageRefreshScope('')).toBe(GLOBAL_REFRESH_SCOPE)
    expect(messageRefreshScope('   ')).toBe(GLOBAL_REFRESH_SCOPE)
    expect(messageRefreshScope(null)).toBe(GLOBAL_REFRESH_SCOPE)
    expect(messageRefreshScope(undefined)).toBe(GLOBAL_REFRESH_SCOPE)
  })

  it('不同构造器在完整身份样例下不会产生相同地址', () => {
    const entries = Object.entries(COMPLETE_ADDRESS_SAMPLES)
    const seen = new Map<string, string>()

    for (const [name, address] of entries) {
      const previous = seen.get(address)
      expect(
        previous,
        `地址碰撞：${name} 与 ${previous} 都产出 ${address}；请检查构造器前缀或身份段`,
      ).toBeUndefined()
      seen.set(address, name)
    }

    expect(seen.size).toBe(entries.length)
  })
})
