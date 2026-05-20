export type AssistantArtifactCleanupOptions = {
  resetRuntime?: boolean
}

type AssistantArtifactCleanupDeps = {
  uiStreamCache: Map<string, any>
  resetAssistantRuntime: (messageId: string) => Promise<void>
}

function uniqueMessageIds(messageIds: Iterable<any>) {
  const ids: string[] = []
  const seen = new Set<string>()

  for (const value of messageIds || []) {
    const id = String(value || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  return ids
}

function describeError(error: any) {
  return String(error?.message || error || '未知错误')
}

export function createAssistantArtifactCleanup(deps: AssistantArtifactCleanupDeps) {
  async function cleanup(messageIds: Iterable<any>, options: AssistantArtifactCleanupOptions = {}) {
    const ids = uniqueMessageIds(messageIds)
    if (!ids.length) return

    const failures: string[] = []
    for (const id of ids) {
      deps.uiStreamCache.delete(id)

      if (!options.resetRuntime) continue
      try {
        await deps.resetAssistantRuntime(id)
      } catch (error) {
        failures.push(`${id} 运行态：${describeError(error)}`)
      }
    }

    if (failures.length) {
      const first = failures[0]
      const suffix = failures.length > 1 ? ` 等 ${failures.length} 项` : ''
      throw new Error(`消息变更已提交，但运行态清理失败：${first}${suffix}`)
    }
  }

  return { cleanup }
}
