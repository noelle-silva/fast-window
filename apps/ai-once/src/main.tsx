import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { AiOnceApp } from './ui/App'

function mount() {
  const rootStyle = document.documentElement.style
  const bodyStyle = document.body.style
  rootStyle.height = '100%'
  rootStyle.width = '100%'
  rootStyle.overflow = 'hidden'
  ;(rootStyle as any).overscrollBehavior = 'none'
  bodyStyle.height = '100%'
  bodyStyle.width = '100%'
  bodyStyle.margin = '0'
  bodyStyle.overflow = 'hidden'
  ;(bodyStyle as any).overscrollBehavior = 'none'

  const host = document.getElementById('app')
  if (!host) throw new Error('AI Once 挂载节点缺失')
  host.style.height = '100%'
  createRoot(host).render(<AiOnceApp />)
}

try {
  mount()
} catch (error) {
  document.body.textContent = String((error as { message?: string })?.message || error || 'AI Once 加载失败')
  void invoke('app_ready').catch(() => {})
}
