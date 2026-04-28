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
  monitor: {
    restart: 'clipboardHistory.monitor.restart',
    snapshot: 'clipboardHistory.monitor.snapshot',
  },
} as const
