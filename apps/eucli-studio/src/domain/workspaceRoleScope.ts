function text(value: unknown) {
  return String(value || '').trim()
}

export function workspaceRegisteredRoleIds(workspaceRaw: unknown) {
  const list = Array.isArray((workspaceRaw as any)?.registeredRoleIds)
    ? ((workspaceRaw as any).registeredRoleIds as unknown[])
    : []
  return Array.from(new Set(list.map(text).filter(Boolean)))
}

export function workspaceRolesInScope(workspaceRaw: unknown, rolesRaw: unknown) {
  const roles = Array.isArray(rolesRaw) ? rolesRaw : []
  const registered = new Set(workspaceRegisteredRoleIds(workspaceRaw))
  if (!registered.size) return []
  return roles.filter((role: any) => registered.has(text(role?.id)))
}

export function isWorkspaceRoleRegistered(workspaceRaw: unknown, roleIdRaw: unknown) {
  const roleId = text(roleIdRaw)
  if (!roleId) return false
  return workspaceRegisteredRoleIds(workspaceRaw).includes(roleId)
}
