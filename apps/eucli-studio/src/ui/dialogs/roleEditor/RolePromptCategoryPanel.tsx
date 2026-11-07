import * as React from 'react'
import { CategoryEditorSection } from '../../components/categoryEditor/CategoryEditorSection'
import { RoleSystemPromptSection } from './RoleSystemPromptSection'

/**
 * 提示词编辑分类：这一屏锁死高度，不产生外层滚动。
 * 系统提示词文本框吃掉剩余空间，长内容只在文本框内部滚。
 */
export function RolePromptCategoryPanel(props: { controller: any; draft: any; placeholders?: any; systemPlugins?: any }) {
  const { controller, draft, placeholders, systemPlugins } = props
  return (
    <CategoryEditorSection fill title="系统提示词" description="支持 {{占位符}}；解析预览只读，不会改动保存的原文。">
      <RoleSystemPromptSection
        controller={controller}
        roleName={String(draft?.roleName || '')}
        value={String(draft?.roleSystemPrompt || '')}
        onChange={(next) => controller.actions.setDraft('roleSystemPrompt', next)}
        placeholders={placeholders}
        systemPlugins={systemPlugins}
      />
    </CategoryEditorSection>
  )
}
