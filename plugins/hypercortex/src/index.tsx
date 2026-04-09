import './render/vendor'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { HyperCortexApp } from './ui/App'

;(function bootstrap() {
  const runtime = String((window as any)?.fastWindow?.__meta?.runtime || 'ui')
  if (runtime === 'background') return

  const host = document.getElementById('app') || document.body
  if (!host) return

  createRoot(host).render(<HyperCortexApp />)
})()
