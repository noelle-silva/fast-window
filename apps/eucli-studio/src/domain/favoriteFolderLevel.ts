// 会话收藏夹「一层」的数据形状：层级浏览一次只消费这一层的直接子级。
// 投影由 useFavoriteFolders 统一组装（会话标题、目标元信息、选中与运行态都在那里取），
// 组件只负责渲染与交互。

export type FavoriteFolderLevelEntry = {
  /** 引用键：收藏夹内的身份，排序与移动都认它。 */
  key: string
  targetKind: 'role' | 'group' | 'workspace'
  targetId: string
  roleId: string
  chatId: string
  title: string
  snippet: string
  targetName: string
  targetImage: string
  selected: boolean
  /** 运行指示类型（沿用 ChatSessionRunIndicatorKind 的取值），空串表示不显示。 */
  runningKind: string
}

export type FavoriteFolderLevel = {
  folders: Array<{ id: string; name: string }>
  refs: FavoriteFolderLevelEntry[]
}
