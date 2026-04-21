import { createAiDrawFastWindowApi } from './bridge/tauriCompat'
import { runAiDrawBackground } from './background/runBackground'
import { mountAiDrawUi } from './ui/mount'

;(function bootstrap() {
  const baseApi = (window as any).fastWindow
  const api = createAiDrawFastWindowApi(baseApi, 'ai-draw')
  ;(window as any).fastWindow = api

  const runtime = String(api?.__meta?.runtime || 'ui')
  if (runtime === 'background') {
    runAiDrawBackground(api)
    return
  }

  mountAiDrawUi(api)
})()

