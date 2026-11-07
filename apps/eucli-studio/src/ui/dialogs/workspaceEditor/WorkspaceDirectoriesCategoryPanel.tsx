import { WorkspaceDirectoriesSection } from './WorkspaceDirectoriesSection'

/** 目录清单分类：登记、修复与删除目录。 */
export function WorkspaceDirectoriesCategoryPanel(props: { controller: any; draft: any }) {
  return <WorkspaceDirectoriesSection controller={props.controller} draft={props.draft} />
}
