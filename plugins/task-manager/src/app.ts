import { createTaskManagerFastWindowApi } from './bridge/tauriCompat'

;(function () {
  const baseApi = (window as any).fastWindow
  const pluginId = 'task-manager'

  try {
    ;(window as any).fastWindow = createTaskManagerFastWindowApi(baseApi, pluginId)
  } catch (e) {
    // 这里不 throw：避免整包初始化失败导致 UI 白屏，留给后续 UI 自己提示/降级。
    console.error(`[task-manager] fastWindow API 初始化失败：`, e)
  }
})()

