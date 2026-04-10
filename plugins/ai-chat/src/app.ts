// ai-chat (iframe sandbox) (entry: index.js)
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerCode from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw'
import { createAiChatFastWindowApi } from './bridge/tauriCompat'
import { createAiChatController } from './controller/createController'
;(function () {
  const api = createAiChatFastWindowApi(window.fastWindow, 'ai-chat')
  ;(window as any).fastWindow = api

  try {
    const g = (pdfjsLib as any)?.GlobalWorkerOptions
    if (g && !g.workerSrc && typeof pdfWorkerCode === 'string') {
      g.workerSrc = URL.createObjectURL(new Blob([pdfWorkerCode], { type: 'text/javascript' }))
    }
  } catch (_) {}

  const runtime = String(api?.__meta?.runtime || 'ui')
  const runtimeStorage =
    api && (api as any).runtimeStorage && typeof (api as any).runtimeStorage.get === 'function' ? (api as any).runtimeStorage : api.storage

  const { controller, init } = createAiChatController({ api, runtime, runtimeStorage })
  ;(window as any).__fastWindowAiChat = controller

  init()
})()

