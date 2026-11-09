// 侧边栏顶部切换栏的外观样式：这里是唯一清单，界面与配置都从它取。
// 每一种对应一套纯样式，不改变切换行为本身（点击、键盘、读屏结构都不变）。

export type SidebarTabsVariant =
  | 'soft'
  | 'mui'
  | 'pill'
  | 'underline'
  | 'segmented'
  | 'bracket'
  | 'rail'
  | 'dot'
  | 'lift'
  | 'fill'
  | 'icon'

export const SIDEBAR_TABS_VARIANT_OPTIONS: readonly { value: SidebarTabsVariant; label: string }[] = [
  { value: 'soft', label: '柔光胶囊' },
  { value: 'mui', label: '经典下划线' },
  { value: 'pill', label: '滑动药丸' },
  { value: 'underline', label: '游标下划线' },
  { value: 'segmented', label: '分体卡片' },
  { value: 'bracket', label: '括号夹持' },
  { value: 'rail', label: '左侧竖条' },
  { value: 'dot', label: '圆点指示' },
  { value: 'lift', label: '抬浮标签' },
  { value: 'fill', label: '填充进度' },
  { value: 'icon', label: '图标联动' },
]

export const SIDEBAR_TABS_VARIANT_DEFAULT: SidebarTabsVariant = 'soft'

const VARIANT_VALUES = new Set<string>(SIDEBAR_TABS_VARIANT_OPTIONS.map((it) => it.value))

export function normalizeSidebarTabsVariant(raw: unknown): SidebarTabsVariant {
  const text = String(raw ?? '').trim()
  return VARIANT_VALUES.has(text) ? (text as SidebarTabsVariant) : SIDEBAR_TABS_VARIANT_DEFAULT
}
