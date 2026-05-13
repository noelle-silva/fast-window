export const ClipboardHistoryRpc = {
  state: {
    load: 'clipboardHistory.state.load',
    saveSettings: 'clipboardHistory.state.saveSettings',
    clearHistory: 'clipboardHistory.state.clearHistory',
    deleteHistoryItem: 'clipboardHistory.state.deleteHistoryItem',
  },
  clipboard: {
    writeText: 'clipboardHistory.clipboard.writeText',
    writeImage: 'clipboardHistory.clipboard.writeImage',
  },
  images: {
    readOutput: 'clipboardHistory.images.readOutput',
    readClipboard: 'clipboardHistory.images.readClipboard',
    scanOrphans: 'clipboardHistory.images.scanOrphans',
    deleteOrphans: 'clipboardHistory.images.deleteOrphans',
  },
  collections: {
    createFolder: 'clipboardHistory.collections.createFolder',
    createItem: 'clipboardHistory.collections.createItem',
    updateFolder: 'clipboardHistory.collections.updateFolder',
    updateItem: 'clipboardHistory.collections.updateItem',
    moveNode: 'clipboardHistory.collections.moveNode',
    copyItem: 'clipboardHistory.collections.copyItem',
    deleteNode: 'clipboardHistory.collections.deleteNode',
    saveRecentFolder: 'clipboardHistory.collections.saveRecentFolder',
  },
  legacy: {
    importData: 'clipboardHistory.legacy.import',
  },
} as const
