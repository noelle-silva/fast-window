import * as React from 'react'
import type {
  AppSettings,
  CommandDraft,
  CommandItem,
  DirectClient,
  Repo,
  ShellInfo,
} from './types'

type CommandRunnerData = {
  settings: AppSettings | null
  shells: ShellInfo[]
  repos: Repo[]
  commands: CommandItem[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  actions: CommandRunnerActions
}

type CommandRunnerActions = {
  createRepo: (name: string, path: string) => Promise<void>
  updateRepo: (id: string, name: string, path: string) => Promise<void>
  deleteRepo: (id: string) => Promise<void>
  createCommand: (draft: CommandDraft) => Promise<void>
  updateCommand: (id: string, draft: CommandDraft) => Promise<void>
  deleteCommand: (id: string) => Promise<void>
  runCommand: (id: string) => Promise<void>
  saveSettings: (draft: SettingsDraft) => Promise<void>
  addCustomShell: (name: string, exePath: string, argsTemplate: string) => Promise<void>
  removeCustomShell: (id: string) => Promise<void>
}

export type SettingsDraft = {
  defaultShellId: string
  defaultCloseMode: string
  defaultCountdownSeconds: number
}

function errorMessage(error: unknown, fallback: string): string {
  return String((error as { message?: string })?.message || error || fallback)
}

export function useCommandRunnerData(client: DirectClient | null): CommandRunnerData {
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [shells, setShells] = React.useState<ShellInfo[]>([])
  const [repos, setRepos] = React.useState<Repo[]>([])
  const [commands, setCommands] = React.useState<CommandItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!client) return
    setLoading(true)
    try {
      const [nextSettings, nextShells, nextRepos, nextCommands] = await Promise.all([
        client.request<AppSettings>('commandRunner.settings.get'),
        client.request<{ shells: ShellInfo[] }>('commandRunner.terminals.list'),
        client.request<{ repos: Repo[] }>('commandRunner.repos.list'),
        client.request<{ commands: CommandItem[] }>('commandRunner.commands.list', {}),
      ])
      setSettings(nextSettings)
      setShells(nextShells.shells)
      setRepos(nextRepos.repos)
      setCommands(nextCommands.commands)
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
        createCommand: unavailable,
        updateCommand: unavailable,
        deleteCommand: unavailable,
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

    return {
      createRepo: (name, path) => mutate('commandRunner.repos.create', { name, path }),
      updateRepo: (id, name, path) => mutate('commandRunner.repos.update', { id, name, path }),
      deleteRepo: id => mutate('commandRunner.repos.delete', { id }),
      createCommand: draft => mutate('commandRunner.commands.create', draft),
      updateCommand: (id, draft) => mutate('commandRunner.commands.update', { id, draft }),
      deleteCommand: id => mutate('commandRunner.commands.delete', { id }),
      runCommand: id => mutate('commandRunner.commands.run', { id }),
      saveSettings: draft => mutate('commandRunner.settings.save', draft),
      addCustomShell: (name, exePath, argsTemplate) =>
        mutate('commandRunner.shells.custom.add', { name, exePath, argsTemplate }),
      removeCustomShell: id => mutate('commandRunner.shells.custom.remove', { id }),
    }
  }, [client, refresh])

  return { settings, shells, repos, commands, loading, error, refresh, actions }
}
