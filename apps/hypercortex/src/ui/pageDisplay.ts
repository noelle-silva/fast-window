export type PageDisplayMode = 'page' | 'modal'

// 允许以「模态窗」形态呈现的页面名单；不在名单里的页面永远是独立页面。
export const MODAL_CAPABLE_PAGE_IDS = ['home', 'index', 'attachments', 'all-notes', 'settings'] as const

export type ModalCapablePageId = (typeof MODAL_CAPABLE_PAGE_IDS)[number]

export const MODAL_CAPABLE_PAGE_TITLES: Record<ModalCapablePageId, string> = {
  home: '主页',
  index: '收藏夹',
  attachments: '附件',
  'all-notes': '全部笔记',
  settings: '设置',
}

export type PageDisplayModesV1 = Partial<Record<ModalCapablePageId, PageDisplayMode>>

function normalizePageDisplayMode(value: unknown): PageDisplayMode {
  return value === 'modal' ? 'modal' : 'page'
}

// 收敛到白名单：未知页面、非法取值一律归一为「独立页面」。
export function normalizePageDisplayModes(input: unknown): PageDisplayModesV1 {
  if (!input || typeof input !== 'object') return {}
  const out: PageDisplayModesV1 = {}
  for (const id of MODAL_CAPABLE_PAGE_IDS) {
    if (normalizePageDisplayMode((input as any)[id]) === 'modal') out[id] = 'modal'
  }
  return out
}

export function isModalCapablePageId(id: string): id is ModalCapablePageId {
  return (MODAL_CAPABLE_PAGE_IDS as readonly string[]).includes(id)
}
