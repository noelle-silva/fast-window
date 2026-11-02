// 刷新范围地址：把“哪里变了”变成可比较的字符串标签。
//
// 约定：
// - 所有地址都必须由本文件的构造器产出，禁止调用方散落手拼字符串。
// - 地址只用于字符串相等比较，不需要反解析。
// - 缺少必要身份（targetId / chatId / mid）时退化为 global 安全阀，
//   保证不会产生“无人监听”的残废地址而漏刷。

export const GLOBAL_REFRESH_SCOPE = 'global'

// 整包数据范围：启动加载、epoch 换代、整份数据替换与 state.loading 变化。
// 频率极低，但影响 App 根的所有派生，不能拆成普通实体地址。
export const APP_DATA_REFRESH_SCOPE = 'appData'

// 输入区范围：输入草稿与草稿图片的变化只该动输入区，不惊动整页。
export const COMPOSER_REFRESH_SCOPE = 'composer'

// 壳层范围：页面路由、设置页显隐/页签、顶栏/侧栏布局、树开关。
export const UI_SHELL_REFRESH_SCOPE = 'uiShell'

// 全局设置范围：外观、主题、字体、壁纸、渲染策略、贴纸开关等。
export const SETTINGS_REFRESH_SCOPE = 'settings'

// 导航范围：活动 target 与 activeChatId 的选中事实。
export const NAVIGATION_REFRESH_SCOPE = 'navigation'

// 运行卡范围：全库运行卡与运行会话清单。
export const RUN_CARDS_REFRESH_SCOPE = 'runCards'

export type RefreshTargetKind = 'role' | 'group' | 'workspace'

function segment(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function scopedAddress(prefix: string, parts: readonly unknown[]): string {
  const segments = parts.map(segment)
  if (segments.some((part) => !part)) return GLOBAL_REFRESH_SCOPE
  return `${prefix}:${segments.join(':')}`
}

// 统一地址目录：消费者按语义取地址，不关心分隔符与转义。
export const refreshScopes = {
  global: () => GLOBAL_REFRESH_SCOPE,
  appData: () => APP_DATA_REFRESH_SCOPE,
  uiShell: (section?: unknown) => {
    const part = segment(section)
    return part ? `${UI_SHELL_REFRESH_SCOPE}:${part}` : UI_SHELL_REFRESH_SCOPE
  },
  settings: () => SETTINGS_REFRESH_SCOPE,
  entities: (domain: unknown) => scopedAddress('entities', [domain]),
  navigation: () => NAVIGATION_REFRESH_SCOPE,
  chatList: (kind: RefreshTargetKind, targetId: unknown) => scopedAddress('chatList', [kind, targetId]),
  session: (kind: RefreshTargetKind, targetId: unknown, chatId: unknown) => scopedAddress('session', [kind, targetId, chatId]),
  message: (kind: RefreshTargetKind, targetId: unknown, chatId: unknown, mid: unknown) =>
    scopedAddress('message', [kind, targetId, chatId, mid]),
  composer: () => COMPOSER_REFRESH_SCOPE,
  overlays: (name: unknown) => scopedAddress('overlays', [name]),
  runCards: () => RUN_CARDS_REFRESH_SCOPE,
}

// 旧协议兼容：只带 messageId 的历史地址。
// 新代码必须使用 refreshScopes.message(kind, targetId, chatId, mid)，
// 避免不同会话的同名消息撞地址。
export function messageRefreshScope(mid: unknown) {
  return scopedAddress('message', [mid])
}
