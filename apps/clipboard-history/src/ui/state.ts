import { CLIPBOARD_PAGE_SIZE, DEFAULT_SETTINGS } from '../shared/constants'

export function createClipboardHistoryUiState() {
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
    showMoreMenu: false,
    clearArmedAt: 0,

    showItemEditor: false,
    draftTitle: '',
    draftContent: '',

    showFolderEditor: false,
    draftFolderName: '',

    deleteArmedId: '',
    deleteArmedAt: 0,

    navBack: [],
    navForward: [],

    currentText: '',
    currentImage: '',
    internalCopy: { type: '', content: '', at: 0 },

    ctxMenu: { open: false, x: 0, y: 0, nodeId: '' },
    movePicker: { open: false, movingId: '', query: '', action: 'move' },
    editDialog: { open: false, nodeId: '', folderName: '', itemTitle: '', itemContent: '' },

    monitorTaskId: '',
    monitorQueryTimer: null,
    monitorQuerying: false,
    persistTimer: null,
  }
}

export type ClipboardHistoryUiState = ReturnType<typeof createClipboardHistoryUiState>
