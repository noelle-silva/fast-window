export type PageDisplayMode = 'page' | 'modal'

// 允许以模态窗呈现的页面。其他页面始终作为独立页面打开。
export const MODAL_CAPABLE_PAGE_IDS = ['home', 'index', 'attachments', 'all-notes', 'settings'] as const

export type ModalCapablePageId = (typeof MODAL_CAPABLE_PAGE_IDS)[number]

export type PageDisplayModesV1 = Partial<Record<ModalCapablePageId, PageDisplayMode>>

function normalizePageDisplayMode(value: unknown): PageDisplayMode {
  return value === 'modal' ? 'modal' : 'page'
}

export function normalizePageDisplayModes(input: unknown): PageDisplayModesV1 {
  if (!input || typeof input !== 'object') return {}
  const source = input as Record<string, unknown>
  const out: PageDisplayModesV1 = {}
  for (const id of MODAL_CAPABLE_PAGE_IDS) {
    if (normalizePageDisplayMode(source[id]) === 'modal') out[id] = 'modal'
  }
  return out
}

export function isModalCapablePageId(id: string): id is ModalCapablePageId {
  return (MODAL_CAPABLE_PAGE_IDS as readonly string[]).includes(id)
}

export function visiblePageId<T extends string>(page: T, modalPage: T | null | undefined): T {
  return modalPage ?? page
}
