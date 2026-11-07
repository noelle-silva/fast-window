import type * as React from 'react'

/**
 * 分类编辑器的一个分类：切换栏与面板容器的唯一事实源。
 * 新增一个分类，只在各自模块的分类目录里加一条，再在编辑器外壳里挂上对应面板。
 */
export type CategoryEditorCategory<Id extends string = string> = {
  id: Id
  label: string
  /** 当前分类的一句话说明，显示在切换栏下方。 */
  hint: string
  icon: React.ElementType
}
