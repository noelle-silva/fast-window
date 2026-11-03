// App 根表面刷新地址注册表：根组件 domainVersion 的唯一订阅来源。
//
// 约定：
// - 根表面需要因实体变化而重渲染时，只登记到这里，不在 App.tsx 手写地址数组。
// - 新增实体域后，appRefreshScopes.contract.test 会扫描控制器发射点：
//   未登记且未显式排除的域会直接失败，避免“数据变了但没人消费”的静默漏刷。
// - 根表面不订阅 global；实体域必须用实体地址精确触发。
// - 由更窄的 hook / 面板自订阅的域登记到排除清单，并写明实际消费者。
import { refreshScopes } from './uiRefreshScope'

// 根表面直接读取的实体域。
// 这些数据会被就地修改，App 的派生（角色默认模型、供应商候选、壳层展示等）
// 依赖实体版本穿透 memo。
export const APP_ROOT_ENTITY_DOMAINS = [
  'roles',
  'groups',
  'workspaces',
  'providers',
  'modelGroups',
  'tools',
  'hookPrompts',
  'placeholders',
  'plugins',
  'accessSettings',
  'requestRecords',
  'modelRequestConfig',
  'conversationImageConfig',
  'toolWorkDirectory',
] as const

// App 根 domainVersion 的完整订阅集合：壳层路由 + 根表面实体域。
export const APP_ROOT_REFRESH_SCOPES: readonly string[] = [
  refreshScopes.uiShell(),
  ...APP_ROOT_ENTITY_DOMAINS.map((domain) => refreshScopes.entities(domain)),
]

// 已发射但明确不需要 App 根 domainVersion 订阅的实体域。
// 值必须是实际消费者说明，禁止用“暂不需要”之类的空理由占位。
export const APP_ROOT_EXCLUDED_ENTITY_DOMAINS: Readonly<Record<string, string>> = {
  favorites: '收藏夹树由 useFavoriteFolders 自行订阅 entities:favorites，App 根不重复订阅。',
}
