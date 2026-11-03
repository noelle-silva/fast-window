import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_ROOT_REFRESH_SCOPES } from '../domain/appRefreshScopes'
import { refreshScopes } from '../domain/uiRefreshScope'

const APP_SOURCE = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const FAVORITE_FOLDERS_SOURCE = readFileSync(new URL('./hooks/useFavoriteFolders.tsx', import.meta.url), 'utf8')

describe('App 精准通知订阅', () => {
  it('直接读取 controller 状态，不再使用全局订阅', () => {
    expect(APP_SOURCE).toContain('const s = controller.getState()')
    expect(APP_SOURCE).not.toContain('useAiChatState')
    expect(APP_SOURCE).not.toContain('useUiDataVersion')
    expect(APP_SOURCE).not.toContain('controller.subscribe(')
  })

  it('订阅 appData 地址，启动加载与整包换代可触发 App 重渲染', () => {
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, refreshScopes.appData())')
    expect(APP_SOURCE).toContain('[appDataVersion, settingsVersion, data?.settings?.wallpaper]')
  })

  it('订阅 navigation 地址', () => {
    expect(APP_SOURCE).toContain('const navigationVersion = useScopedUiVersion(controller, refreshScopes.navigation())')
  })

  it('按当前目标与会话构造 session 地址', () => {
    expect(APP_SOURCE).toContain('refreshScopes.session(activeTargetKind, activeChatTargetId, activeChatId)')
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, activeSessionScope, !!activeSessionScope)')
  })

  it('没有当前会话时不建立 session 订阅', () => {
    expect(APP_SOURCE).toContain('activeChatId && activeChatTargetId')
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, activeSessionScope, !!activeSessionScope)')
  })

  it('订阅当前 target 的 chatList，标题/列表元数据更新不漏刷', () => {
    expect(APP_SOURCE).toContain('refreshScopes.chatList(activeTargetKind, activeChatTargetId)')
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, activeChatListScope, !!activeChatListScope)')
  })

  it('收藏夹树只订阅 entities:favorites', () => {
    expect(FAVORITE_FOLDERS_SOURCE).toContain("useScopedUiVersion(controller, refreshScopes.entities('favorites'))")
    expect(FAVORITE_FOLDERS_SOURCE).not.toContain('useUiDataVersion')
  })

  it('订阅 settings，并通过注册表订阅 uiShell 与实体/库/插件地址', () => {
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, refreshScopes.settings())')
    expect(APP_SOURCE).toContain('useScopedUiVersions(controller, APP_ROOT_REFRESH_SCOPES)')
    expect(APP_ROOT_REFRESH_SCOPES).toContain(refreshScopes.uiShell())
    expect(APP_ROOT_REFRESH_SCOPES).toContain(refreshScopes.entities('roles'))
    expect(APP_ROOT_REFRESH_SCOPES).toContain(refreshScopes.entities('tools'))
    expect(APP_ROOT_REFRESH_SCOPES).toContain(refreshScopes.entities('plugins'))
  })

  it('订阅 runCards；composer 由输入区自订阅，App 不跟着重渲染', () => {
    expect(APP_SOURCE).toContain('useScopedUiVersion(controller, refreshScopes.runCards())')
    expect(APP_SOURCE).not.toContain('useScopedUiVersion(controller, refreshScopes.composer())')
    expect(APP_SOURCE).toContain('[appDataVersion, runCardsVersion, activeChatListVersion, s, data]')
  })

  it('运行观测不再依赖全局数据版本', () => {
    expect(APP_SOURCE).not.toMatch(/useSessionRunObservations\(\{[\s\S]*?dataVersion/)
    expect(APP_SOURCE).toMatch(/activeChatId,\s*controller,\s*\}\)/)
  })
})
