import * as React from 'react'
import { Stack } from '@mui/material'
import { PlaceholderSearchSection } from '../PlaceholderSearchSection'
import { CategoryEditorSection } from '../../components/categoryEditor/CategoryEditorSection'
import { RoleHookPromptSection } from './RoleHookPromptSection'
import { RoleIdentitySection } from './RoleIdentitySection'
import { RoleTemperatureSection } from './RoleTemperatureSection'

/** 其他配置分类：角色身份、温度、默认 hook 提示词与占位符库。 */
export function RoleOtherCategoryPanel(props: {
  controller: any
  draft: any
  hookPrompts?: any
  placeholders?: any
  systemPlugins?: any
}) {
  const { controller, draft, hookPrompts, placeholders, systemPlugins } = props
  return (
    <Stack spacing={2}>
      <RoleIdentitySection controller={controller} draft={draft} />
      <RoleTemperatureSection controller={controller} draft={draft} />
      <RoleHookPromptSection controller={controller} draft={draft} hookPrompts={hookPrompts} />
      <CategoryEditorSection title="占位符" description="搜索后点击条目即可编辑内容并保存，复制按钮给你 {{名称}} 形式的写法。">
        <PlaceholderSearchSection controller={controller} placeholders={placeholders} systemPlugins={systemPlugins} />
      </CategoryEditorSection>
    </Stack>
  )
}
