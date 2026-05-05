import '../render/vendor'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { HyperCortexApp } from './App'
import type { WindowControlActions } from './StandaloneWindowControls'
import { getHyperCortexGateway } from '../gateway'

const host = document.getElementById('app') || document.body
const TAURI_WINDOW = getCurrentWindow()

type FwLaunchInfo = {
  launched: boolean
  standalone: boolean
  mode: string
}

const WINDOW_CONTROL_ACTIONS: WindowControlActions = {
  minimize: () => TAURI_WINDOW.minimize(),
  toggleMaximize: () => TAURI_WINDOW.toggleMaximize(),
  closeToTray: () => invoke('hide_to_tray'),
}

function renderFatal(root: ReturnType<typeof createRoot>, error: unknown) {
  const message = String((error as any)?.message || error || 'HyperCortex 初始化失败')
  root.render(<div style={{ padding: 16, color: '#B00020', fontFamily: 'system-ui, sans-serif' }}>{message}</div>)
}

async function bootstrap() {
  if (!host) return
  const root = createRoot(host)
  try {
    const launchInfo = await invoke<FwLaunchInfo>('fw_launch_info').catch(() => ({
      launched: false,
      standalone: true,
      mode: 'standalone',
    }))
    const initialCommand = await invoke<string | null>('fw_initial_command').catch(() => null)
    await listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (!command) return
      window.dispatchEvent(new CustomEvent('hypercortex-command', { detail: { command } }))
    }).catch(() => {})
    const gateway = await getHyperCortexGateway()
    root.render(
      <HyperCortexApp
        gateway={gateway}
        initialCommand={initialCommand}
        windowControls={{
          standalone: launchInfo.standalone !== false,
          actions: WINDOW_CONTROL_ACTIONS,
        }}
      />,
    )
    await invoke('app_ready').catch(() => {})
  } catch (error) {
    renderFatal(root, error)
    await invoke('app_ready').catch(() => {})
  }
}

void bootstrap()
