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
    const deliver = (command: string | null | undefined) => {
      const trimmed = String(command || '').trim()
      if (trimmed) collectionsRef.current?.handleHostCommand(trimmed)
    }

    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ command?: string }>('fw-app-command', event => {
      deliver(event.payload?.command)
    })
      .then(nextUnlisten => {
        if (cancelled) nextUnlisten()
        else unlisten = nextUnlisten
      })
      .catch(() => {})

    void invoke<string | null>('fw_initial_command')
      .then(command => deliver(command))
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
