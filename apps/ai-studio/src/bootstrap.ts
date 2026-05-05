import './app'
import { AI_STUDIO_CONTROLLER_KEY } from './runtime/aiStudioGlobals'
import { mountAiChatUi } from './ui/mount'

;(function () {
  const controller = (window as any)[AI_STUDIO_CONTROLLER_KEY]
  if (!controller) return
  mountAiChatUi(controller)
})()
