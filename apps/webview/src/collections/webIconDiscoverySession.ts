import * as React from 'react'
import type { WebIconDiscoveryProgress } from './types'

export type WebIconDiscoverySession = { id: number; abortController: AbortController; found: number }

const IDLE_PROGRESS: WebIconDiscoveryProgress = { active: false, found: 0 }

export function useWebIconDiscoverySession() {
  const [progress, setProgress] = React.useState<WebIconDiscoveryProgress>(IDLE_PROGRESS)
  const seqRef = React.useRef(0)
  const currentRef = React.useRef<WebIconDiscoverySession | null>(null)

  const cancel = React.useCallback(() => {
    const session = currentRef.current
    currentRef.current = null
    session?.abortController.abort()
    setProgress(IDLE_PROGRESS)
    return Boolean(session)
  }, [])

  const start = React.useCallback(() => {
    cancel()
    const session: WebIconDiscoverySession = { id: ++seqRef.current, abortController: new AbortController(), found: 0 }
    currentRef.current = session
    setProgress({ active: true, found: 0 })
    return session
  }, [cancel])

  const isCurrent = React.useCallback((session: WebIconDiscoverySession) => currentRef.current?.id === session.id, [])

  const reportCandidate = React.useCallback((session: WebIconDiscoverySession) => {
    if (!isCurrent(session)) return false
    session.found += 1
    setProgress({ active: true, found: session.found })
    return true
  }, [isCurrent])

  const finish = React.useCallback((session: WebIconDiscoverySession) => {
    if (!isCurrent(session)) return false
    currentRef.current = null
    setProgress(IDLE_PROGRESS)
    return true
  }, [isCurrent])

  React.useEffect(() => () => { currentRef.current?.abortController.abort(); currentRef.current = null }, [])

  return { progress, cancel, finish, isCurrent, reportCandidate, start }
}
