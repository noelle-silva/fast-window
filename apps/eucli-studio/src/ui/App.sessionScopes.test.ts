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

  it('订阅 settings 与实体/库/插件地址，设置与实体变化不会漏刷', () => {
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, refreshScopes.settings())')
    expect(APP_SOURCE).toContain('useScopedUiVersions(controller, [')
    expect(APP_SOURCE).toContain("refreshScopes.entities('roles')")
    expect(APP_SOURCE).toContain("refreshScopes.entities('tools')")
    expect(APP_SOURCE).toContain("refreshScopes.entities('plugins')")
  })

  it('运行会话派生依赖 runCards 版本，且运行观测与弹层拿到 controller', () => {
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, refreshScopes.runCards())')
    expect(APP_SOURCE).toContain('[dataVersion, runCardsVersion, s, data]')
    expect(APP_SOURCE).toMatch(/activeChatId,\s*controller,\s*\}\)/)
    expect(APP_SOURCE).toMatch(/controller,\s*open: runningSessionsOpen/)
  })
})
