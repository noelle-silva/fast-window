import * as React from 'react'
import { moveCollectionNode } from './collectionsTree'
import type {
  AppSettings,
  CollectionsDoc,
  CommandDraft,
  CommandItem,
  CommandRunMode,
  DirectClient,
  ProcessOwnership,
  Repo,
  ShellInfo,
} from './types'

type CommandRunnerData = {
  settings: AppSettings | null
  shells: ShellInfo[]
  repos: Repo[]
  commands: CommandItem[]
  collections: CollectionsDoc | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  actions: CommandRunnerActions
}

type CommandRunnerActions = {
  createRepo: (name: string, path: string, closeMode: string, countdownSeconds: number, runMode: CommandRunMode | '', processOwnership: ProcessOwnership) => Promise<void>
  updateRepo: (id: string, name: string, path: string, closeMode: string, countdownSeconds: number, runMode: CommandRunMode | '', processOwnership: ProcessOwnership) => Promise<void>
  deleteRepo: (id: string) => Promise<void>
  reorderRepos: (orderedIds: string[]) => Promise<void>
  createCommand: (draft: CommandDraft) => Promise<void>
  updateCommand: (id: string, draft: CommandDraft) => Promise<void>
  deleteCommand: (id: string) => Promise<void>
  createFolder: (repoId: string, parentId: string, name: string) => Promise<void>
  renameFolder: (folderId: string, name: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  moveNode: (nodeId: string, targetFolderId: string, index: number) => Promise<void>
  runCommand: (id: string) => Promise<void>
  saveSettings: (draft: SettingsDraft) => Promise<void>
  addCustomShell: (name: string, exePath: string, argsTemplate: string) => Promise<void>
  removeCustomShell: (id: string) => Promise<void>
}

export type SettingsDraft = {
  defaultShellId: string
  defaultCloseMode: string
  defaultCountdownSeconds: number
  defaultRunMode: CommandRunMode
  defaultProcessOwnership: ProcessOwnership
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

export function useCommandRunnerData(client: DirectClient | null): CommandRunnerData {
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [shells, setShells] = React.useState<ShellInfo[]>([])
  const [repos, setRepos] = React.useState<Repo[]>([])
  const [commands, setCommands] = React.useState<CommandItem[]>([])
  const [collections, setCollections] = React.useState<CollectionsDoc | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!client) return
    setLoading(true)
    try {
      const [nextSettings, nextShells, nextRepos, nextCommands, nextCollections] = await Promise.all([
        client.request<AppSettings>('commandRunner.settings.get'),
        client.request<{ shells: ShellInfo[] }>('commandRunner.terminals.list'),
        client.request<{ repos: Repo[] }>('commandRunner.repos.list'),
        client.request<{ commands: CommandItem[] }>('commandRunner.commands.list', {}),
        client.request<CollectionsDoc>('commandRunner.collections.list'),
      ])
      setSettings(nextSettings)
      setShells(nextShells.shells)
      setRepos(nextRepos.repos)
      setCommands(nextCommands.commands)
      setCollections(nextCollections)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, '读取数据失败'))
    } finally {
      setLoading(false)
    }
  }, [client])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const actions = React.useMemo<CommandRunnerActions>(() => {
    if (!client) {
      const unavailable = async (): Promise<never> => {
        throw new Error('后台未连接')
      }
      return {
        createRepo: unavailable,
        updateRepo: unavailable,
        deleteRepo: unavailable,
        reorderRepos: unavailable,
        createCommand: unavailable,
        updateCommand: unavailable,
        deleteCommand: unavailable,
        createFolder: unavailable,
        renameFolder: unavailable,
        deleteFolder: unavailable,
        moveNode: unavailable,
        runCommand: unavailable,
        saveSettings: unavailable,
        addCustomShell: unavailable,
        removeCustomShell: unavailable,
      }
    }

    const mutate = async (method: string, params: unknown) => {
      await client.request(method, params)
      await refresh()
    }

    // 排序采用乐观更新：本地先按新顺序落位；请求结束后统一以服务端数据为准
    // （成功即确认，失败即回滚），错误向上抛出由界面提示。
    const mutateOrder = async (request: () => Promise<unknown>, optimistic: () => void) => {
      optimistic()
      try {
        await request()
      } finally {
        await refresh()
      }
    }

    // applyLocalOrder 将命中的条目按新顺序放回各自原位置，其余条目保持不动，
    // 与后端「仓库子集重排」的合并语义一致。
    const applyLocalOrder = <T extends { id: string }>(current: T[], orderedIds: string[]): T[] => {
      const byId = new Map(current.map(item => [item.id, item]))
      const reordered = orderedIds
        .map(id => byId.get(id))
        .filter((item): item is T => Boolean(item))
      if (reordered.length !== orderedIds.length) return current
      const ordered = new Set(orderedIds)
      let cursor = 0
      return current.map(item => (ordered.has(item.id) ? reordered[cursor++] : item))
    }

    return {
      createRepo: (name, path, closeMode, countdownSeconds, runMode, processOwnership) => mutate('commandRunner.repos.create', { name, path, closeMode, countdownSeconds, runMode, processOwnership }),
      updateRepo: (id, name, path, closeMode, countdownSeconds, runMode, processOwnership) => mutate('commandRunner.repos.update', { id, name, path, closeMode, countdownSeconds, runMode, processOwnership }),
      deleteRepo: id => mutate('commandRunner.repos.delete', { id }),
      reorderRepos: orderedIds => mutateOrder(
        () => client.request('commandRunner.repos.reorder', { orderedIds }),
        () => setRepos(current => applyLocalOrder(current, orderedIds)),
      ),
      createCommand: draft => mutate('commandRunner.commands.create', draft),
      updateCommand: (id, draft) => mutate('commandRunner.commands.update', { id, draft }),
      deleteCommand: id => mutate('commandRunner.commands.delete', { id }),
      createFolder: (repoId, parentId, name) => mutate('commandRunner.collections.create', { repoId, parentId, name }),
      renameFolder: (folderId, name) => mutate('commandRunner.collections.rename', { folderId, name }),
      deleteFolder: folderId => mutate('commandRunner.collections.delete', { folderId }),
      moveNode: (nodeId, targetFolderId, index) => mutateOrder(
        () => client.request('commandRunner.collections.move', { nodeId, targetFolderId, index }),
        () => setCollections(current => current
          ? { ...current, nodes: moveCollectionNode(current.nodes, nodeId, targetFolderId, index) }
          : current),
      ),
      runCommand: id => mutate('commandRunner.commands.run', { id }),
      saveSettings: draft => mutate('commandRunner.settings.save', draft),
      addCustomShell: (name, exePath, argsTemplate) =>
        mutate('commandRunner.shells.custom.add', { name, exePath, argsTemplate }),
      removeCustomShell: id => mutate('commandRunner.shells.custom.remove', { id }),
    }
  }, [client, refresh])

  return { settings, shells, repos, commands, collections, loading, error, refresh, actions }
}
