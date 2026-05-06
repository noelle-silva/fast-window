import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { ClipboardHistoryApp } from './App'

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

  const el = document.getElementById('app')
  if (!el) return
  el.style.height = '100%'
  createRoot(el).render(<ClipboardHistoryApp />)
}

try {
  mount()
} catch (error) {
  document.body.textContent = String((error as any)?.message || error || '剪贴板历史加载失败')
  void invoke('app_ready').catch(() => {})
}
