import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AiDrawGateway } from '../gateway/types'
import { AiDrawApp } from './App'

const ROOT_ID = 'fast-window-ai-draw-root'

export function mountAiDrawUi(gateway: AiDrawGateway) {
  const w = window as any
  if (w.__fastWindowAiDrawRoot) return

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

  let el = document.getElementById(ROOT_ID)
  if (!el) {
    document.body.innerHTML = '<div id="' + ROOT_ID + '"></div>'
    el = document.getElementById(ROOT_ID)
  }
  if (!el) return
  ;(el as HTMLDivElement).style.height = '100%'

  const root: Root = createRoot(el)
  w.__fastWindowAiDrawRoot = root
  root.render(<AiDrawApp gateway={gateway} />)
}

