// Legacy Fast Window bridge entry. The standalone App entry is src/studio/main.tsx.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerCode from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw'
import { createAiChatFastWindowApi } from './bridge/tauriCompat'
import { createAiChatController } from './controller/createController'
import { createAiChatControllerV2 } from './controller/createControllerV2'
import { createAiChatCapabilitiesFromHostApi } from './gateway/capabilities'
import { createDirectCapabilitiesAdapter } from './direct/createDirectCapabilitiesAdapter'
import { AI_STUDIO_APP_ID, AI_STUDIO_CONTROLLER_KEY } from './runtime/aiStudioGlobals'

;(async function () {
  const fw = (window as any).fastWindow

  const isDirect = !!fw?.background?.endpoint

  let capabilities: ReturnType<typeof createAiChatCapabilitiesFromHostApi>
  let useV2 = false
  if (isDirect) {
    const { api } = await createDirectCapabilitiesAdapter(fw)
    capabilities = createAiChatCapabilitiesFromHostApi(api, AI_STUDIO_APP_ID)
    useV2 = true
  } else {
    const api = createAiChatFastWindowApi(fw, AI_STUDIO_APP_ID)
    capabilities = createAiChatCapabilitiesFromHostApi(api, AI_STUDIO_APP_ID)
  }

  try {
    const g = (pdfjsLib as any)?.GlobalWorkerOptions
    if (g && !g.workerSrc && typeof pdfWorkerCode === 'string') {
      g.workerSrc = URL.createObjectURL(new Blob([pdfWorkerCode], { type: 'text/javascript' }))
    }
  } catch (_) {}

  const factory = useV2 ? createAiChatControllerV2 : createAiChatController
  const { controller, init } = factory({ capabilities })
  ;(window as any)[AI_STUDIO_CONTROLLER_KEY] = controller

  init()
})()
