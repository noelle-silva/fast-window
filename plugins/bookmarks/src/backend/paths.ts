import { join } from 'node:path'

export function resolveDataFilePath(env = process.env) {
  const pluginId = env.FAST_WINDOW_PLUGIN_ID || 'bookmarks'
  const fallbackDataRoot = join(process.cwd(), '..', '..', 'data', pluginId)
  const dataRootDir = env.FAST_WINDOW_PLUGIN_DATA_DIR || fallbackDataRoot
  const dataDir = env.FAST_WINDOW_PLUGIN_FILES_DATA_DIR || dataRootDir
  return join(dataDir, 'data.json')
}
