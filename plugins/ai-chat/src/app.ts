// ai-chat (iframe sandbox) (entry: index.js)
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerCode from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw'
import { createAiChatFastWindowApi } from './bridge/tauriCompat'
import { createAiChatController } from './controller/createController'
import { createAiChatCapabilitiesFromHostApi } from './gateway/capabilities'
;(function () {
  const api = createAiChatFastWindowApi(window.fastWindow, 'ai-chat')
  const capabilities = createAiChatCapabilitiesFromHostApi(api, 'ai-chat')

  try {
    const g = (pdfjsLib as any)?.GlobalWorkerOptions
    if (g && !g.workerSrc && typeof pdfWorkerCode === 'string') {
      g.workerSrc = URL.createObjectURL(new Blob([pdfWorkerCode], { type: 'text/javascript' }))
    }
  } catch (_) {}

  const { controller, init } = createAiChatController({ capabilities })
  ;(window as any).__fastWindowAiChat = controller

  init()
})()

