import { mountTaskManagerUi } from './ui/mount'

;(function () {
  const api = (window as any).fastWindow
  const runtime = String(api?.__meta?.runtime || 'ui')
  if (runtime === 'background') return

  const run = () => mountTaskManagerUi()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  } else {
    run()
  }
})()

