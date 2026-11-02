import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const APP_SOURCE = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('App 会话通知订阅', () => {
  it('订阅 navigation 地址', () => {
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, refreshScopes.navigation())')
  })

  it('按当前目标与会话构造 session 地址', () => {
    expect(APP_SOURCE).toContain('refreshScopes.session(activeTargetKind, activeChatTargetId, activeChatId)')
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, activeSessionScope, !!activeSessionScope)')
  })

  it('没有当前会话时不建立 session 订阅，且保留迁移期全局订阅', () => {
    expect(APP_SOURCE).toContain('activeChatId && activeChatTargetId')
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, activeSessionScope, !!activeSessionScope)')
    expect(APP_SOURCE).toContain('const s = useAiChatState(controller)')
  })
})
