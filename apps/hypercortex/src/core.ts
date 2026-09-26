import type { HyperCortexShortcutBindingsV1 } from './shortcuts'
import type { HyperCortexColorPresetIdV1 } from './colorPresetIds'
import type { PageDisplayModesV1 } from './pageDisplay'
export { ACCEPTED_FILE_EXTENSIONS, extFromMime, kindFromMime, mimeFromExt } from './assetFileTypes'
export type { HyperCortexColorPresetIdV1 } from './colorPresetIds'

export type VaultScope = 'library' | 'data'

export type Api = {
  __meta?: { runtime?: 'ui' | 'background' }
  host?: { back?: () => Promise<void> | void }
  ui: {
    showToast: (message: string) => Promise<void> | void
    back?: () => Promise<void> | void
    startDragging?: () => Promise<void> | void
  }
  clipboard: {
    writeText: (text: string) => Promise<void>
  }
  files: {
    getLibraryDir: () => Promise<string>
    pickLibraryDir: () => Promise<string | null>
    openDir: (dir: string) => Promise<void>
    listDir: (req: { scope: VaultScope; dir?: string | null }) => Promise<
      { name: string; isDirectory: boolean; isFile: boolean; size: number; modifiedMs: number }[]
    >
    readText: (req: { scope: VaultScope; path: string }) => Promise<string>
    writeText: (req: { scope: VaultScope; path: string; text: string; overwrite?: boolean | null }) => Promise<string>
    rename: (req: { scope: VaultScope; from: string; to: string; overwrite?: boolean | null }) => Promise<void>
    delete: (req: { scope: VaultScope; path: string }) => Promise<void>
    deleteTree: (req: { scope: VaultScope; path: string }) => Promise<void>
  }
}

export type NoteMeta = {
  id: string
  title: string
  description: string
  dir: string
  createdAtMs: number
  updatedAtMs: number
}

export type HyperCortexIndexV1 = {
  version: 1
  notes: Record<string, NoteMeta>
}

export const ASSETS_DIR = 'Assets'

export type HyperCortexTabGroupV1 = {
  id: string
  title: string
  color: string
  collapsed?: boolean
}

export type HyperCortexSidebarItemV1 =
  | { type: 'tab'; tabKey: string }
  | {
      type: 'group'
      id: string
      title: string
      color: string
      collapsed?: boolean
      tabKeys: string[]
    }

export type HyperCortexWorkspaceV1 = {
  id: string
  title: string
  sidebarItems: HyperCortexSidebarItemV1[]
  tabGroups: HyperCortexTabGroupV1[]
  openTabKeys: string[]
  tabGroupByTabKey: Record<string, string>
  activeTabKey: string
}

export type HyperCortexHtmlFaceDisplayModeV1 = 'natural' | 'fit-window' | 'fixed-fit'
export type HyperCortexSidebarSortModeV1 = 'precision' | 'sortable'

// 应用设置身份：只描述「这个 App 怎么用」，全局唯一，所有仓库共用。
export type HyperCortexAppSettingsV1 = {
  version: 1
  allNotesLayout?: 'list' | 'grid' | 'icon'
  tabsCollapsed?: boolean
  tabsMode?: 'manual' | 'hover'
  sidebarSortMode?: HyperCortexSidebarSortModeV1
  shortcuts?: HyperCortexShortcutBindingsV1
  // When enabled, a "?" button appears in the top bar to show configured shortcuts.
  shortcutHintsEnabled?: boolean
  // 面插件全局设置统一容器：类型标识 → 字段键 → 值（旧 HTML 面全局字段由后端数据升级一次性搬入）。
  facePluginSettings?: Record<string, Record<string, unknown>>
  // 面类型的全局顺序；新笔记默认创建的面按此顺序排列。
  faceKindOrder?: string[]
  // 新建笔记时默认创建的面类型（多选，空数组表示无面）。
  defaultFaceKinds?: string[]
  colorPresetId?: HyperCortexColorPresetIdV1
  pageDisplayModes?: PageDisplayModesV1
  trashEnabled?: boolean
  trashAutoDeleteDays?: number
}

// 笔记仓库数据身份：指向具体笔记/附件内容的工作状态，随仓库走。
export type HyperCortexRepoStateV1 = {
  version: 1
  sidebarItems?: HyperCortexSidebarItemV1[]
  openTabKeys?: string[]
  tabGroupByTabKey?: Record<string, string>
  activeTabKey?: string
  tabGroups?: HyperCortexTabGroupV1[]
  workspaces?: HyperCortexWorkspaceV1[]
  activeWorkspaceId?: string
  currentFolderId?: string
}

export function monthFolder(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
