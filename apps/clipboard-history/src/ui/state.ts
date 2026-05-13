import { CLIPBOARD_PAGE_SIZE, DEFAULT_SETTINGS } from '../shared/constants'
import type {
  ClipboardHistoryItem,
  ClipboardHistorySettings,
  ClipboardImageDraft,
  CollectionsDoc,
  DeletedHistoryMap,
  LegacyDataImportReport,
} from '../shared/types'

export type ClipboardHistoryView = 'clipboard' | 'folders'
export type FolderSearchScope = 'current' | 'global'
export type MovePickerAction = 'move' | 'copy'

export type ClipboardHistoryUiState = {
  history: ClipboardHistoryItem[]
  settings: ClipboardHistorySettings
  deleted: DeletedHistoryMap
  showSettings: boolean
  view: ClipboardHistoryView
  clipboardSearchQuery: string
  clipboardLimit: number
  clipboardExpanded: Record<string, boolean>
  clipboardImageCache: Record<string, string>
  clipboardImageLoading: Record<string, boolean>
  collections: CollectionsDoc | null
  currentFolderId: string
  folderSearchQuery: string
  folderSearchScope: FolderSearchScope
  recentFolders: string[]
  showRecentMenu: boolean
  showClearHistoryConfirm: boolean
  showItemEditor: boolean
  draftTitle: string
  draftContent: string
  draftImage: ClipboardImageDraft | null
  showFolderEditor: boolean
  draftFolderName: string
  deleteArmedId: string
  deleteArmedAt: number
  navBack: string[]
  navForward: string[]
  ctxMenu: { open: boolean; x: number; y: number; nodeId: string }
  movePicker: { open: boolean; movingId: string; query: string; action: MovePickerAction }
  editDialog: { open: boolean; nodeId: string; folderName: string; itemTitle: string; itemContent: string; itemImage: ClipboardImageDraft | null }
  legacyImportReport: LegacyDataImportReport | null
}

export function createClipboardHistoryUiState(): ClipboardHistoryUiState {
  return {
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    deleted: {},
    showSettings: false,

    view: 'clipboard',

    clipboardSearchQuery: '',
    clipboardLimit: CLIPBOARD_PAGE_SIZE,
    clipboardExpanded: {},
    clipboardImageCache: {},
    clipboardImageLoading: {},

    collections: null,
    currentFolderId: 'root',
    folderSearchQuery: '',
    folderSearchScope: 'current',
    recentFolders: [],
    showRecentMenu: false,
    showClearHistoryConfirm: false,

    showItemEditor: false,
    draftTitle: '',
    draftContent: '',
    draftImage: null,

    showFolderEditor: false,
    draftFolderName: '',

    deleteArmedId: '',
    deleteArmedAt: 0,

    navBack: [],
    navForward: [],

    ctxMenu: { open: false, x: 0, y: 0, nodeId: '' },
    movePicker: { open: false, movingId: '', query: '', action: 'move' },
    editDialog: { open: false, nodeId: '', folderName: '', itemTitle: '', itemContent: '', itemImage: null },
    legacyImportReport: null,
  }
}
