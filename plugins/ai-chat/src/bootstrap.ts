import './app'
import { mountAiChatUi } from './ui/mount'

;(function () {
  const controller = (window as any).__fastWindowAiChat
  const runtime = String(controller?.capabilities?.meta?.runtime || 'ui')
  if (runtime === 'background') return

  if (!controller) return
  mountAiChatUi(controller)
})()
