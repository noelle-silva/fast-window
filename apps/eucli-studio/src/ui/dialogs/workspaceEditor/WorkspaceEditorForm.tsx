import * as React from 'react'
import { Box, Stack } from '@mui/material'
import { CategoryEditorPanel } from '../../components/categoryEditor/CategoryEditorPanel'
import { CategoryEditorTabBar } from '../../components/categoryEditor/CategoryEditorTabBar'
import {
  DEFAULT_WORKSPACE_EDITOR_CATEGORY,
  WORKSPACE_EDITOR_CATEGORIES,
  workspaceEditorPanelDomId,
  workspaceEditorTabDomId,
  type WorkspaceEditorCategoryId,
} from './workspaceEditorCategories'
import { WorkspaceDirectoriesCategoryPanel } from './WorkspaceDirectoriesCategoryPanel'
import { WorkspaceIdentityCategoryPanel } from './WorkspaceIdentityCategoryPanel'
import { WorkspacePromptCategoryPanel } from './WorkspacePromptCategoryPanel'
import { WorkspaceRolesCategoryPanel } from './WorkspaceRolesCategoryPanel'

export type WorkspaceEditorFormProps = {
  controller: any
  draft: any
  roles: any[]
}

/** 把通用面板容器绑定到工作区分类的 DOM id 上。 */
function WorkspaceCategoryPanel(props: {
  categoryId: WorkspaceEditorCategoryId
  active: boolean
  scroll?: boolean
  children: React.ReactNode
}) {
  const { categoryId, active, scroll, children } = props
  return (
    <CategoryEditorPanel
      active={active}
      scroll={scroll}
      tabId={workspaceEditorTabDomId(categoryId)}
      panelId={workspaceEditorPanelDomId(categoryId)}
    >
      {children}
    </CategoryEditorPanel>
  )
}

/**
 * 工作区编辑外壳：与角色编辑同一套布局——顶部切换栏固定，下面是一个高度受约束的面板槽。
 * 滚动权在各自的面板里（见 CategoryEditorPanel），
 * 所以「提示词」这类面板可以把高度锁死、让文本域自己适配剩余空间。
 * 高度全部由 flex 分配（不用百分比高度），调用方只需给一个高度确定的列容器。
 */
export function WorkspaceEditorForm(props: WorkspaceEditorFormProps) {
  const { controller, draft, roles } = props
  const [category, setCategory] = React.useState<WorkspaceEditorCategoryId>(DEFAULT_WORKSPACE_EDITOR_CATEGORY)

  return (
    <Stack spacing={1.5} sx={{ flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>
      <CategoryEditorTabBar
        categories={WORKSPACE_EDITOR_CATEGORIES}
        value={category}
        onChange={setCategory}
        ariaLabel="工作区编辑分类"
        tabId={workspaceEditorTabDomId}
        panelId={workspaceEditorPanelDomId}
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>
        <WorkspaceCategoryPanel categoryId="identity" active={category === 'identity'}>
          <WorkspaceIdentityCategoryPanel controller={controller} draft={draft} />
        </WorkspaceCategoryPanel>

        <WorkspaceCategoryPanel categoryId="directories" active={category === 'directories'}>
          <WorkspaceDirectoriesCategoryPanel controller={controller} draft={draft} />
        </WorkspaceCategoryPanel>

        {/* 提示词面板锁死高度：外层不滚，滚动只发生在提示词文本框内部。 */}
        <WorkspaceCategoryPanel categoryId="prompt" active={category === 'prompt'} scroll={false}>
          <WorkspacePromptCategoryPanel controller={controller} draft={draft} />
        </WorkspaceCategoryPanel>

        <WorkspaceCategoryPanel categoryId="roles" active={category === 'roles'}>
          <WorkspaceRolesCategoryPanel controller={controller} draft={draft} roles={roles} />
        </WorkspaceCategoryPanel>
      </Box>
    </Stack>
  )
}
