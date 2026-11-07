import * as React from 'react'
import { CategoryEditorSection } from '../../components/categoryEditor/CategoryEditorSection'
import { RoleToolsSection } from './RoleToolsSection'

/** 工具配置分类：白名单 + 每个工具的执行方式与工具提示词开关。 */
export function RoleToolsCategoryPanel(props: { controller: any; draft: any; tools: any }) {
  const { controller, draft, tools } = props
  return (
    <CategoryEditorSection title="工具白名单">
      <RoleToolsSection controller={controller} draft={draft} tools={tools} />
    </CategoryEditorSection>
  )
}
