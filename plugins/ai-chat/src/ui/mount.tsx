import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AiChatApp } from './App'

const ROOT_ID = 'fast-window-ai-chat-root'

export function mountAiChatUi(controller: any) {
  const w = window as any
  if (w.__fastWindowAiChatRoot) return

  document.documentElement.style.height = '100%'
  document.body.style.height = '100%'
  document.body.style.margin = '0'

  let el = document.getElementById(ROOT_ID)
  if (!el) {
    document.body.innerHTML = `<div id="${ROOT_ID}"></div>`
    el = document.getElementById(ROOT_ID)
  }
  if (!el) return

  const root: Root = createRoot(el)
  w.__fastWindowAiChatRoot = root
  root.render(<AiChatApp controller={controller} />)
}
