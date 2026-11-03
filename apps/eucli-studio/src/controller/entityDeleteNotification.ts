import { refreshScopes } from '../domain/uiRefreshScope'

// 删除动作与删除通知解耦：默认由删除动作自己通知；
// 确认删除由调用方接管，保证一次用户操作只发一份地址。
export type EntityDeleteOptions = {
  notify?: boolean
}

export function shouldNotifyEntityDelete(options?: EntityDeleteOptions): boolean {
  return options?.notify !== false
}

export type DeleteConfirmationTargets = {
  role: boolean
  group: boolean
  workspace: boolean
  provider: boolean
  settingsChanged: boolean
}

export function deleteConfirmationScopes(targets: DeleteConfirmationTargets): string[] {
  const scopes: string[] = []
  if (targets.role) scopes.push(refreshScopes.entities('roles'))
  if (targets.group) scopes.push(refreshScopes.entities('groups'))
  if (targets.workspace) scopes.push(refreshScopes.entities('workspaces'))
  if (targets.provider) scopes.push(refreshScopes.entities('providers'))
  // 角色 / 群组 / 工作区删除会改变活动 target 或 chat 选中事实。
  if (targets.role || targets.group || targets.workspace) scopes.push(refreshScopes.navigation())
  if (targets.settingsChanged) scopes.push(refreshScopes.settings())
  scopes.push(refreshScopes.uiShell())
  return scopes
}
