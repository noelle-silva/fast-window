import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ReferenceTopbar } from './ReferenceTopbar'
import { WebviewSettingsPage } from './WebviewSettingsPage'
import BookmarksPage from './BookmarksPage'
import type { FwLaunchInfo } from './types'
import { DEFAULT_LAUNCH_INFO } from './types'

const appWindow = getCurrentWindow()

export default function MainApp() {
  const [page, setPage] = React.useState<'home' | 'settings'>('home')
  const [launchInfo, setLaunchInfo] = React.useState<FwLaunchInfo>(DEFAULT_LAUNCH_INFO)
  const readyRef = React.useRef(false)

  const markAppReady = React.useCallback(() => {
    if (readyRef.current) return
    readyRef.current = true
    void invoke('app_ready').catch(() => {})
  }, [])

  React.useEffect(() => {
    markAppReady()
  }, [markAppReady])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const nextLaunchInfo = await invoke<FwLaunchInfo>('fw_launch_info').catch(() => DEFAULT_LAUNCH_INFO)
      if (cancelled) return
      setLaunchInfo(nextLaunchInfo)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (!command) return
      if (command === 'open-settings') setPage('settings')
      else if (command === 'open-webview') setPage('home')
      else if (command === 'show-health') setPage('home')
    })
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return (
    <main className="webview-app reference-app">
      <ReferenceTopbar
        page={page}
        standalone={launchInfo.standalone}
        onBack={() => setPage('home')}
        onOpenSettings={() => setPage('settings')}
        onStartDragging={() => appWindow.startDragging()}
        windowActions={{
          minimize: () => appWindow.minimize(),
          toggleMaximize: () => appWindow.toggleMaximize(),
          closeToTray: () => invoke('hide_to_tray'),
        }}
      />

      {page === 'home' ? <BookmarksPage /> : null}

      {page === 'settings' ? (
        <section className="webview-page webview-page-settings">
          <WebviewSettingsPage />
        </section>
      ) : null}
    </main>
  )
}
