function text(value: unknown) {
  return String(value || '').trim()
}

export function normalizeWorkspaceDirectories(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const directory = item && typeof item === 'object' ? (item as any) : {}
      return {
        path: text(directory.path),
        alias: text(directory.alias),
        description: text(directory.description),
      }
    })
    .filter((directory) => directory.path || directory.alias || directory.description)
}

export function normalizeWorkspaceRoleIds(value: unknown) {
  return (Array.isArray(value) ? value : []).map((roleId) => text(roleId)).filter(Boolean)
}

// workspaceWriteSnapshot 只覆盖「一次保存真正写入的字段」：
// actualPrompt 是派生的预览结果，createdAt / updatedAt 是时间戳，均不参与比对。
function workspaceWriteSnapshot(workspace: any) {
  return {
    id: text(workspace?.id),
    name: text(workspace?.name) || '未命名工作区',
    description: text(workspace?.description),
    prompt: text(workspace?.prompt),
    directories: normalizeWorkspaceDirectories(workspace?.directories),
    registeredRoleIds: normalizeWorkspaceRoleIds(workspace?.registeredRoleIds),
  }
}

// workspaceMatchesWrite 判断权威实体是否已经是本次写入后的值：
// 用于「写结果未知 → 回读」时决定保留本地还是回滚。
export function workspaceMatchesWrite(remote: any, intended: any): boolean {
  return JSON.stringify(workspaceWriteSnapshot(remote)) === JSON.stringify(workspaceWriteSnapshot(intended))
}
