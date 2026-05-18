export type AiChatBackendDataDirs = {
  appId: string
  appDir: string
  dataDir: string
  filesDataDir: string
  outputDir: string
  libraryDir: string
}

export function readBackendDataDirs(): AiChatBackendDataDirs {
  // Legacy Node backend reference: old FAST_WINDOW_PLUGIN_* names are accepted only as fallback.
  const appId = String(process.env.FW_APP_ID || process.env.FAST_WINDOW_PLUGIN_ID || '').trim()
  if (!appId) throw new Error('FW_APP_ID is required')

  const appDir = String(process.env.FW_APP_DIR || process.env.FAST_WINDOW_PLUGIN_DIR || '').trim()
  if (!appDir) throw new Error('FW_APP_DIR is required')

  const dataDir = String(process.env.FW_APP_DATA_DIR || process.env.FAST_WINDOW_PLUGIN_DATA_DIR || '').trim()
  if (!dataDir) throw new Error('FW_APP_DATA_DIR is required')

  const filesDataDir = String(process.env.FW_APP_FILES_DATA_DIR || process.env.FAST_WINDOW_PLUGIN_FILES_DATA_DIR || '').trim()
  if (!filesDataDir) throw new Error('FW_APP_FILES_DATA_DIR is required')

  const outputDir = String(process.env.FW_APP_OUTPUT_DIR || process.env.FAST_WINDOW_PLUGIN_OUTPUT_DIR || '').trim()
  const libraryDir = String(process.env.FW_APP_LIBRARY_DIR || process.env.FAST_WINDOW_PLUGIN_LIBRARY_DIR || '').trim()

  return { appId, appDir, dataDir, filesDataDir, outputDir, libraryDir }
}
