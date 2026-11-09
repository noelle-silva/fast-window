// 会话收藏夹「一层」的数据形状：层级浏览一次只消费这一层的直接子级。
// 投影由 useFavoriteFolders 统一组装（会话标题、目标元信息、选中与运行态都在那里取），
// 组件只负责渲染与交互。

/** 一条收藏引用相对当前内存数据的状态。 */
export type FavoriteRefStatus =
  /** 会话已在内存：标题、摘要、运行态都可用。 */
  | 'loaded'
  /** 会话列表还没加载：先占位，点开或列表加载后转为 loaded。 */
  | 'pending'
  /** 会话列表已加载且找不到这条引用：真丢了，只能手动清理。 */
  | 'missing'

export type FavoriteFolderLevelEntry = {
  /** 引用键：收藏夹内的身份，排序与移动都认它。 */
  key: string
  targetKind: 'role' | 'group' | 'workspace'
  targetId: string
  roleId: string
  chatId: string
  /** 三态是唯一判定：界面不再各自猜「查不到」是什么意思。 */
  status: FavoriteRefStatus
  title: string
  snippet: string
  /** 所属实体名（角色 / 群 / 工作区）。 */
  targetName: string
  /** 工作区来源的条目：所属角色名，用于「工作区/角色」那一行。 */
  roleName: string
  targetImage: string
  /** 工作区来源的条目：所属角色头像，用于悬停换图标。 */
  roleAvatarImage: string
  selected: boolean
  /** 运行指示类型（沿用 ChatSessionRunIndicatorKind 的取值），空串表示不显示。 */
  runningKind: string
}

export type FavoriteFolderLevel = {
  folders: Array<{ id: string; name: string }>
  refs: FavoriteFolderLevelEntry[]
}
