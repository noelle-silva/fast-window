import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App'

const ROOT_ID = 'fast-window-task-manager-root'

export function mountTaskManagerUi() {
  const w = window as any
  if (w.__fastWindowTaskManagerRoot) return

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
  el.style.height = '100%'

  const root: Root = createRoot(el)
  w.__fastWindowTaskManagerRoot = root
  root.render(<App />)
}
