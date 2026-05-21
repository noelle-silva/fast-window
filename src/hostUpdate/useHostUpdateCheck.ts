import { useCallback, useEffect, useRef, useState } from 'react'
import type { HostUpdateEntry } from '../appStore/catalogTypes'
import { checkHostUpdate, type HostUpdateCheckResult } from './hostUpdateClient'

export type HostUpdateCheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; remoteVersion: string }
  | { kind: 'missing' }
  | { kind: 'available'; update: HostUpdateEntry }
  | { kind: 'error'; message: string }

export function useHostUpdateCheck(currentVersion: string) {
  const [state, setState] = useState<HostUpdateCheckState>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const check = useCallback(async (): Promise<HostUpdateCheckResult | null> => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setState({ kind: 'checking' })

    try {
      const result = await checkHostUpdate(currentVersion, ctrl.signal)
      if (ctrl.signal.aborted || !mountedRef.current) return null
      if (result.status === 'available') setState({ kind: 'available', update: result.update })
      else if (result.status === 'current') setState({ kind: 'current', remoteVersion: result.remoteVersion })
      else setState({ kind: 'missing' })
      return result
    } catch (error: any) {
      if (ctrl.signal.aborted || !mountedRef.current) return null
      const message = String(error?.message || error || '检查更新失败')
      setState({ kind: 'error', message })
      return null
    }
  }, [currentVersion])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState({ kind: 'idle' })
  }, [])

  return { state, check, reset }
}
