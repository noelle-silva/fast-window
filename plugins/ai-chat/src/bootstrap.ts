import './app'
import { mountAiChatUi } from './ui/mount'

;(function () {
  const api = (window as any).fastWindow
  const runtime = String(api?.__meta?.runtime || 'ui')
  if (runtime === 'background') return

  const controller = (window as any).__fastWindowAiChat
  if (!controller) return
  mountAiChatUi(controller)
})()
