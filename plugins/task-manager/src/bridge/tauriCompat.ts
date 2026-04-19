type TauriLike = {
  invoke: (spec: { command: string; payload?: any; timeoutMs?: number | null }) => Promise<any>
}

export function createTaskManagerFastWindowApi(baseApi: any, pluginId: string) {
  const base = baseApi || {}
  const tauri: TauriLike | null = base?.tauri || null
  if (!tauri || typeof tauri.invoke !== 'function') {
    throw new Error('tauri.invoke 不可用（请更新宿主网关）')
  }

  const pid = String(pluginId || '').trim()
  if (!pid) throw new Error('pluginId 为空')

  // 约定：task-manager 只用 data scope 做简单持久化。
  const SCOPE = 'data'

  const fs = {
    listDir: async (dir?: string | null) => {
      return tauri.invoke({
        command: 'plugin_files_list_dir',
        payload: { pluginId: pid, req: { scope: SCOPE, dir: dir == null ? null : String(dir) } },
      })
    },
    readText: async (path: string) => {
      const r = await tauri.invoke({
        command: 'plugin_files_read_text',
        payload: { pluginId: pid, req: { scope: SCOPE, path: String(path || '') } },
      })
      return r == null ? '' : String(r)
    },
    writeText: async (path: string, content: string) => {
      await tauri.invoke({
        command: 'plugin_files_write_text',
        payload: {
          pluginId: pid,
          req: { scope: SCOPE, path: String(path || ''), text: String(content ?? ''), overwrite: true },
        },
      })
    },
    delete: async (path: string) => {
      await tauri.invoke({
        command: 'plugin_files_delete',
        payload: { pluginId: pid, req: { scope: SCOPE, path: String(path || '') } },
      })
    },
  }

  return {
    ...base,
    tauri,
    fs: {
      ...(base.fs || {}),
      ...fs,
    },
  }
}

