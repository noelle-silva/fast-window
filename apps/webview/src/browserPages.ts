export type BrowserPageIcon = {
  kind: string
  color?: string
  assetId?: string
}

export type BrowserPageInfo = {
  label: string
  name: string
  icon?: BrowserPageIcon | null
  rate?: number
}

export type BrowserPagesPayload = {
  pages?: BrowserPageInfo[]
  activeLabel?: string | null
}

export const BROWSER_PAGES_UPDATED_EVENT = 'browser:pages-updated'
