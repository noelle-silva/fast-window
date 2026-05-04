export type AiChatBackendDataDirs = {
  pluginId: string
  pluginDir: string
  dataDir: string
  filesDataDir: string
  outputDir: string
  libraryDir: string
}

export function readBackendDataDirs(): AiChatBackendDataDirs {
  const pluginId = String(process.env.FAST_WINDOW_PLUGIN_ID || '').trim()
  if (!pluginId) throw new Error('FAST_WINDOW_PLUGIN_ID is required')

  const pluginDir = String(process.env.FAST_WINDOW_PLUGIN_DIR || '').trim()
  if (!pluginDir) throw new Error('FAST_WINDOW_PLUGIN_DIR is required')

  const dataDir = String(process.env.FAST_WINDOW_PLUGIN_DATA_DIR || '').trim()
  if (!dataDir) throw new Error('FAST_WINDOW_PLUGIN_DATA_DIR is required')

  const filesDataDir = String(process.env.FAST_WINDOW_PLUGIN_FILES_DATA_DIR || '').trim()
  if (!filesDataDir) throw new Error('FAST_WINDOW_PLUGIN_FILES_DATA_DIR is required')

  const outputDir = String(process.env.FAST_WINDOW_PLUGIN_OUTPUT_DIR || '').trim()
  const libraryDir = String(process.env.FAST_WINDOW_PLUGIN_LIBRARY_DIR || '').trim()

  return { pluginId, pluginDir, dataDir, filesDataDir, outputDir, libraryDir }
}
