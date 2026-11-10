// 会话来源：一条会话挂在谁名下。
// 角色会话只有角色名；工作区会话带上所属角色，写成「工作区名/角色名」；群聊就是群名。
// 桌面的来源字样、整行的悬停说明、收藏夹层级浏览的同一行都从这一处取口径，
// 免得同一种格式在三处各写一份三元表达式。
export type SessionSource = {
  targetKind: 'role' | 'group' | 'workspace'
  targetName: string
  roleName: string
}

/** 工作区来源把所属角色接在目标名后面；其余来源只用目标名。 */
export function sessionSourceLabel(source: SessionSource): string {
  const target = String(source.targetName || '').trim()
  const role = String(source.roleName || '').trim()
  if (source.targetKind === 'workspace' && role) return target ? `${target}/${role}` : role
  return target
}
