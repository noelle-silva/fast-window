import type * as React from 'react'
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined'
import HandymanOutlinedIcon from '@mui/icons-material/HandymanOutlined'
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'

// 角色编辑的分类目录：切换栏与面板容器的唯一事实源。
// 新增一个分类只需在这里加一条，再在 RoleEditorForm 里挂上对应面板。
export type RoleEditorCategoryId = 'model' | 'prompt' | 'tools' | 'other'

export type RoleEditorCategory = {
  id: RoleEditorCategoryId
  label: string
  /** 当前分类的一句话说明，显示在切换栏下方。 */
  hint: string
  icon: React.ElementType
}

export const ROLE_EDITOR_CATEGORIES: RoleEditorCategory[] = [
  {
    id: 'model',
    label: '模型配置',
    hint: '选择供应商或模型组，维护候选模型池与默认模型。',
    icon: MemoryOutlinedIcon,
  },
  {
    id: 'prompt',
    label: '提示词编辑',
    hint: '编写系统提示词，可随时查看占位符解析预览与依赖树。',
    icon: EditNoteOutlinedIcon,
  },
  {
    id: 'tools',
    label: '工具配置',
    hint: '维护工具白名单，为每个工具设置执行方式与是否传递工具提示词。',
    icon: HandymanOutlinedIcon,
  },
  {
    id: 'other',
    label: '其他配置',
    hint: '角色名、头像与描述备注、温度、默认 hook 提示词、占位符。',
    icon: TuneOutlinedIcon,
  },
]

export const DEFAULT_ROLE_EDITOR_CATEGORY: RoleEditorCategoryId = 'model'

export function roleEditorTabDomId(categoryId: RoleEditorCategoryId) {
  return `role-editor-tab-${categoryId}`
}

export function roleEditorPanelDomId(categoryId: RoleEditorCategoryId) {
  return `role-editor-panel-${categoryId}`
}
