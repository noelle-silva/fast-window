import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { CollectionsPage, type CollectionsPageHandle } from './collections/CollectionsPage'
import { ToastProvider } from './collections/toast'

export default function MainApp() {
  const collectionsRef = React.useRef<CollectionsPageHandle>(null)
  const readyRef = React.useRef(false)

  React.useEffect(() => {
    if (readyRef.current) return
    readyRef.current = true
    void invoke('app_ready').catch(() => {})
  }, [])

  React.useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      const command = String(event.payload?.command || '').trim()
      if (command === 'open-settings') collectionsRef.current?.openSettings()
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
    <ToastProvider>
      <CollectionsPage ref={collectionsRef} />
    </ToastProvider>
  )
}
