import type { CategoryEditorCategory } from '../../components/categoryEditor/categoryEditorTypes'
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'

// 工作区编辑的分类目录：切换栏与面板容器的唯一事实源。
// 新增一个分类只需在这里加一条，再在 WorkspaceEditorForm 里挂上对应面板。
export type WorkspaceEditorCategoryId = 'identity' | 'prompt' | 'roles' | 'directories'

export const WORKSPACE_EDITOR_CATEGORIES: readonly CategoryEditorCategory<WorkspaceEditorCategoryId>[] = [
  {
    id: 'identity',
    label: '基本信息',
    hint: '工作区名称、描述备注与图标。',
    icon: TuneOutlinedIcon,
  },
  {
    id: 'directories',
    label: '目录清单',
    hint: '登记目录路径、别名与用途；失效目录会标记为需要修复。',
    icon: FolderOutlinedIcon,
  },
  {
    id: 'prompt',
    label: '提示词',
    hint: '编写工作区提示词，可切换查看后台生成的实际提示词。',
    icon: EditNoteOutlinedIcon,
  },
  {
    id: 'roles',
    label: '角色注册',
    hint: '勾选要加入当前工作区的角色，保存工作区后生效。',
    icon: GroupOutlinedIcon,
  },
]

export const DEFAULT_WORKSPACE_EDITOR_CATEGORY: WorkspaceEditorCategoryId = 'identity'

export function workspaceEditorTabDomId(categoryId: WorkspaceEditorCategoryId) {
  return `workspace-editor-tab-${categoryId}`
}

export function workspaceEditorPanelDomId(categoryId: WorkspaceEditorCategoryId) {
  return `workspace-editor-panel-${categoryId}`
}
