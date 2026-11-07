import { WorkspaceIdentitySection } from './WorkspaceIdentitySection'

/** 基本信息分类：名称、描述备注与图标。 */
export function WorkspaceIdentityCategoryPanel(props: { controller: any; draft: any }) {
  return <WorkspaceIdentitySection controller={props.controller} draft={props.draft} />
}
