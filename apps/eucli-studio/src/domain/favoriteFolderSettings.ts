// 会话收藏夹的客户端外观偏好：跟着 settings 走，不进后端收藏夹数据。
// 与工作桌面同一条规则，但两处开关各自独立，默认都开着。

export const FAVORITE_HOVER_ROLE_ICON_SETTING_KEY = 'favoriteHoverShowsRoleIcon'
export const FAVORITE_HOVER_ROLE_ICON_DEFAULT = true

export function normalizeFavoriteHoverRoleIcon(raw: unknown): boolean {
  if (raw === undefined || raw === null) return FAVORITE_HOVER_ROLE_ICON_DEFAULT
  return raw === true
}
