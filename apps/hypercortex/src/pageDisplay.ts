export type PageDisplayMode = 'page' | 'modal'

// 允许以模态窗呈现的页面。其他页面始终作为独立页面打开。
export const MODAL_CAPABLE_PAGE_IDS = ['home', 'index', 'attachments', 'all-notes', 'settings'] as const

export type ModalCapablePageId = (typeof MODAL_CAPABLE_PAGE_IDS)[number]

export type PageDisplayModesV1 = Partial<Record<ModalCapablePageId, PageDisplayMode>>

// 除主页外，其余可接入页面默认以模态窗打开。
export const DEFAULT_PAGE_DISPLAY_MODES: Readonly<Record<ModalCapablePageId, PageDisplayMode>> = {
  home: 'page',
  index: 'modal',
  attachments: 'modal',
  'all-notes': 'modal',
  settings: 'modal',
}

function normalizePageDisplayMode(value: unknown): PageDisplayMode {
  return value === 'modal' ? 'modal' : 'page'
}

// 收敛为全量记录：每个可接入页面都有明确模式；缺省/非法值统一回退该页默认值。
export function normalizePageDisplayModes(input: unknown): PageDisplayModesV1 {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const out: PageDisplayModesV1 = {}
  for (const id of MODAL_CAPABLE_PAGE_IDS) {
    const raw = source[id]
    out[id] = raw === undefined || raw === null ? DEFAULT_PAGE_DISPLAY_MODES[id] : normalizePageDisplayMode(raw)
  }
  return out
}

export function isModalCapablePageId(id: string): id is ModalCapablePageId {
  return (MODAL_CAPABLE_PAGE_IDS as readonly string[]).includes(id)
}

export function visiblePageId<T extends string>(page: T, modalPage: T | null | undefined): T {
  return modalPage ?? page
}
