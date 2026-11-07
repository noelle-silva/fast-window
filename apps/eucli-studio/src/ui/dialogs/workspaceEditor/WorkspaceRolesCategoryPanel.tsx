import { WorkspaceRolesSection } from './WorkspaceRolesSection'

/** 角色注册分类：勾选加入当前工作区的角色。 */
export function WorkspaceRolesCategoryPanel(props: { controller: any; draft: any; roles: any[] }) {
  return <WorkspaceRolesSection controller={props.controller} draft={props.draft} roles={props.roles} />
}
