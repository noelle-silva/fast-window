import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installExternalLinkGuard } from '../externalLinkGuard'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  document.body.textContent = 'eucli-studio root not found'
} else {
  installExternalLinkGuard()
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
