import * as React from 'react'

export type SessionPageScrollRegistry = {
  register: (sessionKey: string, el: HTMLDivElement | null) => void
}

export const SessionPageScrollContext = React.createContext<SessionPageScrollRegistry | null>(null)

export function useSessionPageScrollRegistry() {
  return React.useContext(SessionPageScrollContext)
}
