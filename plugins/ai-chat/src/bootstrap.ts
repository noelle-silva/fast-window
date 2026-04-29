import './app'
import { mountAiChatUi } from './ui/mount'

;(function () {
  const controller = (window as any).__fastWindowAiChat
  if (!controller) return
  mountAiChatUi(controller)
})()
