import '../render/vendor'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { HyperCortexApp } from './App'
import { getHyperCortexGateway } from '../gateway'

const host = document.getElementById('app') || document.body

function renderFatal(root: ReturnType<typeof createRoot>, error: unknown) {
  const message = String((error as any)?.message || error || 'HyperCortex 初始化失败')
  root.render(<div style={{ padding: 16, color: '#B00020', fontFamily: 'system-ui, sans-serif' }}>{message}</div>)
}

async function bootstrap() {
  if (!host) return
  const root = createRoot(host)
  try {
    const gateway = await getHyperCortexGateway()
    root.render(<HyperCortexApp gateway={gateway} />)
  } catch (error) {
    renderFatal(root, error)
  }
}

void bootstrap()
