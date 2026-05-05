export type AiDrawBackendEnv = {
  pluginId: string
  pluginDir: string
  dataDir: string
  filesDataDir: string
  outputDir: string
  libraryDir: string
  sessionToken: string
}

function requiredEnv(name: string) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`缺少环境变量：${name}`)
  return value
}

export function readAiDrawBackendEnv(): AiDrawBackendEnv {
  const env = {
    pluginId: requiredEnv('FAST_WINDOW_PLUGIN_ID'),
    pluginDir: requiredEnv('FAST_WINDOW_PLUGIN_DIR'),
    dataDir: requiredEnv('FAST_WINDOW_PLUGIN_DATA_DIR'),
    filesDataDir: requiredEnv('FAST_WINDOW_PLUGIN_FILES_DATA_DIR'),
    outputDir: requiredEnv('FAST_WINDOW_PLUGIN_OUTPUT_DIR'),
    libraryDir: requiredEnv('FAST_WINDOW_PLUGIN_LIBRARY_DIR'),
    sessionToken: requiredEnv('FAST_WINDOW_PLUGIN_SESSION_TOKEN'),
  }
  if (env.pluginId !== 'ai-draw') throw new Error(`插件 ID 不匹配：${env.pluginId}`)
  return env
}
