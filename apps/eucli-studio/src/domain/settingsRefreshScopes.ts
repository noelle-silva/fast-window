// 设置页刷新地址注册表：每个设置分类声明自己读取哪些刷新地址。
//
// 约定：
// - 设置面板不依赖 App 侧的手工依赖清单；面板宿主只订阅这里声明的地址。
// - 新增设置分类时，SettingsTabValue 会扩展，本文件的 Record 必须补键，
//   否则类型检查失败（这是“忘记登记”的第一道闸）。
// - 新增会进入设置页的数据域时，必须把 entities:<domain> 放进对应分类；
//   settingsRefreshScopes.contract.test 会扫描控制器发射点，未登记的域会失败。
// - appData 覆盖启动加载 / 整包替换；它低频但影响所有面板的数据来源。
import type { SettingsTabValue } from './settingsNavigation'
import { refreshScopes } from './uiRefreshScope'

const APP_DATA = refreshScopes.appData()
const SETTINGS = refreshScopes.settings()
const NAVIGATION = refreshScopes.navigation()
const UI_SHELL = refreshScopes.uiShell()

function entity(domain: string) {
  return refreshScopes.entities(domain)
}

// 设置页壳层事实：导航排序与透明背景都来自 data.settings。
// 只有壳层订阅它们，不要求每个面板各自订阅。
export const SETTINGS_PAGE_CHROME_REFRESH_SCOPES: readonly string[] = [APP_DATA, SETTINGS]

// 每个分类的地址集合必须覆盖该分类面板真正读取的数据域。
// 这里只放“该面板会因之变化”的地址，不放全局广播。
export const SETTINGS_PANEL_REFRESH_SCOPES: Record<SettingsTabValue, readonly string[]> = {
  tools: [APP_DATA, entity('tools'), entity('toolWorkDirectory')],
  systemPlugins: [APP_DATA, entity('plugins')],
  roles: [
    APP_DATA,
    entity('roles'),
    entity('providers'),
    entity('modelGroups'),
    entity('tools'),
    entity('hookPrompts'),
    entity('placeholders'),
    NAVIGATION,
    UI_SHELL,
  ],
  providers: [APP_DATA, entity('providers'), UI_SHELL],
  modelGroups: [APP_DATA, entity('modelGroups'), entity('providers')],
  placeholders: [APP_DATA, entity('placeholders'), entity('plugins')],
  hookPrompts: [APP_DATA, entity('hookPrompts')],
  promptLibrary: [APP_DATA],
  tasks: [APP_DATA],
  session: [APP_DATA, entity('modelRequestConfig'), entity('conversationImageConfig')],
  workspaces: [APP_DATA, entity('workspaces'), entity('roles'), NAVIGATION, UI_SHELL],
  groups: [APP_DATA, entity('groups'), entity('roles'), NAVIGATION, UI_SHELL],
  services: [APP_DATA, SETTINGS, entity('providers'), entity('modelGroups')],
  eb: [],
  appearance: [APP_DATA, SETTINGS],
  stickers: [APP_DATA, SETTINGS],
  commandSystem: [],
  access: [APP_DATA, entity('accessSettings')],
  requestRecords: [APP_DATA, entity('requestRecords'), SETTINGS],
  data: [APP_DATA],
}

// 设置页完整地址并集：用于契约测试与诊断，不用于面板订阅。
export const SETTINGS_PAGE_REFRESH_SCOPES: readonly string[] = Array.from(
  new Set([
    ...SETTINGS_PAGE_CHROME_REFRESH_SCOPES,
    ...Object.values(SETTINGS_PANEL_REFRESH_SCOPES).flat(),
  ]),
)

export function settingsPanelRefreshScopes(tab: SettingsTabValue): readonly string[] {
  return SETTINGS_PANEL_REFRESH_SCOPES[tab]
}
