// ai-chat (entry: index.js)
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerCode from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw'
import { createAiChatFastWindowApi } from './bridge/tauriCompat'
import { createAiChatController } from './controller/createController'
import { createAiChatControllerV2 } from './controller/createControllerV2'
import { createAiChatCapabilitiesFromHostApi } from './gateway/capabilities'
import { createDirectCapabilitiesAdapter } from './direct/createDirectCapabilitiesAdapter'

;(async function () {
  const fw = (window as any).fastWindow

  const isDirect = !!fw?.background?.endpoint

  let capabilities: ReturnType<typeof createAiChatCapabilitiesFromHostApi>
  let useV2 = false
  if (isDirect) {
    const { api } = await createDirectCapabilitiesAdapter(fw)
    capabilities = createAiChatCapabilitiesFromHostApi(api, 'ai-chat')
    useV2 = true
  } else {
    const api = createAiChatFastWindowApi(fw, 'ai-chat')
    capabilities = createAiChatCapabilitiesFromHostApi(api, 'ai-chat')
  }

  try {
    const g = (pdfjsLib as any)?.GlobalWorkerOptions
    if (g && !g.workerSrc && typeof pdfWorkerCode === 'string') {
      g.workerSrc = URL.createObjectURL(new Blob([pdfWorkerCode], { type: 'text/javascript' }))
    }
  } catch (_) {}

  const factory = useV2 ? createAiChatControllerV2 : createAiChatController
  const { controller, init } = factory({ capabilities })
  ;(window as any).__fastWindowAiChat = controller

  init()
})()
