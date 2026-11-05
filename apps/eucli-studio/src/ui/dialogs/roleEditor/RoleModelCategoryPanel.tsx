import * as React from 'react'
import { RoleEditorSection } from './RoleEditorLayout'
import { RoleModelSection } from './RoleModelSection'

/** 模型配置分类：先挑选模型加入候选池，再从池里指定默认模型。 */
export function RoleModelCategoryPanel(props: {
  controller: any
  providers: any[]
  modelGroups: any[]
  draft: any
  models: any
}) {
  const { controller, providers, modelGroups, draft, models } = props
  return (
    <RoleEditorSection title="模型与候选池" description="候选池是角色模型的唯一事实源，默认模型只是池内一项的引用。">
      <RoleModelSection controller={controller} providers={providers} modelGroups={modelGroups} draft={draft} models={models} />
    </RoleEditorSection>
  )
}
