import * as React from 'react'
import { Box, Stack } from '@mui/material'
import { DEFAULT_ROLE_EDITOR_CATEGORY, type RoleEditorCategoryId } from './roleEditorCategories'
import { RoleEditorCategoryPanel } from './RoleEditorLayout'
import { RoleEditorTabBar } from './RoleEditorTabBar'
import { RoleModelCategoryPanel } from './RoleModelCategoryPanel'
import { RoleOtherCategoryPanel } from './RoleOtherCategoryPanel'
import { RolePromptCategoryPanel } from './RolePromptCategoryPanel'
import { RoleToolsCategoryPanel } from './RoleToolsCategoryPanel'

export type RoleEditorFormProps = {
  controller: any
  providers: any[]
  modelGroups: any[]
  draft: any
  models: any
  tools: any
  hookPrompts?: any
  placeholders?: any
  systemPlugins?: any
  /** 打开时落在哪个分类；新建角色通常先让用户填角色名。 */
  defaultCategory?: RoleEditorCategoryId
}

/**
 * 角色编辑外壳：顶部切换栏固定，下面是一个高度受约束的面板槽。
 * 滚动权在各自的面板里（见 RoleEditorCategoryPanel），
 * 所以「提示词编辑」这类面板可以把高度锁死、让内容自己适配剩余空间。
 * 高度全部由 flex 分配（不用百分比高度），调用方只需给一个高度确定的列容器。
 */
export function RoleEditorForm(props: RoleEditorFormProps) {
  const { controller, providers, modelGroups, draft, models, tools, hookPrompts, placeholders, systemPlugins, defaultCategory } = props

  const [category, setCategory] = React.useState<RoleEditorCategoryId>(defaultCategory || DEFAULT_ROLE_EDITOR_CATEGORY)

  // 头像裁剪未完成时保存会被拦住，而裁剪器在「其他配置」里，用切换栏上的提示点把它带出来。
  const attentionCategories = React.useMemo<RoleEditorCategoryId[]>(
    () => (String(draft?.roleAvatarImageCropSrc || '').trim() ? ['other'] : []),
    [draft?.roleAvatarImageCropSrc],
  )

  return (
    <Stack spacing={1.5} sx={{ flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>
      <RoleEditorTabBar value={category} onChange={setCategory} attentionCategories={attentionCategories} />

      <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>
        <RoleEditorCategoryPanel categoryId="model" active={category === 'model'}>
          <RoleModelCategoryPanel
            controller={controller}
            providers={providers}
            modelGroups={modelGroups}
            draft={draft}
            models={models}
          />
        </RoleEditorCategoryPanel>

        {/* 提示词面板锁死高度：外层不滚，滚动只发生在系统提示词文本框内部。 */}
        <RoleEditorCategoryPanel categoryId="prompt" active={category === 'prompt'} scroll={false}>
          <RolePromptCategoryPanel
            controller={controller}
            draft={draft}
            placeholders={placeholders}
            systemPlugins={systemPlugins}
          />
        </RoleEditorCategoryPanel>

        <RoleEditorCategoryPanel categoryId="tools" active={category === 'tools'}>
          <RoleToolsCategoryPanel controller={controller} draft={draft} tools={tools} />
        </RoleEditorCategoryPanel>

        <RoleEditorCategoryPanel categoryId="other" active={category === 'other'}>
          <RoleOtherCategoryPanel
            controller={controller}
            draft={draft}
            hookPrompts={hookPrompts}
            placeholders={placeholders}
            systemPlugins={systemPlugins}
          />
        </RoleEditorCategoryPanel>
      </Box>
    </Stack>
  )
}
